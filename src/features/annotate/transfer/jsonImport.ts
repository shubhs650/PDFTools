// Import Comments from our JSON (M4-20, ADR-018, ADR-025; formats:
// docs/formats/pdftools-annotations-v1.md and -v2.md): strict validation of
// the file, then a plan — which records land on which page, and what is
// skipped (missing page, an /NM already in the document, a type EmbedPDF cannot
// re-create without data the file does not carry). Pure. A v2 file with its
// comments PDF is applied by object copy (lossless); otherwise the dialog
// re-creates the plan through the annotation plugin (appearances by PDFium, rule 6).
import { isBase64 } from '../../../model/base64';
import type { PdfAnnotationObject } from '@embedpdf/models';

export const JSON_FORMAT = 'pdftools-annotations';

/**
 * Lower-case subtype names (the export's `type`, and a PDF subtype lower-cased)
 * that re-create from the model alone. Stamps need their picture, which v1
 * does not carry; links, widgets and the rest are not comments.
 */
export const JSON_TYPES: ReadonlySet<string> = new Set([
  'text',
  'freetext',
  'line',
  'square',
  'circle',
  'polygon',
  'polyline',
  'highlight',
  'underline',
  'squiggly',
  'strikeout',
  'caret',
  'ink',
]);

export interface JsonReply {
  id: string;
  inReplyTo: string | null;
  annotation: Record<string, unknown>;
}

export interface JsonState {
  id: string;
  author: string | null;
  state: string;
  date: string | null;
}

export interface JsonRecord {
  /** 0-based source page. */
  page: number;
  id: string;
  type: string;
  author: string | null;
  replies: JsonReply[];
  states: JsonState[];
  annotation: Record<string, unknown>;
}

/** A v2 file's comments PDF (ADR-025): base64, and the document page (0-based) of each of its pages. */
export interface JsonPdfPart {
  base64: string;
  pages: number[];
}

export interface JsonDocument {
  name: string | null;
  pages: number | null;
  records: JsonRecord[];
  /** v2: the comments' own PDF objects; null in v1 (re-created from the records). */
  pdf: JsonPdfPart | null;
}

export type JsonError = 'syntax' | 'format' | 'version' | 'shape' | 'tooLarge' | 'pdf';

/** The versions this build reads. */
export const JSON_VERSIONS: ReadonlySet<unknown> = new Set([1, 2]);

export type ParseResult =
  | { ok: true; doc: JsonDocument }
  | {
      ok: false;
      error: JsonError;
      /** 1-based record for `shape`; the file's version for `version`. */
      at?: number;
    };

/** More than this is not a comment export. */
export const MAX_RECORDS = 100_000;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strOrNull = (v: unknown): boolean => v === null || v === undefined || typeof v === 'string';
const dateOrNull = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === 'string' && !Number.isNaN(Date.parse(v)));

/** An annotation model we can re-create: a numeric type and a finite rect. */
function modelOk(a: unknown): a is Record<string, unknown> {
  if (!isObj(a) || !Number.isInteger(a['type'])) return false;
  const r = a['rect'];
  if (!isObj(r) || !isObj(r['origin']) || !isObj(r['size'])) return false;
  const o = r['origin'];
  const s = r['size'];
  return isNum(o['x']) && isNum(o['y']) && isNum(s['width']) && isNum(s['height']);
}

function recordOf(v: unknown): JsonRecord | null {
  if (!isObj(v)) return null;
  const { page, id, type, author, replies, states, annotation } = v;
  if (!Number.isInteger(page) || (page as number) < 1) return null;
  if (typeof id !== 'string' || !id || typeof type !== 'string' || !strOrNull(author)) return null;
  if (!dateOrNull(v['created']) || !dateOrNull(v['modified'])) return null;
  if (!modelOk(annotation)) return null;
  if (!Array.isArray(replies) || !Array.isArray(states)) return null;
  const outReplies: JsonReply[] = [];
  for (const r of replies) {
    if (!isObj(r) || typeof r['id'] !== 'string' || !r['id'] || !strOrNull(r['inReplyTo']))
      return null;
    if (!modelOk(r['annotation'])) return null;
    outReplies.push({
      id: r['id'],
      inReplyTo: (r['inReplyTo'] as string | null | undefined) ?? null,
      annotation: r['annotation'],
    });
  }
  const outStates: JsonState[] = [];
  for (const s of states) {
    if (!isObj(s) || typeof s['id'] !== 'string' || typeof s['state'] !== 'string') return null;
    if (!strOrNull(s['author']) || !dateOrNull(s['date'])) return null;
    outStates.push({
      id: s['id'],
      author: (s['author'] as string | null | undefined) ?? null,
      state: s['state'],
      date: (s['date'] as string | null | undefined) ?? null,
    });
  }
  return {
    page: (page as number) - 1,
    id,
    type: type.toLowerCase(),
    author: (author as string | null | undefined) ?? null,
    replies: outReplies,
    states: outStates,
    annotation,
  };
}

/** Validates a file strictly against v1; unknown fields are ignored (the format's rule). */
export function parseAnnotationJson(text: string): ParseResult {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return { ok: false, error: 'syntax' };
  }
  if (!isObj(root) || root['format'] !== JSON_FORMAT) return { ok: false, error: 'format' };
  if (!JSON_VERSIONS.has(root['version']))
    return {
      ok: false,
      error: 'version',
      ...(typeof root['version'] === 'number' ? { at: root['version'] } : {}),
    };
  const list = root['annotations'];
  if (!Array.isArray(list)) return { ok: false, error: 'shape' };
  if (list.length > MAX_RECORDS) return { ok: false, error: 'tooLarge' };
  const doc = isObj(root['document']) ? root['document'] : {};
  const records: JsonRecord[] = [];
  for (const [i, v] of list.entries()) {
    const r = recordOf(v);
    if (!r) return { ok: false, error: 'shape', at: i + 1 };
    records.push(r);
  }
  let pdf: JsonPdfPart | null = null;
  if (root['version'] === 2 && root['pdf'] !== undefined) {
    pdf = pdfOf(root['pdf'], root['pdfPages']);
    if (!pdf) return { ok: false, error: 'pdf' };
  }
  return {
    ok: true,
    doc: {
      name: typeof doc['name'] === 'string' ? doc['name'] : null,
      pages: Number.isInteger(doc['pages']) ? (doc['pages'] as number) : null,
      records,
      pdf,
    },
  };
}

/** v2's `pdf` (base64 of a PDF) and `pdfPages` (1-based document pages, one per PDF page). */
function pdfOf(pdf: unknown, pages: unknown): JsonPdfPart | null {
  if (typeof pdf !== 'string' || !pdf.startsWith('JVBERi') || !isBase64(pdf)) return null;
  if (!Array.isArray(pages) || pages.length === 0) return null;
  if (!pages.every((p) => Number.isInteger(p) && (p as number) >= 1)) return null;
  return { base64: pdf, pages: (pages as number[]).map((p) => p - 1) };
}

/** The latest review state of a record (states are oldest first). */
export const latestState = (r: JsonRecord): string | null => r.states.at(-1)?.state ?? null;

export interface JsonPlanOptions {
  /** 0-based source pages (default: all). */
  pages?: ReadonlySet<number>;
  /** Target page = source page + offset. */
  offset: number;
  authors?: ReadonlySet<string>;
  /** Lower-case type names. */
  types?: ReadonlySet<string>;
  withReplies: boolean;
  targetPages: number;
  /** /NMs already in the target. */
  existing: ReadonlySet<string>;
  /** The file carries its comments PDF (v2, ADR-025): every type comes in by object copy. */
  lossless?: boolean;
}

export interface JsonPlanItem {
  record: JsonRecord;
  target: number;
  replies: JsonReply[];
}

export interface TransferCountsLike {
  selected: number;
  roots: number;
  skipped: { duplicate: number; missingPage: number; filtered: number; unsupported: number };
}

/** What an import of `records` does with these options. */
export function planJsonImport(
  records: readonly JsonRecord[],
  o: JsonPlanOptions,
): { items: JsonPlanItem[]; counts: TransferCountsLike } {
  const counts: TransferCountsLike = {
    selected: 0,
    roots: 0,
    skipped: { duplicate: 0, missingPage: 0, filtered: 0, unsupported: 0 },
  };
  const items: JsonPlanItem[] = [];
  for (const r of records) {
    const size = 1 + r.replies.length + r.states.length;
    if (
      (o.pages && !o.pages.has(r.page)) ||
      (o.authors && !o.authors.has(r.author ?? '')) ||
      (o.types && !o.types.has(r.type))
    ) {
      counts.skipped.filtered += size;
      continue;
    }
    if (!o.lossless && !JSON_TYPES.has(r.type)) {
      counts.skipped.unsupported += size;
      continue;
    }
    const target = r.page + o.offset;
    if (target < 0 || target >= o.targetPages) {
      counts.skipped.missingPage += size;
      continue;
    }
    if (o.existing.has(r.id)) {
      counts.skipped.duplicate += size;
      continue;
    }
    const replies = o.withReplies ? r.replies.filter((x) => !o.existing.has(x.id)) : [];
    if (!o.withReplies) counts.skipped.filtered += r.replies.length;
    else counts.skipped.duplicate += r.replies.length - replies.length;
    const states = r.states.filter((s) => !o.existing.has(s.id));
    counts.skipped.duplicate += r.states.length - states.length;
    items.push({ record: { ...r, states }, target, replies });
    counts.roots++;
    counts.selected += 1 + replies.length + states.length;
  }
  return { items, counts };
}

/** A JSON model back to EmbedPDF's: dates revived, placed on `page`. */
export function reviveModel(a: Record<string, unknown>, page: number): PdfAnnotationObject {
  const rest = Object.fromEntries(
    Object.entries(a).filter(([k]) => k !== 'custom' && k !== 'created' && k !== 'modified'),
  );
  const { created, modified } = a;
  const date = (v: unknown) => (typeof v === 'string' ? { value: new Date(v) } : null);
  const c = date(created);
  const m = date(modified);
  return {
    ...rest,
    pageIndex: page,
    ...(c ? { created: c.value } : {}),
    ...(m ? { modified: m.value } : {}),
  } as unknown as PdfAnnotationObject;
}
