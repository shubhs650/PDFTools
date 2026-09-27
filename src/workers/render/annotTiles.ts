// Annotation tiles (M3-05, ADR-014 decision 3): a transparent tile holding only
// the markups whose rect meets it, each drawn from its own appearance stream
// with EPDF_RenderAnnotBitmap through the tile's matrix. PDFium's own
// "annotations" render flag re-parses every annotation of the page for every
// tile (330–410 ms per tile with 1,000 markups); this costs 0.2–3.5 ms and
// stays bounded at any zoom. No appearance code of ours (B7).
//
// Coordinates follow EmbedPDF's (pages loaded rotation-normalized): device
// space is top-left, in points, relative to the crop box's lower-left corner.
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { acquirePage, rawCall } from './pdfium';

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  getValue(ptr: number, type: 'float' | 'i32'): number;
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  UTF16ToString(ptr: number): string;
}

/** An annotation's box in device space (top-left, points) and what the tile needs to know. */
export interface AnnotBox {
  index: number;
  nm: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Page geometry from EmbedPDF's page object: size and crop-box origin. */
export interface PageFrame {
  height: number;
  originX: number;
  originY: number;
}

// FPDF_ANNOT_* subtypes we never draw in annotation tiles: links (the link
// layer), popups (never drawn), widgets (form fields have their own layer).
const SKIP_SUBTYPES = new Set([2, 16, 20]);
// Annotation flags: Hidden (bit 2), NoView (bit 6).
const HIDDEN = 1 << 1;
const NO_VIEW = 1 << 5;

function readNm(mod: WrappedPdfiumModule, annot: number): string {
  const heap = mod.pdfium as unknown as Heap;
  const len = rawCall(mod, 'FPDFAnnot_GetStringValue', annot, 'NM', 0, 0);
  if (len <= 2) return '';
  const ptr = heap.wasmExports.malloc(len + 2);
  try {
    rawCall(mod, 'FPDFAnnot_GetStringValue', annot, 'NM', ptr, len + 2);
    return heap.UTF16ToString(ptr);
  } finally {
    heap.wasmExports.free(ptr);
  }
}

/** The drawable annotations of a page, with their boxes (cached by the caller). */
export function annotBoxes(
  mod: WrappedPdfiumModule,
  pagePtr: number,
  frame: PageFrame,
): AnnotBox[] {
  const heap = mod.pdfium as unknown as Heap;
  const buf = heap.wasmExports.malloc(16);
  const out: AnnotBox[] = [];
  try {
    const n = rawCall(mod, 'FPDFPage_GetAnnotCount', pagePtr);
    for (let i = 0; i < n; i++) {
      const a = rawCall(mod, 'FPDFPage_GetAnnot', pagePtr, i);
      if (!a) continue;
      try {
        if (SKIP_SUBTYPES.has(rawCall(mod, 'FPDFAnnot_GetSubtype', a))) continue;
        if (rawCall(mod, 'FPDFAnnot_GetFlags', a) & (HIDDEN | NO_VIEW)) continue;
        if (!rawCall(mod, 'EPDFAnnot_GetRect', a, buf)) continue;
        const f = (k: number) => heap.getValue(buf + 4 * k, 'float');
        const [left, top, right, bottom] = [f(0), f(1), f(2), f(3)];
        out.push({
          index: i,
          nm: readNm(mod, a),
          x0: Math.min(left, right) - frame.originX,
          x1: Math.max(left, right) - frame.originX,
          y0: frame.height - (Math.max(top, bottom) - frame.originY),
          y1: frame.height - (Math.min(top, bottom) - frame.originY),
        });
      } finally {
        rawCall(mod, 'FPDFPage_CloseAnnot', a);
      }
    }
  } finally {
    heap.wasmExports.free(buf);
  }
  return out;
}

export interface AnnotTileRequest {
  pageIndex: number;
  /** The tile in device space: top-left corner and size, in points. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Output size in pixels. */
  width: number;
  height: number;
  /** Annotation ids to leave out (selected or being edited: the plugin layer draws those). */
  exclude: readonly string[];
}

/**
 * The tile's RGBA pixels (straight alpha, transparent where no markup is), or
 * null when no drawable markup meets the tile (nothing to draw or encode).
 */
export function renderAnnotTile(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  docId: string,
  boxes: readonly AnnotBox[],
  req: AnnotTileRequest,
): { data: Uint8ClampedArray<ArrayBuffer>; drawn: number } | null {
  const skip = new Set(req.exclude);
  const hits = boxes.filter(
    (b) =>
      !skip.has(b.nm) &&
      b.x1 >= req.x &&
      b.x0 <= req.x + req.w &&
      b.y1 >= req.y &&
      b.y0 <= req.y + req.h,
  );
  if (hits.length === 0) return null;
  const heap = mod.pdfium as unknown as Heap;
  const ref = acquirePage(native, docId, req.pageIndex);
  const bytes = req.width * req.height * 4;
  const px = heap.wasmExports.malloc(bytes);
  const m = heap.wasmExports.malloc(24);
  const bmp = rawCall(mod, 'FPDFBitmap_CreateEx', req.width, req.height, 4, px, req.width * 4);
  let drawn = 0;
  try {
    rawCall(mod, 'FPDFBitmap_FillRect', bmp, 0, 0, req.width, req.height, 0);
    const sx = req.width / req.w;
    const sy = req.height / req.h;
    heap.HEAPF32.set([sx, 0, 0, sy, -req.x * sx, -req.y * sy], m / 4);
    for (const b of hits) {
      const a = rawCall(mod, 'FPDFPage_GetAnnot', ref.pagePtr, b.index);
      if (!a) continue;
      try {
        // Mode 0: the normal appearance; flags 16: RGBA byte order (as EmbedPDF).
        if (rawCall(mod, 'EPDF_RenderAnnotBitmap', bmp, ref.pagePtr, a, 0, m, 16)) drawn++;
      } finally {
        rawCall(mod, 'FPDFPage_CloseAnnot', a);
      }
    }
    return { data: new Uint8ClampedArray(heap.HEAPU8.slice(px, px + bytes).buffer), drawn };
  } finally {
    rawCall(mod, 'FPDFBitmap_Destroy', bmp);
    heap.wasmExports.free(m);
    heap.wasmExports.free(px);
    ref.release();
  }
}

/** Per document and page: the boxes, dropped on any change to the document. */
export class AnnotBoxCache {
  private readonly docs = new Map<string, Map<number, AnnotBox[]>>();

  get(docId: string, pageIndex: number, make: () => AnnotBox[]): AnnotBox[] {
    let pages = this.docs.get(docId);
    if (!pages) {
      pages = new Map();
      this.docs.set(docId, pages);
    }
    let boxes = pages.get(pageIndex);
    if (!boxes) {
      boxes = make();
      pages.set(pageIndex, boxes);
    }
    return boxes;
  }

  drop(docId: string): void {
    this.docs.delete(docId);
  }
}
