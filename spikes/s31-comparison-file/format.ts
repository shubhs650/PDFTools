// Spike S31 (M12-06, D-65): the comparison file's format, version 1 — the
// names, the comparison data (one JSON attachment) and its checks. Pure; the
// spec is docs/formats/triya-comparison-v1.md. Nothing here is shipped.

/** The `/PieceInfo` key in the catalog (ISO 32000-1 14.5, page-piece dictionaries). */
export const PIECE_KEY = 'TriyaPDF';
/** `/Private /Type` inside our page-piece data dictionary. */
export const PRIVATE_TYPE = 'TriyaComparison';
export const FORMAT = 'triya-comparison';
export const VERSION = 1;

/** Keys in the `/EmbeddedFiles` name tree. A set of several files per side: A1, A2, … */
export const KEY_DATA = 'TriyaCompare-data';
export const keyOf = (side: 'A' | 'B', index: number, count: number): string =>
  `TriyaCompare-${side}${count > 1 ? String(index + 1) : ''}`;
export const DATA_FILE_NAME = 'comparison.json';
/** `/NM` prefix of the text comparison file's change marks (Triya PDF ignores them on reopen). */
export const MARK_NM_PREFIX = 'triya-cmp-';

export type Kind = 'overlay' | 'text';

export interface StoredFile {
  /** File name shown to people (the input's own name). */
  name: string;
  /** Bytes as stored; SHA-256 (hex) of exactly those bytes. */
  size: number;
  sha256: string;
  pages: number;
  /** Where the bytes are: an attachment, or (text comparison, Document B) the file's own first bytes. */
  storage: { attachment: string } | { prefix: { length: number; revisions: number } };
}

export interface Mark {
  /** 1-based page of Document B (or of A for a deletion, with `atB` the place in B). */
  page: number;
  kind: 'inserted' | 'deleted' | 'replaced' | 'moved';
  /** Quadrilaterals in B's user space: x1 y1 x2 y2 x3 y3 x4 y4 per word run. */
  quads: number[][];
  old?: string;
  new?: string;
  nm: string;
}

export interface ComparisonData {
  format: typeof FORMAT;
  version: number;
  kind: Kind;
  created: string;
  modified: string;
  app: string;
  documents: { A: StoredFile[]; B: StoredFile[] };
  /** Overlay: pairing, alignment per sheet; text: unused. */
  sheets?: { a: [number, number] | null; b: [number, number] | null; aToB?: number[] }[];
  options: Record<string, unknown>;
  ignoreZones: unknown[];
  /** Ticks in the differences list, by difference id. */
  checked: string[];
  /** Close-out of the old revision's comments (D-62): /NM → outcome. */
  closeOut: { nm: string; outcome: 'addressed' | 'carriedOver' | 'changedDifferently' }[];
  /** Text comparison: the marks drawn on B's pages (also written as standard markups). */
  marks?: Mark[];
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const encodeData = (d: ComparisonData): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(d));

/** Parses and checks the data attachment. Unknown fields are kept; a newer version is refused. */
export function decodeData(bytes: Uint8Array): ComparisonData {
  const d = JSON.parse(new TextDecoder().decode(bytes)) as Partial<ComparisonData>;
  if (d.format !== FORMAT) throw new Error('not a comparison file');
  if (typeof d.version !== 'number' || d.version > VERSION)
    throw new Error(`comparison file version ${String(d.version)} is newer than this app`);
  if (d.kind !== 'overlay' && d.kind !== 'text') throw new Error('unknown comparison kind');
  const A = d.documents?.A;
  const B = d.documents?.B;
  if (!Array.isArray(A) || !Array.isArray(B) || A.length === 0 || B.length === 0)
    throw new Error('comparison file without both documents');
  if (d.kind === 'text' && (A.length !== 1 || B.length !== 1))
    throw new Error('a text comparison has one file per side');
  for (const f of [...A, ...B]) {
    if (!/^[0-9a-f]{64}$/.test(f.sha256)) throw new Error('bad checksum');
    if ('prefix' in f.storage && (d.kind !== 'text' || f !== B[0]))
      throw new Error('only Document B of a text comparison is stored as the file itself');
  }
  return d as ComparisonData;
}

/** Revisions of a byte string: offsets just past each `%%EOF` (and its end-of-line). */
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
