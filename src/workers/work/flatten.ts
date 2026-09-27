// Export Print-Ready PDF (D-25, §7.13, M2-16, ADR-013 decision 6): on a
// separate copy in the Work worker (the Render worker's document is never
// touched), each page's printable annotations and form fields are burned
// into its content with FPDFPage_Flatten (vector, as printed), then a full
// rewrite through our writer (ADR-005 decision 3), then /AcroForm and every
// object nothing reaches any more are dropped (model/printReady.ts).
// EmbedPDF's preparePrintDocument is not used: its copy loses the markups.
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../../engine/errors';
import { allows } from '../../model/permissions';
import { prunePrintReady, PrintReadyFormatError } from '../../model/printReady';
import { rawCall } from '../render/pdfium';
import { FPDF_NO_INCREMENTAL, saveWithFlags } from '../render/save/writer';
import type { JobSlice } from './scheduler';

const FLAT_PRINT = 1;
const FLATTEN_FAIL = 0;
const FPDF_ANNOT_WIDGET = 20;

export interface FlattenOptions {
  /** Page indexes to keep (null: every page). Kept pages stay in document order. */
  pages: readonly number[] | null;
  /** 'off': only form fields are burned in; other annotations are dropped first. */
  markups: 'on' | 'off';
}

/** Removes every annotation but form widgets from an open page. */
function dropMarkups(mod: WrappedPdfiumModule, page: number): void {
  for (let k = rawCall(mod, 'FPDFPage_GetAnnotCount', page) - 1; k >= 0; k--) {
    const annot = rawCall(mod, 'FPDFPage_GetAnnot', page, k);
    if (!annot) continue;
    const subtype = rawCall(mod, 'FPDFAnnot_GetSubtype', annot);
    rawCall(mod, 'FPDFPage_CloseAnnot', annot);
    if (subtype !== FPDF_ANNOT_WIDGET) rawCall(mod, 'FPDFPage_RemoveAnnot', page, k);
  }
}

/**
 * Flattens the open document at `docPtr` (a throwaway copy: it is changed)
 * and returns the print-ready file. Cancellable between pages; progress
 * counts pages.
 */
export async function flattenCopy(
  mod: WrappedPdfiumModule,
  docPtr: number,
  opts: FlattenOptions,
  slice: JobSlice,
  progress: (p: { done: number; total: number }) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  // Rule 9: a print-ready copy is a way of printing.
  const security = {
    permissions: rawCall(mod, 'FPDF_GetDocPermissions', docPtr) >>> 0,
    revision: rawCall(mod, 'FPDF_GetSecurityHandlerRevision', docPtr),
  };
  if (!allows(security, 'print'))
    throw new RpcError('print-denied', 'The document does not allow printing');
  const count = rawCall(mod, 'FPDF_GetPageCount', docPtr);
  const keep = opts.pages ? new Set(opts.pages.filter((i) => i >= 0 && i < count)) : null;
  if (keep?.size === 0) throw new RpcError('page-out-of-range', 'No pages to export');
  const total = keep ? keep.size : count;
  let done = 0;
  progress({ done, total });
  for (let i = 0; i < count; i++) {
    if (keep && !keep.has(i)) continue;
    await slice.checkpoint();
    const page = rawCall(mod, 'FPDF_LoadPage', docPtr, i);
    if (!page) throw new RpcError('page-not-loaded', 'The page could not be loaded');
    try {
      if (opts.markups === 'off') dropMarkups(mod, page);
      if (rawCall(mod, 'FPDFPage_Flatten', page, FLAT_PRINT) === FLATTEN_FAIL)
        throw new RpcError('flatten-failed', 'The page could not be flattened');
    } finally {
      rawCall(mod, 'FPDF_ClosePage', page);
    }
    progress({ done: ++done, total });
  }
  if (keep) {
    for (let i = count - 1; i >= 0; i--)
      if (!keep.has(i)) rawCall(mod, 'FPDFPage_Delete', docPtr, i);
  }
  await slice.checkpoint();
  const rewritten = saveWithFlags(mod, docPtr, FPDF_NO_INCREMENTAL);
  try {
    return prunePrintReady(rewritten).bytes;
  } catch (err) {
    if (err instanceof PrintReadyFormatError)
      throw new RpcError('print-ready-format', 'The flattened copy could not be finished');
    throw err;
  }
}
