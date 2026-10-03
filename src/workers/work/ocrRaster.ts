// The page raster for OCR (ADR-020 decision 3) in the Work worker: the page
// as displayed (its /Rotate applied) rendered by PDFium #2 to 8-bit gray at
// OCR_DPI, from the document as it is now; and the raster → page mapping the
// text layer needs (FPDF_DeviceToPage). Pages that already have a text layer
// are reported, not rendered (decision 5), unless the caller forces it (decision 11).
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../../engine/errors';
import { rawCall } from '../render/pdfium';

const FPDFBitmap_Gray = 1;
const WHITE = 0xffffffff;
/** Longest raster side PDFium is asked for (an A0 sheet at 300 dpi is 14,000 px). */
const MAX_SIDE = 16_000;

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
  getValue(ptr: number, t: 'double'): number;
}

export interface OcrRasterResult {
  /** The page has a text layer already: nothing rendered. */
  hasText: boolean;
  width: number;
  height: number;
  data: Uint8Array<ArrayBuffer>;
}

/** Characters PDFium extracts from the page: > 0 means a text layer exists. */
export function textChars(mod: WrappedPdfiumModule, page: number): number {
  const tp = rawCall(mod, 'FPDFText_LoadPage', page);
  if (!tp) return 0;
  try {
    return Math.max(0, rawCall(mod, 'FPDFText_CountChars', tp));
  } finally {
    rawCall(mod, 'FPDFText_ClosePage', tp);
  }
}

/** `force`: render a page that has a text layer too (the dialog's "also recognize" option). */
export function rasterForOcr(
  mod: WrappedPdfiumModule,
  docPtr: number,
  pageIndex: number,
  dpi: number,
  force = false,
): OcrRasterResult {
  const page = rawCall(mod, 'FPDF_LoadPage', docPtr, pageIndex);
  if (!page) throw new RpcError('page-not-loaded', 'The page could not be loaded');
  try {
    const hasText = textChars(mod, page) > 0;
    if (hasText && !force) return { hasText, width: 0, height: 0, data: new Uint8Array(0) };
    const scale = dpi / 72;
    const width = Math.max(1, Math.round(rawCall(mod, 'FPDF_GetPageWidthF', page) * scale));
    const height = Math.max(1, Math.round(rawCall(mod, 'FPDF_GetPageHeightF', page) * scale));
    if (width > MAX_SIDE || height > MAX_SIDE)
      throw new RpcError('ocr-page-size', 'The page is too large to recognize');
    const bmp = rawCall(mod, 'FPDFBitmap_CreateEx', width, height, FPDFBitmap_Gray, 0, 0);
    if (!bmp) throw new RpcError('ocr-memory', 'The page is too large to recognize');
    try {
      rawCall(mod, 'FPDFBitmap_FillRect', bmp, 0, 0, width, height, WHITE);
      rawCall(mod, 'FPDF_RenderPageBitmap', bmp, page, 0, 0, width, height, 0, 0);
      const buf = rawCall(mod, 'FPDFBitmap_GetBuffer', bmp);
      const stride = rawCall(mod, 'FPDFBitmap_GetStride', bmp);
      // HEAPU8 is read after the render (the heap may have grown).
      const heap = (mod.pdfium as unknown as Heap).HEAPU8;
      const data = new Uint8Array(width * height);
      for (let y = 0; y < height; y++)
        data.set(heap.subarray(buf + y * stride, buf + y * stride + width), y * width);
      return { hasText, width, height, data };
    } finally {
      rawCall(mod, 'FPDFBitmap_Destroy', bmp);
    }
  } finally {
    rawCall(mod, 'FPDF_ClosePage', page);
  }
}

/**
 * Raster pixel of a `width` × `height` render of the displayed page → the
 * page's unrotated user space, through FPDF_DeviceToPage on the loaded page
 * (which applies /Rotate and the page boxes). Call `release()` when done.
 */
export function pageMapper(
  mod: WrappedPdfiumModule,
  docPtr: number,
  pageIndex: number,
  width: number,
  height: number,
): { toPage(dx: number, dy: number): [number, number]; release(): void } {
  const page = rawCall(mod, 'FPDF_LoadPage', docPtr, pageIndex);
  if (!page) throw new RpcError('page-not-loaded', 'The page could not be loaded');
  const heap = mod.pdfium as unknown as Heap;
  const buf = heap.wasmExports.malloc(16);
  return {
    toPage: (dx, dy) => {
      rawCall(
        mod,
        'FPDF_DeviceToPage',
        page,
        0,
        0,
        width,
        height,
        0,
        Math.round(dx),
        Math.round(dy),
        buf,
        buf + 8,
      );
      return [heap.getValue(buf, 'double'), heap.getValue(buf + 8, 'double')];
    },
    release: () => {
      heap.wasmExports.free(buf);
      rawCall(mod, 'FPDF_ClosePage', page);
    },
  };
}
