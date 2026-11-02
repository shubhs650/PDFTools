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
import {
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
  type PdfDocumentObject,
} from '@embedpdf/models';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { readAnnotString } from '../render/annotTiles';
import { fileAttachmentColors } from '../render/fileAttach';
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

const FILE_ATTACHMENT = PdfAnnotationSubtype.FILEATTACHMENT;

// Line, polygon, polyline (PdfAnnotationSubtype and FPDF_ANNOT_* agree).
const GEOMETRY = new Set([4, 7, 8]);

/**
 * /IT of the page's lines, polygons and polylines by /NM (M3-16): EmbedPDF's
 * reader drops it for these types, so a saved measurement would come back as
 * a plain line. Called after nameAnnotations, so every annotation has a /NM.
 */
export function geometryIntents(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  docId: string,
  pageIndex: number,
): Map<string, string> {
  const out = new Map<string, string>();
  const heap = mod.pdfium as unknown as {
    UTF16ToString(ptr: number): string;
    wasmExports: { malloc(n: number): number; free(p: number): void };
  };
  const ref = acquirePage(native, docId, pageIndex);
  try {
    const n = rawCall(mod, 'FPDFPage_GetAnnotCount', ref.pagePtr);
    for (let i = 0; i < n; i++) {
      const a = rawCall(mod, 'FPDFPage_GetAnnot', ref.pagePtr, i);
      if (!a) continue;
      try {
        if (!GEOMETRY.has(rawCall(mod, 'FPDFAnnot_GetSubtype', a))) continue;
        const len = rawCall(mod, 'EPDFAnnot_GetIntent', a, 0, 0);
        if (!len) continue;
        const bytes = (len + 1) * 2;
        const ptr = heap.wasmExports.malloc(bytes);
        try {
          rawCall(mod, 'EPDFAnnot_GetIntent', a, ptr, bytes);
          const intent = heap.UTF16ToString(ptr);
          const nm = readAnnotString(mod, a, 'NM');
          if (intent && nm) out.set(nm, intent);
        } finally {
          heap.wasmExports.free(ptr);
        }
      } finally {
        rawCall(mod, 'FPDFPage_CloseAnnot', a);
      }
    }
  } finally {
    ref.release();
  }
  return out;
}

/**
 * Lists the annotations batch by batch; each batch goes out with its progress,
 * streamed (never coalesced), so the main thread copies one small message at a
 * time (rule 1).
 */
export async function listAnnotations(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  doc: PdfDocumentObject,
  slice: JobSlice,
  progress: (p: {
    done: number;
    total: number;
    pages: Record<number, PdfAnnotationObject[]>;
  }) => void,
): Promise<{ pages: number }> {
  const total = doc.pages.length;
  for (let from = 0; from < total; from += BATCH) {
    await slice.checkpoint();
    const pages = doc.pages.slice(from, from + BATCH);
    for (const p of pages) nameAnnotations(mod, native, doc.id, p.index);
    const batch = await native.getAnnotationsBatch(doc, pages).toPromise();
    for (const [index, list] of Object.entries(batch)) {
      // Attach File (M6-10): EmbedPDF reads no colour for a FileAttachment.
      if (list.some((a) => a.type === FILE_ATTACHMENT)) {
        const colors = fileAttachmentColors(mod, native, doc.id, Number(index));
        for (const a of list) {
          const c = a.type === FILE_ATTACHMENT ? colors.get(a.id) : undefined;
          if (c) Object.assign(a, { strokeColor: c, color: c });
        }
      }
      if (!list.some((a) => GEOMETRY.has(a.type) && !a.intent)) continue;
      const intents = geometryIntents(mod, native, doc.id, Number(index));
      for (const a of list) {
        const it = GEOMETRY.has(a.type) && !a.intent ? intents.get(a.id) : undefined;
        if (it) a.intent = it;
      }
    }
    progress({ done: Math.min(total, from + BATCH), total, pages: batch });
  }
  return { pages: total };
}
