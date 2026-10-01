// M4-02 spike (ADR-017): post-redaction verification by location (ADR-001 B3,
// §7.9 step 5), on raw PDFium exports (B14) so it can run in the Work worker.
// For every page with redacted rectangles: no text character, text object,
// vector segment, image pixel (other than a uniform fill), shading or
// annotation may remain inside any rectangle, recursing into Form XObjects.
// Plus the string rule: every redacted word that does not also occur outside
// the rectangles in the source must not occur anywhere in the output's text
// (pages, annotation contents, bookmark titles, document info).
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { rawCall } from '../../src/workers/render/pdfium.ts';

export type Rect = [number, number, number, number]; // x0 y0 x1 y1, default user space
export interface Leak {
  page: number;
  kind: 'text' | 'text-object' | 'path' | 'image' | 'shading' | 'annotation' | 'string';
  detail: string;
}

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  getValue(ptr: number, t: 'float' | 'double' | 'i32' | 'i8'): number;
  HEAPU8: Uint8Array;
  UTF16ToString(ptr: number): string;
}
const heapOf = (mod: WrappedPdfiumModule) => mod.pdfium as unknown as Heap;

/** Strict overlap with a small inset, so a glyph box touching the edge is not a leak. */
const EPS = 0.25;
export const overlaps = (a: Rect, b: Rect): boolean =>
  a[0] < b[2] - EPS && a[2] > b[0] + EPS && a[1] < b[3] - EPS && a[3] > b[1] + EPS;

type M = [number, number, number, number, number, number];
const I: M = [1, 0, 0, 1, 0, 0];
/** p' = p × m (PDF row-vector convention). */
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];
const apply = (m: M, x: number, y: number): [number, number] => [
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

/** Does segment p→q pass through the rectangle's interior (Liang–Barsky)? */
function segmentHits(p: [number, number], q: [number, number], r: Rect): boolean {
  const [x0, y0, x1, y1] = [r[0] + EPS, r[1] + EPS, r[2] - EPS, r[3] - EPS];
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  let t0 = 0;
  let t1 = 1;
  for (const [pk, qk] of [
    [-dx, p[0] - x0],
    [dx, x1 - p[0]],
    [-dy, p[1] - y0],
    [dy, y1 - p[1]],
  ] as const) {
    if (pk === 0) {
      if (qk < 0) return false;
    } else {
      const t = qk / pk;
      if (pk < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return t0 <= t1;
}

export class Verifier {
  private readonly mod: WrappedPdfiumModule;
  private readonly heap: Heap;
  constructor(mod: WrappedPdfiumModule) {
    this.mod = mod;
    this.heap = heapOf(mod);
  }

  private call(name: string, ...args: number[]): number {
    return rawCall(this.mod, name, ...args);
  }

  private floats<T>(n: number, bytes: number, fn: (ptr: number) => T): T {
    const ptr = this.heap.wasmExports.malloc(n * bytes);
    try {
      return fn(ptr);
    } finally {
      this.heap.wasmExports.free(ptr);
    }
  }

  private matrixOf(obj: number): M {
    return this.floats(6, 4, (p) =>
      this.call('FPDFPageObj_GetMatrix', obj, p)
        ? (Array.from({ length: 6 }, (_, i) => this.heap.getValue(p + i * 4, 'float')) as M)
        : I,
    );
  }

  private boundsOf(obj: number): Rect | null {
    return this.floats(4, 4, (p) => {
      if (!this.call('FPDFPageObj_GetBounds', obj, p, p + 4, p + 8, p + 12)) return null;
      const [l, b, r, t] = [0, 1, 2, 3].map((i) => this.heap.getValue(p + i * 4, 'float'));
      return [l ?? 0, b ?? 0, r ?? 0, t ?? 0];
    });
  }

  /** Characters whose boxes overlap a rectangle; also returns each overlapped word. */
  textInRects(page: number, pagePtr: number, rects: Rect[], leaks: Leak[]): string[] {
    const tp = this.call('FPDFText_LoadPage', pagePtr);
    const words: string[] = [];
    try {
      const n = this.call('FPDFText_CountChars', tp);
      let word = '';
      let hit = false;
      const flush = () => {
        if (hit && word) words.push(word);
        word = '';
        hit = false;
      };
      this.floats(4, 8, (p) => {
        for (let i = 0; i < n; i++) {
          const u = this.call('FPDFText_GetUnicode', tp, i);
          const ch = String.fromCodePoint(u || 32);
          if (/\s/.test(ch) || u === 0) {
            flush();
            continue;
          }
          word += ch;
          if (!this.call('FPDFText_GetCharBox', tp, i, p, p + 8, p + 16, p + 24)) continue;
          const [l, r, b, t] = [0, 1, 2, 3].map((k) => this.heap.getValue(p + k * 8, 'double'));
          const box: Rect = [l ?? 0, b ?? 0, r ?? 0, t ?? 0];
          const inside = rects.some((rc) => overlaps(box, rc));
          if (inside) {
            hit = true;
            leaks.push({ page, kind: 'text', detail: `char '${ch}'` });
          }
        }
        flush();
      });
    } finally {
      this.call('FPDFText_ClosePage', tp);
    }
    return words;
  }

  /** Page objects (recursing into forms) that put content inside a rectangle. */
  objectsInRects(page: number, pagePtr: number, rects: Rect[], docPtr: number, leaks: Leak[]) {
    const visit = (obj: number, parent: M, depth: number) => {
      const type = this.call('FPDFPageObj_GetType', obj);
      const own = this.matrixOf(obj);
      if (type === 5) {
        // Form XObject: children are in form space; the form's matrix maps them.
        const m = mul(own, parent);
        const n = this.call('FPDFFormObj_CountObjects', obj);
        for (let i = 0; i < n && depth < 12; i++)
          visit(this.call('FPDFFormObj_GetObject', obj, i), m, depth + 1);
        return;
      }
      const b = this.boundsOf(obj);
      if (!b) return;
      // Bounds of a nested object are in its form's space: map the corners.
      const corners = [
        apply(parent, b[0], b[1]),
        apply(parent, b[2], b[1]),
        apply(parent, b[0], b[3]),
        apply(parent, b[2], b[3]),
      ];
      const pb: Rect = [
        Math.min(...corners.map((c) => c[0])),
        Math.min(...corners.map((c) => c[1])),
        Math.max(...corners.map((c) => c[0])),
        Math.max(...corners.map((c) => c[1])),
      ];
      const hit = rects.filter((r) => overlaps(pb, r));
      if (hit.length === 0) return;
      if (type === 1) {
        leaks.push({ page, kind: 'text-object', detail: `bounds ${pb.map(Math.round).join(',')}` });
      } else if (type === 2) this.pathHits(page, obj, mul(own, parent), pb, hit, leaks);
      else if (type === 3) this.imageHits(page, obj, mul(own, parent), hit, docPtr, pagePtr, leaks);
      else if (type === 4) leaks.push({ page, kind: 'shading', detail: 'shading in rect' });
    };
    const n = this.call('FPDFPage_CountObjects', pagePtr);
    for (let i = 0; i < n; i++) visit(this.call('FPDFPage_GetObject', pagePtr, i), I, 0);
  }

  private pathHits(page: number, obj: number, m: M, pb: Rect, rects: Rect[], leaks: Leak[]) {
    // The redaction fill itself: a filled path whose bounds equal a rectangle.
    const isFill = rects.some((r) => r.every((v, i) => Math.abs(v - (pb[i] ?? 0)) < 1.01));
    if (isFill) return;
    const n = this.call('FPDFPath_CountSegments', obj);
    const pts: [number, number][] = [];
    this.floats(2, 4, (p) => {
      for (let i = 0; i < n; i++) {
        const seg = this.call('FPDFPath_GetPathSegment', obj, i);
        if (!this.call('FPDFPathSegment_GetPoint', seg, p, p + 4)) continue;
        const pt = apply(m, this.heap.getValue(p, 'float'), this.heap.getValue(p + 4, 'float'));
        const type = this.call('FPDFPathSegment_GetType', seg); // 0 line, 1 bezier, 2 move
        const prev = pts.at(-1);
        if (prev && type !== 2 && rects.some((r) => segmentHits(prev, pt, r))) {
          leaks.push({ page, kind: 'path', detail: `segment ${String(i)}` });
          return;
        }
        // Bezier control points: the polygon through them contains the curve.
        pts.push(pt);
      }
    });
    // A filled area covering a rectangle with no edge inside it (a big box behind it).
    const fill = this.floats(2, 4, (p) => {
      if (!this.call('FPDFPath_GetDrawMode', obj, p, p + 4)) return 0;
      return this.heap.getValue(p, 'i32');
    });
    if (fill !== 0 && pts.length > 2)
      for (const r of rects) {
        const cx = (r[0] + r[2]) / 2;
        const cy = (r[1] + r[3]) / 2;
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, yi] = pts[i] ?? [0, 0];
          const [xj, yj] = pts[j] ?? [0, 0];
          if (yi > cy !== yj > cy && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi)
            inside = !inside;
        }
        if (inside) {
          leaks.push({ page, kind: 'path', detail: 'filled area covers the rect' });
          return;
        }
      }
  }

  private imageHits(
    page: number,
    obj: number,
    m: M,
    rects: Rect[],
    _doc: number,
    _pagePtr: number,
    leaks: Leak[],
  ) {
    const bmp = this.call('FPDFImageObj_GetBitmap', obj);
    if (!bmp) {
      leaks.push({ page, kind: 'image', detail: 'image in rect (no bitmap)' });
      return;
    }
    try {
      const w = this.call('FPDFBitmap_GetWidth', bmp);
      const h = this.call('FPDFBitmap_GetHeight', bmp);
      const stride = this.call('FPDFBitmap_GetStride', bmp);
      const fmt = this.call('FPDFBitmap_GetFormat', bmp); // 1 gray, 2 BGR, 3 BGRx, 4 BGRA
      const bpp = fmt === 1 ? 1 : fmt === 2 ? 3 : 4;
      const buf = this.call('FPDFBitmap_GetBuffer', bmp);
      const inv = invert(m);
      if (!inv) return;
      // Image space: the unit square, y up; row 0 of the bitmap is the top.
      const colors = new Set<string>();
      for (const r of rects) {
        const c = [
          apply(inv, r[0] + EPS, r[1] + EPS),
          apply(inv, r[2] - EPS, r[1] + EPS),
          apply(inv, r[0] + EPS, r[3] - EPS),
          apply(inv, r[2] - EPS, r[3] - EPS),
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
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            const at = buf + y * stride + x * bpp;
            colors.add(Array.from(this.heap.HEAPU8.subarray(at, at + Math.min(bpp, 3))).join(','));
          }
      }
      if (colors.size > 1)
        leaks.push({ page, kind: 'image', detail: `${String(colors.size)} colours inside rect` });
    } finally {
      this.call('FPDFBitmap_Destroy', bmp);
    }
  }

  /** Annotations (other than popups) whose rectangle overlaps a redacted one. */
  annotsInRects(page: number, pagePtr: number, rects: Rect[], leaks: Leak[]) {
    const n = this.call('FPDFPage_GetAnnotCount', pagePtr);
    this.floats(4, 4, (p) => {
      for (let i = 0; i < n; i++) {
        const a = this.call('FPDFPage_GetAnnot', pagePtr, i);
        try {
          const sub = this.call('FPDFAnnot_GetSubtype', a);
          if (sub === 16 /* popup */ || !this.call('FPDFAnnot_GetRect', a, p)) continue;
          const [l, t, r, b] = [0, 1, 2, 3].map((k) => this.heap.getValue(p + k * 4, 'float'));
          const box: Rect = [l ?? 0, Math.min(b ?? 0, t ?? 0), r ?? 0, Math.max(b ?? 0, t ?? 0)];
          if (rects.some((rc) => overlaps(box, rc)))
            leaks.push({ page, kind: 'annotation', detail: `subtype ${String(sub)}` });
        } finally {
          this.call('FPDFPage_CloseAnnot', a);
        }
      }
    });
  }

  /** Every text a user can search or read: page text, annotation contents, bookmarks, info. */
  documentText(docPtr: number): string {
    const parts: string[] = [];
    const pages = this.call('FPDF_GetPageCount', docPtr);
    for (let i = 0; i < pages; i++) {
      const page = this.call('FPDF_LoadPage', docPtr, i);
      const tp = this.call('FPDFText_LoadPage', page);
      const n = this.call('FPDFText_CountChars', tp);
      this.floats(n + 1, 2, (p) => {
        this.call('FPDFText_GetText', tp, 0, n, p);
        parts.push(this.heap.UTF16ToString(p));
      });
      this.call('FPDFText_ClosePage', tp);
      const an = this.call('FPDFPage_GetAnnotCount', page);
      for (let k = 0; k < an; k++) {
        const a = this.call('FPDFPage_GetAnnot', page, k);
        parts.push(
          this.wide((b, l) => rawCall(this.mod, 'FPDFAnnot_GetStringValue', a, 'Contents', b, l)),
        );
        this.call('FPDFPage_CloseAnnot', a);
      }
      this.call('FPDF_ClosePage', page);
    }
    let bm = this.call('FPDFBookmark_GetFirstChild', docPtr, 0);
    let guard = 0;
    while (bm && guard++ < 10_000) {
      parts.push(this.wide((b, l) => this.call('FPDFBookmark_GetTitle', bm, b, l)));
      bm = this.call('FPDFBookmark_GetNextSibling', docPtr, bm);
    }
    for (const key of ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer'])
      parts.push(this.wide((b, l) => rawCall(this.mod, 'FPDF_GetMetaText', docPtr, key, b, l)));
    return parts.join('\n');
  }

  private wide(read: (buf: number, len: number) => number): string {
    const len = read(0, 0);
    if (len <= 2) return '';
    return this.floats(len + 2, 1, (p) => {
      read(p, len + 2);
      return this.heap.UTF16ToString(p);
    });
  }
}
