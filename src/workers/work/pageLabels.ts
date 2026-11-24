// The PDF's page labels (/PageLabels, e.g. "A-101" or "iv") for the pages
// asked (M13-07, D-71: a CRS template's Page label field and its sheet-per-
// page names, C5). Null for a page without a label. Read with PDFium's
// FPDF_GetPageLabel (UTF-16LE, length in bytes with the terminator).
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { rawCall } from '../render/pdfium';

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
}

export function readPageLabels(
  mod: WrappedPdfiumModule,
  docPtr: number,
  pages: readonly number[],
): (string | null)[] {
  const heap = mod.pdfium as unknown as Heap;
  const decoder = new TextDecoder('utf-16le');
  return pages.map((page) => {
    const len = rawCall(mod, 'FPDF_GetPageLabel', docPtr, page, 0, 0);
    if (len <= 2) return null;
    const buf = heap.wasmExports.malloc(len);
    try {
      rawCall(mod, 'FPDF_GetPageLabel', docPtr, page, buf, len);
      const label = decoder.decode(heap.HEAPU8.slice(buf, buf + len - 2)).trim();
      return label === '' ? null : label;
    } finally {
      heap.wasmExports.free(buf);
    }
  });
}
