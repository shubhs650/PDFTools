// Embedded files in the Work worker (§5, M2-11, ADR-012 decision 4): the
// document's EmbeddedFiles name tree through the engine, and FileAttachment
// annotations through direct PDFium calls (EmbedPDF doesn't list them,
// ADR-001 B14). Listing walks the pages with a checkpoint at each; reading
// returns the bytes for transfer (never copied through the main thread
// twice). Nothing here interprets the bytes.
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { PdfAttachmentObject, PdfDocumentObject } from '@embedpdf/models';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../../engine/errors';
import { parsePdfDate } from '../../model/pdfDate';
import { acquirePage, rawCall } from '../render/pdfium';
import type { JobSlice } from './scheduler';

/** FPDF_ANNOT_FILEATTACHMENT. */
const FILE_ATTACHMENT = 17;

export type AttachmentRef =
  { source: 'document'; index: number } | { source: 'annotation'; page: number; annot: number };

export interface AttachmentInfo {
  ref: AttachmentRef;
  name: string;
  description: string;
  /** Bytes, when known. */
  size: number | null;
  /** ISO date, when the file says. */
  created: string | null;
}

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
}

const heapOf = (mod: WrappedPdfiumModule): Heap => mod.pdfium as unknown as Heap;

/** A UTF-16LE string from a PDFium "get into buffer" call that returns the byte length. */
function readWide(mod: WrappedPdfiumModule, call: (buf: number, len: number) => number): string {
  const heap = heapOf(mod);
  const len = call(0, 0);
  if (len <= 2) return '';
  const buf = heap.wasmExports.malloc(len);
  try {
    call(buf, len);
    return new TextDecoder('utf-16le').decode(heap.HEAPU8.slice(buf, buf + len - 2));
  } finally {
    heap.wasmExports.free(buf);
  }
}

/** Byte length of an attachment's file (FPDFAttachment_GetFile with no buffer). */
function fileSize(mod: WrappedPdfiumModule, att: number): number | null {
  const heap = heapOf(mod);
  const out = heap.wasmExports.malloc(4);
  try {
    const ok = rawCall(mod, 'FPDFAttachment_GetFile', att, 0, 0, out);
    return ok ? (heap.HEAP32[out >> 2] ?? null) : null;
  } finally {
    heap.wasmExports.free(out);
  }
}

function fileBytes(mod: WrappedPdfiumModule, att: number): ArrayBuffer {
  const size = fileSize(mod, att);
  if (size === null)
    throw new RpcError('attachment-unreadable', 'The attachment could not be read');
  const heap = heapOf(mod);
  const buf = heap.wasmExports.malloc(Math.max(1, size));
  const out = heap.wasmExports.malloc(4);
  try {
    if (!rawCall(mod, 'FPDFAttachment_GetFile', att, buf, size, out))
      throw new RpcError('attachment-unreadable', 'The attachment could not be read');
    // HEAPU8 is read after the call (the heap may have grown); slice copies out.
    return heap.HEAPU8.slice(buf, buf + size).buffer;
  } finally {
    heap.wasmExports.free(buf);
    heap.wasmExports.free(out);
  }
}

/** Runs `fn` with each FileAttachment annotation's attachment handle on one page. */
function withPageAttachments(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  docId: string,
  page: number,
  fn: (annotIndex: number, att: number, annot: number) => void,
): void {
  const ref = acquirePage(native, docId, page);
  try {
    const n = rawCall(mod, 'FPDFPage_GetAnnotCount', ref.pagePtr);
    for (let i = 0; i < n; i++) {
      const annot = rawCall(mod, 'FPDFPage_GetAnnot', ref.pagePtr, i);
      if (!annot) continue;
      try {
        if (rawCall(mod, 'FPDFAnnot_GetSubtype', annot) !== FILE_ATTACHMENT) continue;
        const att = rawCall(mod, 'FPDFAnnot_GetFileAttachment', annot);
        if (att) fn(i, att, annot);
      } finally {
        rawCall(mod, 'FPDFPage_CloseAnnot', annot);
      }
    }
  } finally {
    ref.release();
  }
}

const dateOf = (s: string): string | null => parsePdfDate(s)?.toISOString() ?? null;

export async function listAttachments(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  doc: PdfDocumentObject,
  slice: JobSlice,
  onProgress: (p: { done: number; total: number }) => void,
): Promise<AttachmentInfo[]> {
  const out: AttachmentInfo[] = [];
  const docLevel = (await native.getAttachments(doc).toPromise()) as PdfAttachmentObject[];
  for (const a of docLevel) {
    out.push({
      ref: { source: 'document', index: a.index },
      name: a.name,
      description: a.description,
      size: a.size ?? null,
      created: a.creationDate ? a.creationDate.toISOString() : null,
    });
  }
  for (const page of doc.pages) {
    await slice.checkpoint();
    withPageAttachments(mod, native, doc.id, page.index, (index, att, annot) => {
      const str = (key: string) =>
        readWide(mod, (buf, len) =>
          rawCall(mod, 'FPDFAttachment_GetStringValue', att, key, buf, len),
        );
      out.push({
        ref: { source: 'annotation', page: page.index, annot: index },
        name: readWide(mod, (buf, len) => rawCall(mod, 'FPDFAttachment_GetName', att, buf, len)),
        // The filespec's /Desc isn't reachable here; readers show the note's text.
        description: readWide(mod, (buf, len) =>
          rawCall(mod, 'FPDFAnnot_GetStringValue', annot, 'Contents', buf, len),
        ),
        size: fileSize(mod, att),
        created: dateOf(str('CreationDate')),
      });
    });
    onProgress({ done: page.index + 1, total: doc.pageCount });
  }
  return out;
}

export async function readAttachment(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  doc: PdfDocumentObject,
  ref: AttachmentRef,
): Promise<ArrayBuffer> {
  if (ref.source === 'document') {
    const all = (await native.getAttachments(doc).toPromise()) as PdfAttachmentObject[];
    const a = all.find((x) => x.index === ref.index);
    if (!a) throw new RpcError('attachment-missing', 'No such attachment');
    return (await native.readAttachmentContent(doc, a).toPromise()) as ArrayBuffer;
  }
  if (ref.page < 0 || ref.page >= doc.pageCount)
    throw new RpcError('attachment-missing', 'No such attachment');
  const found: { bytes?: ArrayBuffer } = {};
  withPageAttachments(mod, native, doc.id, ref.page, (annot, att) => {
    if (annot === ref.annot) found.bytes = fileBytes(mod, att);
  });
  if (!found.bytes) throw new RpcError('attachment-missing', 'No such attachment');
  return found.bytes;
}
