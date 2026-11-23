// The comparison file, version 1 (M12-20, D-65, ADR-032): the names it uses,
// the comparison data (one JSON attachment) and its checks. Pure; the spec is
// docs/formats/triya-comparison-v1.md. Written by Save comparison… and Save
// review in a reopened comparison file, read when such a file is opened.

/** The `/PieceInfo` key in the catalog (ISO 32000-1 14.5, page-piece dictionaries). */
export const PIECE_KEY = 'TriyaPDF';
/** `/Private /Type` inside our page-piece data dictionary. */
export const PRIVATE_TYPE = 'TriyaComparison';
export const FORMAT = 'triya-comparison';
export const VERSION = 1;

/** Key of the data in `/EmbeddedFiles`. */
export const KEY_DATA = 'TriyaCompare-data';
/** Keys of the inputs: one file per side, or a set (A1, A2, …). */
export const keyOf = (side: 'A' | 'B', index: number, count: number): string =>
  `TriyaCompare-${side}${count > 1 ? String(index + 1) : ''}`;
export const DATA_FILE_NAME = 'comparison.json';
/** `/NM` prefix of a text comparison file's change marks (never read back as comments). */
export const MARK_NM_PREFIX = 'triya-cmp-';

export type FileKind = 'overlay' | 'text';

/** Where an input's bytes are in the comparison file. */
export type Storage = { attachment: string } | { prefix: { length: number; revisions: number } };

/** One input file, exactly as stored. */
export interface StoredFile {
  /** The input's file name (shown to people; never logged, rule 10). */
  name: string;
  /** Bytes as stored; SHA-256 (hex) of exactly those bytes. */
  size: number;
  sha256: string;
  pages: number;
  /** The pages compared as typed in the input window ("1-3, 8"); empty: every page. */
  range: string;
  storage: Storage;
}

/** How a sheet's placement was found (D-60). */
export type SheetStatus = 'asIs' | 'aligned' | 'manual' | 'lowConfidence';

/** One sheet of an overlay comparison file: one page of the file, in the same order. */
export interface SheetEntry {
  /** [index into documents.A, page index], or null (the sheet is only in B). */
  a: [number, number] | null;
  b: [number, number] | null;
  /** A's displayed page → B's (D-60); absent when used as is. */
  aToB?: number[];
  status: SheetStatus;
  /**
   * The user looked at an uncertain alignment and accepted it ("It looks
   * right": "Checked by you", M12-26, ADR-033); absent otherwise.
   */
  checked?: boolean;
}

/** A row of the pairing table (M12-09): side page indices, or null; left out of the comparison. */
export interface PairingRow {
  a: number | null;
  b: number | null;
  excluded?: boolean;
}

/** An ignore zone (Q22): a compared sheet (1-based) or every sheet (null), in B's displayed space. */
export interface StoredZone {
  sheet: number | null;
  rect: [number, number, number, number];
}

/** A close-out outcome (D-62), as also written into Document A. */
export type CloseOutOutcome = 'addressed' | 'carriedOver' | 'changedDifferently';

/** The kinds of change a text comparison file marks (the text view's, D-63). */
export type MarkKind =
  | 'inserted'
  | 'deleted'
  | 'replaced'
  | 'moved'
  | 'figure'
  | 'header'
  | 'footer'
  | 'renumbered'
  | 'reference';

export const MARK_KINDS: readonly MarkKind[] = [
  'inserted',
  'deleted',
  'replaced',
  'moved',
  'figure',
  'header',
  'footer',
  'renumbered',
  'reference',
];

/** A change mark on Document B's pages (also written as a standard markup). */
export interface StoredMark {
  /** 1-based page of Document B. */
  page: number;
  kind: MarkKind;
  /** Quadrilaterals in B's default user space, per line run: x1 y1 x2 y2 x3 y3 x4 y4. */
  quads: number[][];
  old?: string;
  new?: string;
  /** The /NM of its markup on B's page. */
  nm: string;
}

/** An area comparison (M12-21·O1): the two boxes, in each page's displayed space (pt). */
export interface StoredArea {
  a: [number, number, number, number];
  b: [number, number, number, number];
}

export interface ComparisonData {
  format: typeof FORMAT;
  version: number;
  kind: FileKind;
  created: string;
  modified: string;
  app: string;
  documents: { A: StoredFile[]; B: StoredFile[] };
  /** Overlay: one entry per page of the file. */
  sheets?: SheetEntry[];
  /** Overlay: the pairing table as edited (M12-09). */
  pairing?: PairingRow[];
  /** Overlay: an area comparison's boxes (M12-21·O1). */
  area?: StoredArea;
  /**
   * Overlay: pages before the first sheet (an optional summary page, M12-21);
   * `sheets[i]` is page `leadingPages + i` of the file. 0 when left out.
   */
  leadingPages?: number;
  /** The view's and the comparison's settings (colours, sensitivity, switches …). */
  options: Record<string, unknown>;
  ignoreZones: StoredZone[];
  /** Ticks in the differences list, by difference id. */
  checked: string[];
  closeOut: { nm: string; outcome: CloseOutOutcome }[];
  /** Text only: the marks on B's pages, so the file is read without comparing again. */
  marks?: StoredMark[];
}

/** Why a data attachment was refused (the open path says it in plain words). */
export type DataProblem = 'notComparison' | 'newer' | 'broken';

export class DataError extends Error {
  readonly problem: DataProblem;
  constructor(problem: DataProblem, message: string) {
    super(message);
    this.problem = problem;
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const encodeData = (d: ComparisonData): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(d));

type Loose = Record<string, unknown>;

const isObject = (v: unknown): v is Loose =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function checkFile(f: unknown): f is StoredFile {
  if (!isObject(f)) return false;
  const { name, size, pages, sha256, storage } = f as Partial<Record<keyof StoredFile, unknown>>;
  if (typeof name !== 'string' || typeof size !== 'number' || typeof pages !== 'number')
    return false;
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return false;
  if (!isObject(storage)) return false;
  const { attachment, prefix } = storage as { attachment?: unknown; prefix?: unknown };
  if (attachment !== undefined) return typeof attachment === 'string';
  if (!isObject(prefix)) return false;
  const p = prefix as { length?: unknown; revisions?: unknown };
  return typeof p.length === 'number' && typeof p.revisions === 'number';
}

/**
 * Parses and checks the data attachment. Fields this version does not know are
 * kept; a newer version is refused (the format spec: "refused with a plain
 * message"); missing optional lists default to empty.
 */
export function decodeData(bytes: Uint8Array): ComparisonData {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new DataError('broken', 'comparison data is not JSON');
  }
  if (!isObject(raw)) throw new DataError('notComparison', 'not a comparison file');
  const d = raw as Partial<Record<keyof ComparisonData, unknown>>;
  if (d.format !== FORMAT) throw new DataError('notComparison', 'not a comparison file');
  const version = d.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    throw new DataError('broken', 'comparison data without a version');
  if (version > VERSION)
    throw new DataError('newer', `comparison file version ${String(version)} is newer`);
  if (d.kind !== 'overlay' && d.kind !== 'text')
    throw new DataError('broken', 'unknown comparison kind');
  const docs = d.documents as { A?: unknown; B?: unknown } | undefined;
  const A = isObject(docs) ? docs.A : undefined;
  const B = isObject(docs) ? docs.B : undefined;
  if (!Array.isArray(A) || !Array.isArray(B) || A.length === 0 || B.length === 0)
    throw new DataError('broken', 'comparison file without both documents');
  if (![...(A as unknown[]), ...(B as unknown[])].every(checkFile))
    throw new DataError('broken', 'bad input entry');
  const a = A as StoredFile[];
  const b = B as StoredFile[];
  if (d.kind === 'text' && (a.length !== 1 || b.length !== 1))
    throw new DataError('broken', 'a text comparison has one file per side');
  for (const f of [...a, ...b]) {
    if ('prefix' in f.storage && (d.kind !== 'text' || f !== b[0]))
      throw new DataError('broken', 'only Document B of a text comparison is the file itself');
    if (typeof f.range !== 'string') f.range = '';
  }
  const out = raw as unknown as ComparisonData;
  if (!isObject(out.options)) out.options = {};
  if (!Array.isArray(out.ignoreZones)) out.ignoreZones = [];
  if (!Array.isArray(out.checked)) out.checked = [];
  if (!Array.isArray(out.closeOut)) out.closeOut = [];
  if (typeof out.created !== 'string') out.created = '';
  if (typeof out.modified !== 'string') out.modified = out.created;
  if (typeof out.app !== 'string') out.app = '';
  const lead = out.leadingPages;
  if (typeof lead !== 'number' || !Number.isInteger(lead) || lead < 0) delete out.leadingPages;
  return out;
}

/** How many `%%EOF` markers (revisions) a byte string holds. */
export function revisionCount(bytes: Uint8Array): number {
  let n = 0;
  for (let i = 0; i + 5 <= bytes.length; i++) {
    if (
      bytes[i] === 0x25 &&
      bytes[i + 1] === 0x25 &&
      bytes[i + 2] === 0x45 &&
      bytes[i + 3] === 0x4f &&
      bytes[i + 4] === 0x46
    )
      n++;
  }
  return n;
}

/** A file name for a reader's attachment list: `/F` must be ASCII; `/UF` carries the real name. */
export const asciiName = (s: string): string => s.replace(/[^\x20-\x7e]/g, '_');
