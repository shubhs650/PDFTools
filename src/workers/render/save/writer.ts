// FPDF_SaveAsCopy with explicit flags through our own FPDF_FILEWRITE (ADR-005
// decisions 1 and 3, ADR-001 B14). EmbedPDF's `saveAsCopy` has no flags
// argument and copies the result one byte at a time; here each block PDFium
// writes is copied out of the WASM heap in bulk.
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { concatBytes } from './bytes';

export const FPDF_INCREMENTAL = 1;
export const FPDF_NO_INCREMENTAL = 2;

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
  addFunction(fn: (...a: number[]) => number, sig: string): number;
  removeFunction(p: number): void;
}

type RawFn = (...a: number[]) => number;

export function saveWithFlags(
  mod: WrappedPdfiumModule,
  docPtr: number,
  flags: number,
): Uint8Array<ArrayBuffer> {
  const heap = mod.pdfium as unknown as Heap;
  const save = (mod as unknown as Record<string, RawFn | undefined>)['FPDF_SaveAsCopy'];
  if (!save) throw new Error('PDFium export FPDF_SaveAsCopy is missing');
  const chunks: Uint8Array[] = [];
  // HEAPU8 is re-read on every call: the heap may grow (and be replaced) while PDFium writes.
  const writeBlock = heap.addFunction((_self: number, data: number, size: number) => {
    chunks.push(heap.HEAPU8.slice(data, data + size));
    return 1;
  }, 'iiii');
  // struct FPDF_FILEWRITE { int version; int (*WriteBlock)(FPDF_FILEWRITE*, const void*, unsigned long); }
  const writer = heap.wasmExports.malloc(8);
  heap.HEAP32[writer >> 2] = 1;
  heap.HEAP32[(writer + 4) >> 2] = writeBlock;
  try {
    if (!save(docPtr, writer, flags))
      throw new Error(`FPDF_SaveAsCopy(flags=${String(flags)}) failed`);
  } finally {
    heap.wasmExports.free(writer);
    heap.removeFunction(writeBlock);
  }
  return concatBytes(chunks);
}
