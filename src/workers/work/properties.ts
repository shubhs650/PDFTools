// Document Properties and Security Info facts (M2-12, §7.12, M1-Q6), read
// in the Work worker: the Info dictionary through PDFium (raw strings, so
// dates are parsed by model/pdfDate), the file version, tagging, and what
// only the bytes tell (model/pdfFacts): revisions, linearization and the
// encryption method. Read-only; nothing here is logged (rule 10).
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { PdfDocumentObject } from '@embedpdf/models';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { parsePdfDate } from '../../model/pdfDate';
import { findEncryption, isLinearized, revisionCount, type Encryption } from '../../model/pdfFacts';
import { docPtrOf, rawCall } from '../render/pdfium';

export interface DocProperties {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
  /** ISO dates, when the file has valid ones. */
  created: string | null;
  modified: string | null;
  /** "1.7", or null when PDFium can't tell. */
  version: string | null;
  tagged: boolean;
  linearized: boolean;
  /** Cross-reference sections: 1 for a file never saved incrementally. */
  revisions: number;
  fileBytes: number;
  /** null: not encrypted. */
  encryption: Encryption | null;
}

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
}

function metaText(mod: WrappedPdfiumModule, doc: number, key: string): string {
  const heap = mod.pdfium as unknown as Heap;
  const len = rawCall(mod, 'FPDF_GetMetaText', doc, key, 0, 0);
  if (len <= 2) return '';
  const buf = heap.wasmExports.malloc(len);
  try {
    rawCall(mod, 'FPDF_GetMetaText', doc, key, buf, len);
    return new TextDecoder('utf-16le').decode(heap.HEAPU8.slice(buf, buf + len - 2));
  } finally {
    heap.wasmExports.free(buf);
  }
}

function fileVersion(mod: WrappedPdfiumModule, doc: number): string | null {
  const heap = mod.pdfium as unknown as Heap;
  const out = heap.wasmExports.malloc(4);
  try {
    if (!rawCall(mod, 'FPDF_GetFileVersion', doc, out)) return null;
    const v = heap.HEAP32[out >> 2] ?? 0;
    return v > 0 ? `${String(Math.floor(v / 10))}.${String(v % 10)}` : null;
  } finally {
    heap.wasmExports.free(out);
  }
}

export function readProperties(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  doc: PdfDocumentObject,
  bytes: Uint8Array,
): DocProperties {
  const ptr = docPtrOf(native, doc.id);
  const text = (key: string) => metaText(mod, ptr, key).trim();
  const iso = (key: string) => parsePdfDate(text(key))?.toISOString() ?? null;
  return {
    title: text('Title'),
    author: text('Author'),
    subject: text('Subject'),
    keywords: text('Keywords'),
    creator: text('Creator'),
    producer: text('Producer'),
    created: iso('CreationDate'),
    modified: iso('ModDate'),
    version: fileVersion(mod, ptr),
    tagged: rawCall(mod, 'FPDFCatalog_IsTagged', ptr) !== 0,
    linearized: isLinearized(bytes),
    revisions: revisionCount(bytes),
    fileBytes: bytes.byteLength,
    encryption: findEncryption(bytes),
  };
}
