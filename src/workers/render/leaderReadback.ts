// A Line annotation read from a file carries its leader lines (M13-10): /LL,
// /LLE and /LLO become the object's `leader` field (model/dimension.ts), so a
// Distance drawn as a dimension, here or in another editor, keeps them when it
// is edited. Installed in both the Render worker and the Work worker (which
// lists every annotation for the annotation plugin, ADR-014 decision 2).
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { leaderFromFile } from '../../model/dimension';
import { rawCall } from './pdfium';

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  getValue(ptr: number, t: 'float'): number;
}

/** A number entry of the annotation's dictionary, or undefined. */
export function readNumber(
  mod: WrappedPdfiumModule,
  annot: number,
  key: string,
): number | undefined {
  const heap = mod.pdfium as unknown as Heap;
  const buf = heap.wasmExports.malloc(4);
  try {
    return rawCall(mod, 'FPDFAnnot_GetNumberValue', annot, key, buf)
      ? heap.getValue(buf, 'float')
      : undefined;
  } finally {
    heap.wasmExports.free(buf);
  }
}

interface LineReader {
  readPdfLineAnno?: (doc: unknown, page: unknown, annot: number, index: unknown) => unknown;
}

/** A Line annotation read from the file carries its leader lines (`leader`), if it has any. */
export function installLeaderReadback(mod: WrappedPdfiumModule, native: unknown): void {
  const n = native as LineReader;
  if (typeof n.readPdfLineAnno !== 'function') return;
  const read = n.readPdfLineAnno.bind(n);
  n.readPdfLineAnno = (doc, page, annot, index) => {
    const out = read(doc, page, annot, index);
    if (typeof out !== 'object' || out === null) return out;
    const leader = leaderFromFile(
      readNumber(mod, annot, 'LL'),
      readNumber(mod, annot, 'LLE'),
      readNumber(mod, annot, 'LLO'),
    );
    return leader ? { ...out, leader } : out;
  };
}
