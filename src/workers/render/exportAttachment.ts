// Attach to this PDF (M14-10, D-76, ADR-035; plan M14 §10, Q17, Q18): the
// measurements export as one of the document's own attachments (its
// /EmbeddedFiles name tree), written by direct PDFium calls in the Render
// worker, where the edited document lives. Attaching again replaces the
// earlier copy: ours are known by a key in the embedded file's /Params
// (ISO 32000-1 table 46 allows more keys there), which holds the export's
// stamp (model/measureExport.ts) so the Measurements pane can say when the
// copy is out of date. The change rides the next Ctrl+S like any other edit
// (rule 7); Ctrl+S never makes a new copy (Q18). Needs the modify permission
// (rule 9). Nothing here reads the attached bytes.
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../../engine/errors';
import { readWide } from '../work/attachments';
import { docPtrOf, rawCall, withWideString } from './pdfium';

/** The /Params key that marks our copy and holds its stamp. */
export const STAMP_KEY = 'TriyaPDFMeasurements';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
}

const heapOf = (mod: WrappedPdfiumModule): Heap => mod.pdfium as unknown as Heap;

export interface AttachedExport {
  /** The attachment's file name. */
  name: string;
  stamp: string;
}

function stampOf(mod: WrappedPdfiumModule, att: number): string | null {
  if (!rawCall(mod, 'FPDFAttachment_HasKey', att, STAMP_KEY)) return null;
  return readWide(mod, (buf, len) =>
    rawCall(mod, 'FPDFAttachment_GetStringValue', att, STAMP_KEY, buf, len),
  );
}

function nameOf(mod: WrappedPdfiumModule, att: number): string {
  return readWide(mod, (buf, len) => rawCall(mod, 'FPDFAttachment_GetName', att, buf, len));
}

/** The document's attached export (the first of ours), or null. */
export function readExportAttachment(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  docId: string,
): AttachedExport | null {
  const doc = docPtrOf(native, docId);
  const n = rawCall(mod, 'FPDFDoc_GetAttachmentCount', doc);
  for (let i = 0; i < n; i++) {
    const att = rawCall(mod, 'FPDFDoc_GetAttachment', doc, i);
    if (!att) continue;
    const stamp = stampOf(mod, att);
    if (stamp !== null) return { name: nameOf(mod, att), stamp };
  }
  return null;
}

/** "plan (Measurements).xlsx" → "plan (Measurements) 2.xlsx". */
export function numbered(name: string, k: number): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)} ${String(k)}${name.slice(dot)}` : `${name} ${String(k)}`;
}

/**
 * Removes our earlier copies and attaches `bytes` as `name` (another file of
 * that name that isn't ours is left alone; ours is then numbered), with its
 * stamp and description. Returns the name it got.
 */
export function attachExport(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  docId: string,
  o: { name: string; description: string; bytes: ArrayBuffer; stamp: string },
): string {
  if (o.bytes.byteLength === 0) throw new RpcError('attachment-empty', 'Nothing to attach');
  const doc = docPtrOf(native, docId);
  // Our earlier copies go, from the last so the indexes hold.
  for (let i = rawCall(mod, 'FPDFDoc_GetAttachmentCount', doc) - 1; i >= 0; i--) {
    const att = rawCall(mod, 'FPDFDoc_GetAttachment', doc, i);
    if (att && stampOf(mod, att) !== null) rawCall(mod, 'FPDFDoc_DeleteAttachment', doc, i);
  }
  let name = o.name;
  let att = 0;
  for (let k = 1; k <= 99 && !att; k++) {
    name = k === 1 ? o.name : numbered(o.name, k);
    att = withWideString(mod, name, (p) => rawCall(mod, 'FPDFDoc_AddAttachment', doc, p));
  }
  if (!att) throw new RpcError('attachment-failed', 'The file could not be attached');
  const heap = heapOf(mod);
  const bytes = new Uint8Array(o.bytes);
  const ptr = heap.wasmExports.malloc(bytes.length);
  try {
    heap.HEAPU8.set(bytes, ptr);
    if (!rawCall(mod, 'FPDFAttachment_SetFile', att, doc, ptr, bytes.length))
      throw new RpcError('attachment-failed', 'The file could not be attached');
  } finally {
    heap.wasmExports.free(ptr);
  }
  // After SetFile: it writes the file stream, whose /Params holds the stamp.
  withWideString(mod, o.stamp, (p) =>
    rawCall(mod, 'FPDFAttachment_SetStringValue', att, STAMP_KEY, p),
  );
  withWideString(mod, o.description, (p) => rawCall(mod, 'EPDFAttachment_SetDescription', att, p));
  rawCall(mod, 'EPDFAttachment_SetSubtype', att, XLSX_MIME);
  return name;
}
