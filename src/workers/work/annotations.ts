// Every annotation of a document, for plugin-annotation's store (M3-05,
// ADR-014 decision 2): listed on the Work worker's read-only copy instead of
// the Render queue, where the plugin's own getAllAnnotations blocked visible
// tiles. At load time the copy is the document (original + committed tails).
//
// An annotation without /NM gets a deterministic id before EmbedPDF's reader
// would invent a random one: `obj-<object number>` (or `idx-<page>-<index>`
// for a direct object). The Render worker resolves such an id the same way
// and writes it as /NM before the first edit that targets it (annotId.ts), so
// the edit also persists it (ADR-005 consequence).
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { PdfAnnotationObject, PdfDocumentObject } from '@embedpdf/models';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { acquirePage, rawCall, withWideString } from '../render/pdfium';
import { stableAnnotId } from '../shared/annotId';
import type { JobSlice } from './scheduler';

/** Pages per engine call: small enough that a checkpoint comes every few tens of ms. */
const BATCH = 50;

/** Gives every /NM-less annotation on the page its stable id (in this copy's memory only). */
export function nameAnnotations(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  docId: string,
  pageIndex: number,
): number {
  const ref = acquirePage(native, docId, pageIndex);
  let named = 0;
  try {
    const n = rawCall(mod, 'FPDFPage_GetAnnotCount', ref.pagePtr);
    for (let i = 0; i < n; i++) {
      const a = rawCall(mod, 'FPDFPage_GetAnnot', ref.pagePtr, i);
      if (!a) continue;
      try {
        if (rawCall(mod, 'FPDFAnnot_HasKey', a, 'NM')) continue;
        const id = stableAnnotId(rawCall(mod, 'EPDFAnnot_GetObjectNumber', a), pageIndex, i);
        withWideString(mod, id, (ptr) => rawCall(mod, 'FPDFAnnot_SetStringValue', a, 'NM', ptr));
        named++;
      } finally {
        rawCall(mod, 'FPDFPage_CloseAnnot', a);
      }
    }
  } finally {
    ref.release();
  }
  return named;
}

export async function listAnnotations(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  doc: PdfDocumentObject,
  slice: JobSlice,
  progress: (p: { done: number; total: number }) => void,
): Promise<Record<number, PdfAnnotationObject[]>> {
  const out: Record<number, PdfAnnotationObject[]> = {};
  const total = doc.pages.length;
  for (let from = 0; from < total; from += BATCH) {
    await slice.checkpoint();
    const pages = doc.pages.slice(from, from + BATCH);
    for (const p of pages) nameAnnotations(mod, native, doc.id, p.index);
    Object.assign(out, await native.getAnnotationsBatch(doc, pages).toPromise());
    progress({ done: Math.min(total, from + BATCH), total });
  }
  return out;
}
