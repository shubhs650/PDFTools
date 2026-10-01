// Post-redaction verification by location (M4-18, §7.9 step 5, ADR-001 B3,
// ADR-017 decision 6), on the redacted output reopened in the Work worker:
// for every page with redacted rectangles, no text character, text object,
// vector segment (curves tested exactly), image pixel other than one uniform
// colour, shading or annotation may remain inside any rectangle — Form
// XObjects included. Then the string rule: every redacted word that does not
// also occur outside the rectangles in the source must not occur anywhere in
// the output's text (pages, annotation contents, bookmarks, document info).
// And structural checks: one revision, no metadata, thumbnails, structure
// tree, JavaScript or embedded files. A leak names the page and the kind,
// never the content (rule 10).
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { rawCall } from '../../render/pdfium';
import { outsideRanges, type Pt, type Rect } from './geometry';

export type LeakKind =
  'text' | 'text-object' | 'path' | 'image' | 'shading' | 'annotation' | 'string' | 'structure';

export interface Leak {
  /** 0-based page, or -1 for the document. */
  page: number;
  kind: LeakKind;
}

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  getValue(ptr: number, t: 'float' | 'double' | 'i32'): number;
  HEAPU8: Uint8Array;
  UTF16ToString(ptr: number): string;
}

/** Strict overlap with a small inset: a glyph or segment touching the edge is not a leak. */
const INSET = 0.25;
export const overlapsInside = (a: Rect, b: Rect): boolean =>
  a[0] < b[2] - INSET && a[2] > b[0] + INSET && a[1] < b[3] - INSET && a[3] > b[1] + INSET;
const shrink = (r: Rect): Rect => [r[0] + INSET, r[1] + INSET, r[2] - INSET, r[3] - INSET];

type M = [number, number, number, number, number, number];
const I: M = [1, 0, 0, 1, 0, 0];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];
const apply = (m: M, x: number, y: number): Pt => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];
function invert(m: M): M | null {
  const d = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(d) < 1e-12) return null;
  return [
    m[3] / d,
    -m[1] / d,
    -m[2] / d,
    m[0] / d,
    (m[2] * m[5] - m[3] * m[4]) / d,
    (m[1] * m[4] - m[0] * m[5]) / d,
  ];
}

const TYPE_TEXT = 1;
const TYPE_PATH = 2;
const TYPE_IMAGE = 3;
const TYPE_SHADING = 4;
const TYPE_FORM = 5;
const POPUP = 16;

export class Verifier {
  private readonly mod: WrappedPdfiumModule;
  private readonly heap: Heap;

  constructor(mod: WrappedPdfiumModule) {
    this.mod = mod;
    this.heap = mod.pdfium as unknown as Heap;
  }

  private call(name: string, ...args: (number | string)[]): number {
    return rawCall(this.mod, name, ...args);
  }

  private withBuf<T>(bytes: number, fn: (ptr: number) => T): T {
    const ptr = this.heap.wasmExports.malloc(bytes);
    try {
      return fn(ptr);
    } finally {
      this.heap.wasmExports.free(ptr);
    }
  }

  private matrixOf(obj: number): M {
    return this.withBuf(24, (p) =>
      this.call('FPDFPageObj_GetMatrix', obj, p)
        ? (Array.from({ length: 6 }, (_, i) => this.heap.getValue(p + i * 4, 'float')) as M)
        : I,
    );
  }

  /** Text characters inside rectangles; returns the words they belong to (for the string rule). */
  textInRects(page: number, pagePtr: number, rects: readonly Rect[], leaks: Leak[]): string[] {
    const tp = this.call('FPDFText_LoadPage', pagePtr);
    const words: string[] = [];
    let leaked: boolean;
    try {
      const n = this.call('FPDFText_CountChars', tp);
      let word = '';
      let hit = false;
      const flush = () => {
        if (hit && word) words.push(word);
        word = '';
        hit = false;
      };
      leaked = this.withBuf(32, (p) => {
        let any = false;
        for (let i = 0; i < n; i++) {
          const code = this.call('FPDFText_GetUnicode', tp, i);
          const ch = String.fromCodePoint(code || 32);
          if (/\s/u.test(ch) || code === 0) {
            flush();
            continue;
          }
          word += ch;
          if (!this.call('FPDFText_GetCharBox', tp, i, p, p + 8, p + 16, p + 24)) continue;
          const [l, r, b, t] = [0, 1, 2, 3].map((k) => this.heap.getValue(p + k * 8, 'double'));
          const box: Rect = [l ?? 0, b ?? 0, r ?? 0, t ?? 0];
          if (rects.some((rc) => overlapsInside(box, rc))) {
            hit = true;
            any = true;
          }
        }
        flush();
        return any;
      });
    } finally {
      this.call('FPDFText_ClosePage', tp);
    }
    if (leaked) leaks.push({ page, kind: 'text' });
    return words;
  }

  /**
   * Text objects the text page indexes → whether one of their own characters
   * lies inside a rectangle. PDFium removes covered glyphs but keeps the rest
   * of a line in one object, so the object's bounds can span a mark that no
   * longer has any of its characters inside (a word redacted mid-line).
   */
  private textObjectHits(pagePtr: number, rects: readonly Rect[]): Map<number, boolean> {
    const hits = new Map<number, boolean>();
    const tp = this.call('FPDFText_LoadPage', pagePtr);
    try {
      const n = this.call('FPDFText_CountChars', tp);
      this.withBuf(32, (p) => {
        for (let i = 0; i < n; i++) {
          const obj = this.call('FPDFText_GetTextObject', tp, i);
          if (!obj) continue;
          let inside = false;
          if (this.call('FPDFText_GetCharBox', tp, i, p, p + 8, p + 16, p + 24)) {
            const [l, r, b, t] = [0, 1, 2, 3].map((k) => this.heap.getValue(p + k * 8, 'double'));
            inside = rects.some((rc) => overlapsInside([l ?? 0, b ?? 0, r ?? 0, t ?? 0], rc));
          }
          hits.set(obj, (hits.get(obj) ?? false) || inside);
        }
      });
    } finally {
      this.call('FPDFText_ClosePage', tp);
    }
    return hits;
  }

  /** Page objects (into Form XObjects) with content inside a rectangle. */
  objectsInRects(page: number, pagePtr: number, rects: readonly Rect[], leaks: Leak[]): void {
    const kinds = new Set<LeakKind>();
    let textHits: Map<number, boolean> | null = null;
    const visit = (obj: number, parent: M, depth: number) => {
      const type = this.call('FPDFPageObj_GetType', obj);
      const own = this.matrixOf(obj);
      if (type === TYPE_FORM) {
        const m = mul(own, parent);
        const n = this.call('FPDFFormObj_CountObjects', obj);
        for (let i = 0; i < n && depth < 16; i++)
          visit(this.call('FPDFFormObj_GetObject', obj, i), m, depth + 1);
        return;
      }
      const b = this.withBuf(16, (p) =>
        this.call('FPDFPageObj_GetBounds', obj, p, p + 4, p + 8, p + 12)
          ? [0, 1, 2, 3].map((i) => this.heap.getValue(p + i * 4, 'float'))
          : null,
      );
      if (!b) return;
      // Bounds of a nested object are in its form's space: map the corners.
      const cs = [
        apply(parent, b[0] ?? 0, b[1] ?? 0),
        apply(parent, b[2] ?? 0, b[1] ?? 0),
        apply(parent, b[0] ?? 0, b[3] ?? 0),
        apply(parent, b[2] ?? 0, b[3] ?? 0),
      ];
      const pb: Rect = [
        Math.min(...cs.map((c) => c[0])),
        Math.min(...cs.map((c) => c[1])),
        Math.max(...cs.map((c) => c[0])),
        Math.max(...cs.map((c) => c[1])),
      ];
      const hit = rects.filter((r) => overlapsInside(pb, r));
      if (hit.length === 0) return;
      if (type === TYPE_TEXT) {
        // Objects the text page does not index keep the conservative bounds rule.
        textHits ??= this.textObjectHits(pagePtr, rects);
        if (textHits.get(obj) ?? true) kinds.add('text-object');
      } else if (type === TYPE_PATH) {
        if (this.pathHits(obj, mul(own, parent), pb, hit)) kinds.add('path');
      } else if (type === TYPE_IMAGE) {
        if (this.imageHits(obj, mul(own, parent), hit)) kinds.add('image');
      } else if (type === TYPE_SHADING) kinds.add('shading');
    };
    const n = this.call('FPDFPage_CountObjects', pagePtr);
    for (let i = 0; i < n; i++) visit(this.call('FPDFPage_GetObject', pagePtr, i), I, 0);
    for (const kind of kinds) leaks.push({ page, kind });
  }

  private pathHits(obj: number, m: M, pb: Rect, rects: readonly Rect[]): boolean {
    // The redaction's own fill: a path exactly covering a rectangle.
    if (rects.some((r) => r.every((v, i) => Math.abs(v - (pb[i] ?? 0)) < 1.01))) return false;
    const inner = rects.map(shrink);
    const n = this.call('FPDFPath_CountSegments', obj);
    const subs: Pt[][] = [];
    const hit = this.withBuf(8, (p): boolean => {
      let prev: Pt | null = null;
      let bez: Pt[] = [];
      for (let i = 0; i < n; i++) {
        const seg = this.call('FPDFPath_GetPathSegment', obj, i);
        if (!this.call('FPDFPathSegment_GetPoint', seg, p, p + 4)) continue;
        const pt = apply(m, this.heap.getValue(p, 'float'), this.heap.getValue(p + 4, 'float'));
        const type = this.call('FPDFPathSegment_GetType', seg); // 0 line, 1 Bézier, 2 move
        if (type === 2 || !prev) {
          subs.push([pt]);
          prev = pt;
          continue;
        }
        if (type === 1) {
          bez.push(pt);
          if (bez.length < 3) continue;
          const [c1, c2, to] = bez as [Pt, Pt, Pt];
          bez = [];
          // Exactly: any part of the curve inside a rectangle.
          const ranges = outsideRanges(prev, { kind: 'cubic', c1, c2, to }, inner);
          if (!(ranges.length === 1 && ranges[0]?.[0] === 0 && ranges[0][1] === 1)) return true;
          subs.at(-1)?.push(to);
          prev = to;
          continue;
        }
        const ranges = outsideRanges(prev, { kind: 'line', to: pt }, inner);
        if (!(ranges.length === 1 && ranges[0]?.[0] === 0 && ranges[0][1] === 1)) return true;
        subs.at(-1)?.push(pt);
        prev = pt;
      }
      return false;
    });
    if (hit) return true;
    // A filled area covering a rectangle with no edge inside it (a large box behind it).
    const fill = this.withBuf(8, (p) =>
      this.call('FPDFPath_GetDrawMode', obj, p, p + 4) ? this.heap.getValue(p, 'i32') : 0,
    );
    if (fill === 0) return false;
    return rects.some((r) => {
      const cx = (r[0] + r[2]) / 2;
      const cy = (r[1] + r[3]) / 2;
      let crossings = 0;
      let winding = 0;
      for (const poly of subs)
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const [xi, yi] = poly[i] ?? [0, 0];
          const [xj, yj] = poly[j] ?? [0, 0];
          if (yi > cy !== yj > cy && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi) {
            crossings++;
            winding += yj > yi ? 1 : -1;
          }
        }
      return fill === 1 ? crossings % 2 === 1 : winding !== 0;
    });
  }

  /** More than one colour among an image's pixels inside a rectangle. */
  private imageHits(obj: number, m: M, rects: readonly Rect[]): boolean {
    const bmp = this.call('FPDFImageObj_GetBitmap', obj);
    if (!bmp) return true;
    try {
      const w = this.call('FPDFBitmap_GetWidth', bmp);
      const h = this.call('FPDFBitmap_GetHeight', bmp);
      const stride = this.call('FPDFBitmap_GetStride', bmp);
      const fmt = this.call('FPDFBitmap_GetFormat', bmp); // 1 gray, 2 BGR, 3 BGRx, 4 BGRA
      const bpp = fmt === 1 ? 1 : fmt === 2 ? 3 : 4;
      const buf = this.call('FPDFBitmap_GetBuffer', bmp);
      const inv = invert(m);
      if (!inv) return false;
      let first: number | null = null;
      for (const r of rects) {
        const c = [
          apply(inv, r[0] + INSET, r[1] + INSET),
          apply(inv, r[2] - INSET, r[1] + INSET),
          apply(inv, r[0] + INSET, r[3] - INSET),
          apply(inv, r[2] - INSET, r[3] - INSET),
        ];
        const u0 = Math.max(0, Math.min(...c.map((q) => q[0])));
        const u1 = Math.min(1, Math.max(...c.map((q) => q[0])));
        const v0 = Math.max(0, Math.min(...c.map((q) => q[1])));
        const v1 = Math.min(1, Math.max(...c.map((q) => q[1])));
        if (u0 >= u1 || v0 >= v1) continue;
        const x0 = Math.floor(u0 * w);
        const x1 = Math.min(w, Math.ceil(u1 * w));
        const y0 = Math.floor((1 - v1) * h);
        const y1 = Math.min(h, Math.ceil((1 - v0) * h));
        const heap = this.heap.HEAPU8;
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            const at = buf + y * stride + x * bpp;
            const v =
              bpp === 1
                ? (heap[at] ?? 0)
                : ((heap[at] ?? 0) << 16) | ((heap[at + 1] ?? 0) << 8) | (heap[at + 2] ?? 0);
            if (first === null) first = v;
            else if (v !== first) return true;
          }
      }
      return false;
    } finally {
      this.call('FPDFBitmap_Destroy', bmp);
    }
  }

  /** Annotations (other than popups) whose rectangle overlaps a redacted one. */
  annotsInRects(page: number, pagePtr: number, rects: readonly Rect[], leaks: Leak[]): void {
    const n = this.call('FPDFPage_GetAnnotCount', pagePtr);
    const found = this.withBuf(16, (p) => {
      for (let i = 0; i < n; i++) {
        const a = this.call('FPDFPage_GetAnnot', pagePtr, i);
        try {
          if (
            this.call('FPDFAnnot_GetSubtype', a) === POPUP ||
            !this.call('FPDFAnnot_GetRect', a, p)
          )
            continue;
          const [l, t, r, b] = [0, 1, 2, 3].map((k) => this.heap.getValue(p + k * 4, 'float'));
          const box: Rect = [l ?? 0, Math.min(b ?? 0, t ?? 0), r ?? 0, Math.max(b ?? 0, t ?? 0)];
          if (rects.some((rc) => overlapsInside(box, rc))) return true;
        } finally {
          this.call('FPDFPage_CloseAnnot', a);
        }
      }
      return false;
    });
    if (found) leaks.push({ page, kind: 'annotation' });
  }

  /** Every text a user can search or read: pages, annotation contents, bookmarks, info. */
  documentText(docPtr: number, checkpoint?: () => void): string {
    const parts: string[] = [];
    const pages = this.call('FPDF_GetPageCount', docPtr);
    for (let i = 0; i < pages; i++) {
      checkpoint?.();
      const page = this.call('FPDF_LoadPage', docPtr, i);
      const tp = this.call('FPDFText_LoadPage', page);
      const n = this.call('FPDFText_CountChars', tp);
      this.withBuf((n + 1) * 2, (p) => {
        this.call('FPDFText_GetText', tp, 0, n, p);
        parts.push(this.heap.UTF16ToString(p));
      });
      this.call('FPDFText_ClosePage', tp);
      const an = this.call('FPDFPage_GetAnnotCount', page);
      for (let k = 0; k < an; k++) {
        const a = this.call('FPDFPage_GetAnnot', page, k);
        parts.push(this.wide((b, l) => this.call('FPDFAnnot_GetStringValue', a, 'Contents', b, l)));
        this.call('FPDFPage_CloseAnnot', a);
      }
      this.call('FPDF_ClosePage', page);
    }
    const walk = (parent: number, depth: number) => {
      let bm = this.call('FPDFBookmark_GetFirstChild', docPtr, parent);
      let guard = 0;
      while (bm && guard++ < 100_000) {
        parts.push(this.wide((b, l) => this.call('FPDFBookmark_GetTitle', bm, b, l)));
        if (depth < 32) walk(bm, depth + 1);
        bm = this.call('FPDFBookmark_GetNextSibling', docPtr, bm);
      }
    };
    walk(0, 0);
    for (const key of ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer'])
      parts.push(this.wide((b, l) => this.call('FPDF_GetMetaText', docPtr, key, b, l)));
    return parts.join('\n');
  }

  private wide(read: (buf: number, len: number) => number): string {
    const len = read(0, 0);
    if (len <= 2) return '';
    return this.withBuf(len + 2, (p) => {
      read(p, len + 2);
      return this.heap.UTF16ToString(p);
    });
  }
}

/** Redacted words (3+ characters) that do not also occur outside the rectangles in the source (B3). */
export function wordsToSearch(sourceText: string, inRects: readonly string[]): string[] {
  const count = (hay: string, needle: string) => hay.split(needle).length - 1;
  const inside = new Map<string, number>();
  for (const w of inRects) inside.set(w, (inside.get(w) ?? 0) + 1);
  return [...inside]
    .filter(([w, n]) => Array.from(w).length >= 3 && count(sourceText, w) <= n)
    .map(([w]) => w);
}
