// Why a file could not be opened, as a localized message (M1-13, rule 11).
// Kinds only: never the file name or content in a report (rule 10).
import { PdfErrorCode } from '@embedpdf/models';
import { msg, type MessageKey } from '../../i18n';

export type OpenErrorKind =
  'not-pdf' | 'damaged' | 'needs-password' | 'unreadable' | 'too-many' | 'unknown';

export const OPEN_ERROR_MESSAGE: Record<OpenErrorKind, MessageKey> = {
  'not-pdf': msg('open.error.notPdf'),
  damaged: msg('open.error.damaged'),
  'needs-password': msg('open.error.needsPassword'),
  unreadable: msg('open.error.unreadable'),
  'too-many': msg('open.error.tooMany'),
  unknown: msg('open.error.unknown'),
};

/** Bytes to read for the header check (the spec allows junk before `%PDF-`). */
export const HEADER_WINDOW = 1024;

/**
 * Whether `%PDF-` occurs in the first 1 KB. A byte comparison on a 1 KB
 * slice, not parsing: it only tells "not a PDF" from "damaged PDF".
 */
export function hasPdfHeader(bytes: Uint8Array): boolean {
  const sig = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  const end = Math.min(bytes.length, HEADER_WINDOW) - sig.length;
  outer: for (let i = 0; i <= end; i++) {
    for (let j = 0; j < sig.length; j++) if (bytes[i + j] !== sig[j]) continue outer;
    return true;
  }
  return false;
}

export class OpenError extends Error {
  override readonly name = 'OpenError';
  readonly kind: OpenErrorKind;
  constructor(kind: OpenErrorKind) {
    super(kind);
    this.kind = kind;
  }
}

/** PDFium code from an EmbedPDF task error (`{code}`) or a wrapped one (`{reason: {code}}`). */
function pdfiumCode(err: unknown): number | undefined {
  const e = err as { code?: unknown; reason?: { code?: unknown } } | undefined;
  const code = typeof e?.code === 'number' ? e.code : e?.reason?.code;
  return typeof code === 'number' ? code : undefined;
}

export function classifyOpenError(err: unknown, header: boolean): OpenErrorKind {
  if (err instanceof OpenError) return err.kind;
  if ((err as DOMException | undefined)?.name === 'NotReadableError') return 'unreadable';
  if ((err as DOMException | undefined)?.name === 'NotFoundError') return 'unreadable';
  const code = pdfiumCode(err);
  if (code === PdfErrorCode.Password) return 'needs-password';
  if (!header) return 'not-pdf';
  if (code === undefined) return 'unknown';
  return 'damaged';
}
