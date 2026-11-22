// The overlay's screen tiles (M12-11, D-59, ADR-032 S29, ARCHITECTURE §3.1:
// "the Render worker supplies the screen tiles of both revisions, the old one
// through the alignment matrix"). Each revision's page content is rendered
// straight to an 8-bit grey bitmap through a matrix (direct PDFium calls,
// D-09), without comments (no FPDF_ANNOT flag, Q10); the two are tinted and
// multiplied with the style's lookup tables; each side's comments are then
// drawn on top from their own appearance streams (as the annotation tiles do,
// M3-05), through the same matrix, unless switched off. The grey tiles are
// cached under a byte cap (S29 risk 2), so a style change only re-composes.
//
// Coordinates: the Render worker's pages are laid out unturned (EmbedPDF opens
// documents with normalized rotation). `frameOf` gives the turn from that
// layout to the displayed page, so A and B are drawn in displayed space like
// the comparison's material (M12-07).
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { AbortError, RpcError } from '../../engine/errors';
import { ByteCache } from '../../model/compare/byteCache';
import { thenAffine, type Affine } from '../../model/compare/material';
import {
  compose,
  crop,
  over,
  styleKey,
  styleTables,
  thicken,
  type OverlayStyle,
  type StyleTables,
} from '../../model/compare/overlay';
import { tileMatrix } from '../../model/compare/overlayView';
import { frameOf } from '../work/compareMaterial';
import { annotBoxes, type AnnotBox } from './annotTiles';
import { acquirePage, docPtrOf, rawCall } from './pdfium';

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  getValue(ptr: number, type: 'float' | 'i32'): number;
}

const heapOf = (mod: WrappedPdfiumModule): Heap => mod.pdfium as unknown as Heap;

const FPDFBitmap_Gray = 1;
const FPDFBitmap_BGRA = 4;
/** FPDF_ANNOT_HIGHLIGHT. */
const HIGHLIGHT = 9;
/** PdfBlendMode.Normal (EPDFAnnot_GetBlendMode). */
const BLEND_NORMAL = 0;
/** Hide check highlights (Q11): Highlight comments and anything below this opacity. */
export const CHECK_OPACITY = 0.7;
/** Pixels the grey tiles may hold (S29: up to 90 MB uncapped after one zoom gesture). */
export const GREY_CACHE_BYTES = 48 * 1024 * 1024;
/** Largest tile side the worker draws. */
const MAX_TILE = 2048;

/** One revision of a sheet. */
export interface OverlaySide {
  docId: string;
  pageIndex: number;
  /** A's displayed space → the sheet's frame (B's displayed space); identity for B. */
  place: Affine;
  /** The document's edit count: a change draws its tiles anew. */
  version: number;
}

export interface OverlayTileRequest {
  /** Document A's page (null: the sheet was added in B). */
  a: OverlaySide | null;
  /** Document B's page (null: the sheet was removed from A). */
  b: OverlaySide | null;
  /** Device pixels per point. */
  scale: number;
  /** The tile's top-left corner and size in device pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  style: OverlayStyle;
  thicken: boolean;
  /** Comments of each side on top (Q10), and Hide check highlights (Q11). */
  comments: { a: boolean; b: boolean; hideChecks: boolean };
}

/** A page's displayed size in points (/Rotate and crop box applied). */
export function displayedSize(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  docId: string,
  pageIndex: number,
): { width: number; height: number } {
  const ref = acquirePage(native, docId, pageIndex);
  try {
    const f = frameOf(mod, docPtrOf(native, docId), pageIndex, ref.pagePtr);
    return { width: f.width, height: f.height };
  } finally {
    ref.release();
  }
}

/** Renders a loaded page's content through `m` (layout → pixels) into an 8-bit grey picture. */
function renderGrey(
  mod: WrappedPdfiumModule,
  page: number,
  m: Affine,
  w: number,
  h: number,
): Uint8Array {
  const heap = heapOf(mod);
  const stride = (w + 3) & ~3;
  const px = heap.wasmExports.malloc(stride * h);
  const mp = heap.wasmExports.malloc(24 + 16);
  const cp = mp + 24;
  const bmp = rawCall(mod, 'FPDFBitmap_CreateEx', w, h, FPDFBitmap_Gray, px, stride);
  try {
    if (!bmp) throw new RpcError('overlay-memory', 'The overlay tile could not be allocated');
    rawCall(mod, 'FPDFBitmap_FillRect', bmp, 0, 0, w, h, 0xffffffff);
    heap.HEAPF32.set(m, mp >> 2);
    heap.HEAPF32.set([0, 0, w, h], cp >> 2);
    // No FPDF_ANNOT: comments are not part of the comparison (Q10).
    rawCall(mod, 'FPDF_RenderPageBitmapWithMatrix', bmp, page, mp, cp, 0);
    const src = heapOf(mod).HEAPU8; // read after the render: the heap may have grown
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) out.set(src.subarray(px + y * stride, px + y * stride + w), y * w);
    return out;
  } finally {
    if (bmp) rawCall(mod, 'FPDFBitmap_Destroy', bmp);
    heap.wasmExports.free(mp);
    heap.wasmExports.free(px);
  }
}

/** The crop box's lower-left corner and the layout height (the annotation tiles' frame). */
function annotFrame(
  mod: WrappedPdfiumModule,
  page: number,
): { height: number; originX: number; originY: number } {
  const heap = heapOf(mod);
  const buf = heap.wasmExports.malloc(16);
  try {
    const f = (k: number): number => heap.getValue(buf + 4 * k, 'float');
    let has = rawCall(mod, 'FPDFPage_GetCropBox', page, buf, buf + 4, buf + 8, buf + 12);
    if (!has) has = rawCall(mod, 'FPDFPage_GetMediaBox', page, buf, buf + 4, buf + 8, buf + 12);
    const originX = has ? Math.min(f(0), f(2)) : 0;
    const originY = has ? Math.min(f(1), f(3)) : 0;
    return { height: rawCall(mod, 'FPDF_GetPageHeightF', page), originX, originY };
  } finally {
    heap.wasmExports.free(buf);
  }
}

interface PageComments {
  boxes: AnnotBox[];
  /**
   * Indexes of check highlights: Highlight comments, and comments below
   * CHECK_OPACITY opacity or drawn with a blend mode (a Multiply marker).
   */
  checks: Set<number>;
}

function readComments(mod: WrappedPdfiumModule, page: number): PageComments {
  const boxes = annotBoxes(mod, page, annotFrame(mod, page));
  const heap = heapOf(mod);
  const buf = heap.wasmExports.malloc(4);
  const checks = new Set<number>();
  try {
    for (const b of boxes) {
      const a = rawCall(mod, 'FPDFPage_GetAnnot', page, b.index);
      if (!a) continue;
      try {
        const highlight = rawCall(mod, 'FPDFAnnot_GetSubtype', a) === HIGHLIGHT;
        // The opacity as EmbedPDF reads it: an alpha of 0 … 255.
        const opacity = rawCall(mod, 'EPDFAnnot_GetOpacity', a, buf)
          ? heap.getValue(buf, 'i32') / 255
          : 1;
        // A blend mode (a Multiply marker over the drawing) is see-through too.
        const blended = rawCall(mod, 'EPDFAnnot_GetBlendMode', a) !== BLEND_NORMAL;
        if (highlight || blended || opacity < CHECK_OPACITY) checks.add(b.index);
      } finally {
        rawCall(mod, 'FPDFPage_CloseAnnot', a);
      }
    }
  } finally {
    heap.wasmExports.free(buf);
  }
  return { boxes, checks };
}

/** Draws a page's comments that meet the tile through `m` (layout → pixels) into RGBA. */
function renderComments(
  mod: WrappedPdfiumModule,
  page: number,
  comments: PageComments,
  m: Affine,
  w: number,
  h: number,
  hideChecks: boolean,
): Uint8ClampedArray | null {
  const corner = (x: number, y: number): [number, number] => [
    m[0] * x + m[2] * y + m[4],
    m[1] * x + m[3] * y + m[5],
  ];
  const hits = comments.boxes.filter((b) => {
    if (hideChecks && comments.checks.has(b.index)) return false;
    const pts = [corner(b.x0, b.y0), corner(b.x1, b.y0), corner(b.x0, b.y1), corner(b.x1, b.y1)];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return (
      Math.max(...xs) >= 0 && Math.min(...xs) <= w && Math.max(...ys) >= 0 && Math.min(...ys) <= h
    );
  });
  if (hits.length === 0) return null;
  const heap = heapOf(mod);
  const bytes = w * h * 4;
  const px = heap.wasmExports.malloc(bytes);
  const mp = heap.wasmExports.malloc(24);
  const bmp = rawCall(mod, 'FPDFBitmap_CreateEx', w, h, FPDFBitmap_BGRA, px, w * 4);
  try {
    if (!bmp) return null;
    rawCall(mod, 'FPDFBitmap_FillRect', bmp, 0, 0, w, h, 0);
    heap.HEAPF32.set(m, mp >> 2);
    for (const b of hits) {
      const a = rawCall(mod, 'FPDFPage_GetAnnot', page, b.index);
      if (!a) continue;
      try {
        // Mode 0: the normal appearance; flags 16: RGBA byte order (as the annotation tiles).
        rawCall(mod, 'EPDF_RenderAnnotBitmap', bmp, page, a, 0, mp, 16);
      } finally {
        rawCall(mod, 'FPDFPage_CloseAnnot', a);
      }
    }
    return new Uint8ClampedArray(heapOf(mod).HEAPU8.slice(px, px + bytes).buffer);
  } finally {
    if (bmp) rawCall(mod, 'FPDFBitmap_Destroy', bmp);
    heap.wasmExports.free(mp);
    heap.wasmExports.free(px);
  }
}

/** The overlay tiles of every open comparison: the grey-tile cache and the current style. */
export class OverlayTiles {
  private readonly grey = new ByteCache<Uint8Array>(GREY_CACHE_BYTES);
  /** Per document page: its comments as of a version. */
  private readonly comments = new Map<string, PageComments & { version: number }>();
  private tables: { key: string; tables: StyleTables } | null = null;

  /** Bytes the grey tiles hold (tests and the perf report). */
  get cachedBytes(): number {
    return this.grey.bytes;
  }

  /** Forgets a document's tiles (closed, or changed by a page operation). */
  drop(docId: string): void {
    this.grey.dropPrefix(`${docId}\n`);
    for (const k of this.comments.keys()) if (k.startsWith(`${docId}\n`)) this.comments.delete(k);
  }

  clear(): void {
    this.grey.clear();
    this.comments.clear();
    this.tables = null;
  }

  private tablesFor(style: OverlayStyle): StyleTables {
    const key = styleKey(style);
    if (this.tables?.key !== key) this.tables = { key, tables: styleTables(style) };
    return this.tables.tables;
  }

  /** The composed tile, as opaque RGBA. */
  render(
    mod: WrappedPdfiumModule,
    native: PdfiumNative,
    r: OverlayTileRequest,
    signal?: AbortSignal,
  ): Uint8ClampedArray<ArrayBuffer> {
    const { width: w, height: h } = r;
    if (!(w >= 1 && h >= 1 && w <= MAX_TILE && h <= MAX_TILE) || !(r.scale > 0))
      throw new RpcError('overlay-tile-size', 'The overlay tile is too large');
    const sides = [r.a, r.b] as const;
    const pages = sides.map((s) => (s ? acquirePage(native, s.docId, s.pageIndex) : null));
    try {
      // Layout → tile pixels for each side: the turn to displayed space, the placement, the tile.
      const matrices = sides.map((s, i) => {
        const ref = pages[i];
        if (!s || !ref) return null;
        const f = frameOf(mod, docPtrOf(native, s.docId), s.pageIndex, ref.pagePtr);
        return thenAffine(f.turn, tileMatrix(r.scale, r.x, r.y, s.place));
      });
      const greys = sides.map((s, i) => {
        const ref = pages[i];
        const m = matrices[i];
        if (!s || !ref || !m) return null;
        const key = [
          s.docId,
          s.pageIndex,
          s.version,
          r.scale,
          r.x,
          r.y,
          w,
          h,
          s.place.join(','),
          r.thicken ? 1 : 0,
        ].join('\n');
        const hit = this.grey.get(key);
        if (hit) return hit;
        if (signal?.aborted) throw new AbortError();
        let g: Uint8Array;
        if (r.thicken) {
          // One pixel of margin so neighbouring tiles join without seams (S29).
          const mg: Affine = [m[0], m[1], m[2], m[3], m[4] + 1, m[5] + 1];
          g = crop(
            thicken(renderGrey(mod, ref.pagePtr, mg, w + 2, h + 2), w + 2, h + 2),
            w + 2,
            1,
            w,
            h,
          );
        } else g = renderGrey(mod, ref.pagePtr, m, w, h);
        this.grey.set(key, g, g.length);
        return g;
      });
      const out = compose(greys[0] ?? null, greys[1] ?? null, w, h, this.tablesFor(r.style));
      sides.forEach((s, i) => {
        const ref = pages[i];
        const m = matrices[i];
        const shown = i === 0 ? r.comments.a && r.style.showA : r.comments.b && r.style.showB;
        if (!s || !ref || !m || !shown) return;
        const ck = `${s.docId}\n${String(s.pageIndex)}`;
        let c = this.comments.get(ck);
        if (c?.version !== s.version) {
          c = { ...readComments(mod, ref.pagePtr), version: s.version };
          this.comments.set(ck, c);
        }
        const layer = renderComments(mod, ref.pagePtr, c, m, w, h, r.comments.hideChecks);
        if (layer) over(out, layer);
      });
      return out;
    } finally {
      for (const p of pages) p?.release();
    }
  }
}
