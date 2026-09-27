// Stable ids on the Render side (M3-05, ADR-014 decision 2): the Work worker
// lists an annotation without /NM as `obj-<n>` (or `idx-<page>-<i>`). Before
// an edit, delete or reply targets such an id, it is written as the
// annotation's /NM here, so EmbedPDF finds it by name — and the edit persists
// it (ADR-005 consequence: a referenced annotation keeps its /NM).
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { parseStableId } from '../shared/annotId';
import { readAnnotString } from './annotTiles';
import { acquirePage, rawCall, withWideString } from './pdfium';

/** Executor methods whose third argument is an annotation addressed by id. */
const BY_ID = new Set(['updatePageAnnotation', 'removePageAnnotation', 'renderPageAnnotation']);

/** Writes `id` as /NM on the annotation it names, if it isn't there yet. True if written. */
export function ensureName(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  docId: string,
  pageIndex: number,
  id: string,
): boolean {
  const target = parseStableId(id);
  if (!target) return false;
  const ref = acquirePage(native, docId, pageIndex);
  try {
    const found = withWideString(mod, id, (ptr) =>
      rawCall(mod, 'EPDFPage_GetAnnotByName', ref.pagePtr, ptr),
    );
    if (found) {
      rawCall(mod, 'FPDFPage_CloseAnnot', found);
      return false;
    }
    const n = rawCall(mod, 'FPDFPage_GetAnnotCount', ref.pagePtr);
    for (let i = 0; i < n; i++) {
      const a = rawCall(mod, 'FPDFPage_GetAnnot', ref.pagePtr, i);
      if (!a) continue;
      try {
        const match =
          'objectNumber' in target
            ? rawCall(mod, 'EPDFAnnot_GetObjectNumber', a) === target.objectNumber
            : target.pageIndex === pageIndex && target.index === i;
        if (!match) continue;
        withWideString(mod, id, (ptr) => rawCall(mod, 'FPDFAnnot_SetStringValue', a, 'NM', ptr));
        return true;
      } finally {
        rawCall(mod, 'FPDFPage_CloseAnnot', a);
      }
    }
    return false;
  } finally {
    ref.release();
  }
}

/** Before an executor call: name the annotations it addresses by a stable id. */
export function nameTargets(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  method: string,
  args: readonly unknown[],
): void {
  const docId = (args[0] as { id?: unknown } | undefined)?.id;
  const page = (args[1] as { index?: unknown } | undefined)?.index;
  if (typeof docId !== 'string' || typeof page !== 'number') return;
  const annot = args[2] as { id?: unknown; inReplyToId?: unknown } | undefined;
  if (BY_ID.has(method) && typeof annot?.id === 'string')
    ensureName(mod, native, docId, page, annot.id);
  // A reply's /IRT is found by its parent's name on the same page.
  if (method === 'createPageAnnotation' && typeof annot?.inReplyToId === 'string')
    ensureName(mod, native, docId, page, annot.inReplyToId);
}

/**
 * No app-private keys in the file (rule 6): EmbedPDF writes an annotation's
 * `custom` object as JSON to its own /EPDFCustom key (its text tools put the
 * selected text there). We never send it; a `custom` value from EmbedPDF's
 * tools is dropped here. An /EPDFCustom already in a file is left as it is.
 */
export function dropCustom(method: string, args: unknown[]): unknown[] {
  if (method !== 'createPageAnnotation' && method !== 'updatePageAnnotation') return args;
  const annot = args[2];
  if (typeof annot !== 'object' || annot === null || !('custom' in annot)) return args;
  const rest: Record<string, unknown> = { ...annot };
  delete rest['custom'];
  const out = [...args];
  out[2] = rest;
  return out;
}

/**
 * An edit never changes who wrote the annotation (D-03: /T round-trips).
 * EmbedPDF's plugin puts its configured author into every update patch, so a
 * resize of someone else's markup would re-author it; the Render worker keeps
 * the annotation's own /T instead. Returns the arguments to use.
 */
export function keepAuthor(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  method: string,
  args: unknown[],
): unknown[] {
  if (method !== 'updatePageAnnotation') return args;
  const docId = (args[0] as { id?: unknown } | undefined)?.id;
  const page = (args[1] as { index?: unknown } | undefined)?.index;
  const annot = args[2] as { id?: unknown; author?: unknown } | undefined;
  if (typeof docId !== 'string' || typeof page !== 'number' || typeof annot?.id !== 'string')
    return args;
  return (
    withAnnotByName(mod, native, docId, page, annot.id, (a) => {
      const author = readAnnotString(mod, a, 'T');
      if (author === annot.author) return args;
      const out = [...args];
      out[2] = { ...annot, author };
      return out;
    }) ?? args
  );
}

/** Runs `fn` with the page's annotation named `id`; undefined when there is none. */
function withAnnotByName<T>(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  docId: string,
  page: number,
  id: string,
  fn: (annot: number) => T,
): T | undefined {
  const ref = acquirePage(native, docId, page);
  try {
    const a = withWideString(mod, id, (ptr) =>
      rawCall(mod, 'EPDFPage_GetAnnotByName', ref.pagePtr, ptr),
    );
    if (!a) return undefined;
    try {
      return fn(a);
    } finally {
      rawCall(mod, 'FPDFPage_CloseAnnot', a);
    }
  } finally {
    ref.release();
  }
}

// FPDF_ANNOT_HIGHLIGHT … FPDF_ANNOT_STRIKEOUT.
const TEXT_MARKUP_SUBTYPES = new Set([9, 10, 11, 12]);

/**
 * EmbedPDF writes /IT for most annotations but not for text markups; Replace
 * Text's StrikeOut needs /IT /StrikeOutTextEdit (as Acrobat and PDF-XChange
 * write it, M3-08). Called after the engine made or changed the annotation.
 */
export function writeMarkupIntent(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  method: string,
  args: unknown[],
): void {
  if (method !== 'createPageAnnotation' && method !== 'updatePageAnnotation') return;
  const docId = (args[0] as { id?: unknown } | undefined)?.id;
  const page = (args[1] as { index?: unknown } | undefined)?.index;
  const annot = args[2] as { id?: unknown; type?: unknown; intent?: unknown } | undefined;
  if (typeof docId !== 'string' || typeof page !== 'number' || typeof annot?.id !== 'string')
    return;
  const { intent, type } = annot;
  if (typeof intent !== 'string' || typeof type !== 'number' || !TEXT_MARKUP_SUBTYPES.has(type))
    return;
  withAnnotByName(mod, native, docId, page, annot.id, (a) =>
    rawCall(mod, 'EPDFAnnot_SetIntent', a, intent),
  );
}
