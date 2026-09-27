// M3-01: "annotation tiles" — for one 256 px tile, draw only the markups whose
// rect intersects it (EPDF_RenderAnnotBitmap with the tile's matrix), instead
// of PDFium's FPDF_ANNOT flag, which re-parses every annotation of the page on
// every render call. Checked against PDFium's own full render.
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { acquirePage, rawCall } from '../../src/workers/render/pdfium.ts';

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  getValue(ptr: number, type: 'float'): number;
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
}

export interface AnnotBox {
  index: number;
  l: number;
  b: number;
  r: number;
  t: number;
}

/** Every annotation's /Rect on a page (PDF user space), read once and cached by the caller. */
export function annotBoxes(mod: WrappedPdfiumModule, pagePtr: number): AnnotBox[] {
  const heap = mod.pdfium as unknown as Heap;
  const buf = heap.wasmExports.malloc(16);
  const out: AnnotBox[] = [];
  const n = rawCall(mod, 'FPDFPage_GetAnnotCount', pagePtr);
  for (let i = 0; i < n; i++) {
    const a = rawCall(mod, 'FPDFPage_GetAnnot', pagePtr, i);
    if (!a) continue;
    if (rawCall(mod, 'FPDFAnnot_GetRect', a, buf)) {
      const f = (k: number) => heap.getValue(buf + 4 * k, 'float');
      out.push({ index: i, l: f(0), t: f(1), r: f(2), b: f(3) });
    }
    rawCall(mod, 'FPDFPage_CloseAnnot', a);
  }
  heap.wasmExports.free(buf);
  return out;
}

/**
 * A 256-px RGBA tile of the page's markups only (transparent elsewhere).
 * `x`, `y`: the tile's top-left in page points (top-left origin), `scale`: px per point.
 */
export function renderAnnotTile(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  docId: string,
  boxes: readonly AnnotBox[],
  pageHeight: number,
  x: number,
  y: number,
  scale: number,
  size = 256,
  pageIndex = 0,
): { data: Uint8Array; drawn: number } {
  const heap = mod.pdfium as unknown as Heap;
  const ref = acquirePage(native, docId, pageIndex);
  const bytes = size * size * 4;
  const px = heap.wasmExports.malloc(bytes);
  const bmp = rawCall(mod, 'FPDFBitmap_CreateEx', size, size, 4, px, size * 4);
  rawCall(mod, 'FPDFBitmap_FillRect', bmp, 0, 0, size, size, 0);
  const m = heap.wasmExports.malloc(24);
  // PDFium applies the page's display matrix first (top-left origin, y down,
  // as EmbedPDF's buildUserToDeviceMatrix assumes): page points → tile pixels.
  heap.HEAPF32.set([scale, 0, 0, scale, -x * scale, -y * scale], m / 4);
  // The tile in user space.
  const tl = x;
  const tr = x + size / scale;
  const tt = pageHeight - y;
  const tb = pageHeight - y - size / scale;
  let drawn = 0;
  try {
    for (const box of boxes) {
      if (box.r < tl || box.l > tr || box.t < tb || box.b > tt) continue;
      const a = rawCall(mod, 'FPDFPage_GetAnnot', ref.pagePtr, box.index);
      if (!a) continue;
      try {
        // Mode 0 = normal appearance; flags 16 = reverse byte order (RGBA), as EmbedPDF.
        if (rawCall(mod, 'EPDF_RenderAnnotBitmap', bmp, ref.pagePtr, a, 0, m, 16)) drawn++;
      } finally {
        rawCall(mod, 'FPDFPage_CloseAnnot', a);
      }
    }
    return { data: heap.HEAPU8.slice(px, px + bytes), drawn };
  } finally {
    heap.wasmExports.free(m);
    rawCall(mod, 'FPDFBitmap_Destroy', bmp);
    heap.wasmExports.free(px);
    ref.release();
  }
}
