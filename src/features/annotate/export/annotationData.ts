// Annotation export data (M4-08, §7.6, M4-Q7, ADR-018, ADR-025): the comments
// of a document as CSV/XLSX rows (the CRS row builder's numbers, replies and
// statuses, M3-Q1) and as our own JSON format v2 — readable records (EmbedPDF's
// annotation model: geometry, style, text, ids, reply links, plus replies and
// review-state history) and the comments' own PDF objects (`pdf`, base64; the
// lossless import). Pure; the JSON is produced in pieces so a large document
// never builds one huge string in a single main-thread task (rule 1).
import { PdfAnnotationSubtype, type PdfAnnotationObject } from '@embedpdf/models';
import { commentsOf, isStateReply, matches, type CommentFilter } from '../comments/commentsModel';
import { buildThread, childrenOf } from '../comments/thread';

export const JSON_FORMAT = 'pdftools-annotations';
export const JSON_VERSION = 2;

/** The EmbedPDF subtype as a lower-case name ("square", "freeText" → "freetext"). */
export function subtypeName(type: PdfAnnotationSubtype): string {
  const name = (PdfAnnotationSubtype as unknown as Record<number, string | undefined>)[type];
  return (name ?? `subtype-${String(type)}`).toLowerCase();
}

/**
 * A JSON-safe copy of an annotation model: dates as ISO 8601 strings, binary
 * data and functions left out, and EmbedPDF's private `custom` bag dropped.
 */
export function jsonSafe(v: unknown, depth = 0): unknown {
  if (depth > 20) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'object') return undefined; // functions, symbols, bigint
  if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer || v instanceof Blob) return undefined;
  if (Array.isArray(v)) return v.map((x) => jsonSafe(x, depth + 1) ?? null);
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    if (depth === 0 && k === 'custom') continue;
    const y = jsonSafe(x, depth + 1);
    if (y !== undefined) out[k] = y;
  }
  return out;
}

const iso = (d: Date | undefined): string | null =>
  d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;

export interface ExportScope {
  filter?: CommentFilter | null;
}

export interface JsonHeader {
  name: string;
  pages: number;
  exported: Date;
}

/** The comments PDF (ADR-025): base64, and the document page of each of its pages (0-based). */
export interface JsonPdf {
  base64: string;
  pages: readonly number[];
}

/** Measurement facts for a record, when the annotation is one (M3-16). */
export type MeasureOf = (a: PdfAnnotationObject) => { kind: string; value: string } | null;

/** The comments an export writes (the Comments pane's set, filtered when asked). */
export const exportedComments = (all: readonly PdfAnnotationObject[], scope: ExportScope = {}) =>
  commentsOf(all).filter((c) => !scope.filter || matches(c, scope.filter));

/**
 * The JSON document in pieces (valid only when joined): a header, then one
 * record per comment, `batch` records per piece, then the comments PDF.
 */
export function* jsonPieces(
  all: readonly PdfAnnotationObject[],
  header: JsonHeader,
  scope: ExportScope = {},
  measureOf: MeasureOf = () => null,
  pdf: JsonPdf | null = null,
  batch = 200,
): Generator<string> {
  const comments = exportedComments(all, scope);
  const kids = childrenOf(all);
  yield `{"format":${JSON.stringify(JSON_FORMAT)},"version":${String(JSON_VERSION)},"exported":${JSON.stringify(header.exported.toISOString())},"document":${JSON.stringify({ name: header.name, pages: header.pages })},"annotations":[`;
  let buf: string[] = [];
  for (const [i, c] of comments.entries()) {
    const thread = buildThread(all, c.id, kids);
    const measure = measureOf(c.annot);
    const record = {
      number: c.number,
      page: c.page + 1,
      id: c.id,
      type: subtypeName(c.type),
      author: c.annot.author ?? null,
      subject: (c.annot as { subject?: string }).subject ?? null,
      contents: c.annot.contents ?? null,
      created: iso(c.annot.created),
      modified: iso(c.annot.modified),
      ...(measure ? { measure } : {}),
      replies: thread.replies
        .filter(({ annot }) => !isStateReply(annot))
        .map(({ annot, depth }) => ({
          id: annot.id,
          inReplyTo: annot.inReplyToId ?? null,
          depth,
          author: annot.author ?? null,
          contents: annot.contents ?? null,
          created: iso(annot.created),
          annotation: jsonSafe(annot),
        })),
      states: thread.history.map((s) => ({
        id: s.id,
        author: s.author ?? null,
        state: (s as { state?: string }).state ?? null,
        date: iso(s.created ?? s.modified),
      })),
      annotation: jsonSafe(c.annot),
    };
    buf.push(JSON.stringify(record));
    if (buf.length >= batch) {
      yield (i + 1 > buf.length ? ',' : '') + buf.join(',');
      buf = [];
    }
  }
  if (buf.length) yield (comments.length > buf.length ? ',' : '') + buf.join(',');
  if (!pdf) {
    yield ']}\n';
    return;
  }
  yield `],"pdfPages":${JSON.stringify(pdf.pages.map((p) => p + 1))},"pdf":"`;
  // The base64 in pieces too: a big picture or attached file is a long string.
  const PIECE = 1 << 20;
  for (let i = 0; i < pdf.base64.length; i += PIECE) yield pdf.base64.slice(i, i + PIECE);
  yield '"}\n';
}

/** The CSV/XLSX columns of the annotation export, in order. */
export const ROW_COLUMNS = [
  'number',
  'page',
  'type',
  'author',
  'subject',
  'comment',
  'replies',
  'status',
  'created',
  'modified',
] as const;
export type RowColumn = (typeof ROW_COLUMNS)[number];
