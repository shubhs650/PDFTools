// Fonts installed on this computer (M11-08·O5, D-54): what a font file
// allows and how it is built, read from its OpenType tables. Pure; runs in
// the Render worker over a Blob from Local Font Access (only the table
// directory and the few small tables needed are read) and in unit tests.
//
//  - Embedding (OS/2 fsType): restricted-license fonts must not be embedded;
//    preview-and-print and editable fonts may be (for viewing, as Acrobat
//    does); bitmap-only and no-subsetting fonts cannot be embedded the way we
//    embed (outlines, as a subset).
//  - Outlines: TrueType (`glyf`) only. A CFF font (`OTTO`) is listed but not
//    usable: its subsets embed badly in other viewers (spike S26).
//  - A collection (`ttcf`, e.g. Cambria with Cambria Math) is split into the
//    one face the computer named, by its PostScript name.
//  - The standard family it falls back to in /DA: monospaced → Courier,
//    serif classes → Times, else Helvetica.
import type { StandardFamily } from './library';

/** Reads `length` bytes at `offset` (fewer at the end of the file). */
export type Reader = (offset: number, length: number) => Promise<Uint8Array>;

/** Why a font installed on the computer cannot be used in a comment, or 'ok'. */
export type FontUse = 'ok' | 'restricted' | 'bitmap' | 'noSubset' | 'outlines' | 'unreadable';

export interface FontInspection {
  /** The face's index in a collection (0 for a single font). */
  index: number;
  collection: boolean;
  postscriptName: string;
  use: FontUse;
  standard: StandardFamily;
  /** Has an `fvar` table (drawn at a `wght`). */
  variable: boolean;
}

interface TableRecord {
  offset: number;
  length: number;
}

const TAG_TTCF = 0x74746366; // 'ttcf'
const TAG_OTTO = 0x4f54544f; // 'OTTO'
const TAG_TRUE = 0x74727565; // 'true'
const SFNT_TT = 0x00010000;
/** At most this many faces in a collection, and tables in a face (defensive). */
const MAX_FACES = 256;
const MAX_TABLES = 128;

const view = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** A Reader over bytes in memory. */
export const bytesReader =
  (bytes: Uint8Array): Reader =>
  (offset, length) =>
    Promise.resolve(bytes.subarray(offset, offset + length));

async function exact(read: Reader, offset: number, length: number): Promise<DataView> {
  const b = await read(offset, length);
  if (b.length < length) throw new Error('sfnt: truncated');
  return view(b);
}

/** The offsets of each face's table directory (one for a single font). */
async function faceOffsets(read: Reader): Promise<{ offsets: number[]; collection: boolean }> {
  const h = await exact(read, 0, 12);
  if (h.getUint32(0) !== TAG_TTCF) return { offsets: [0], collection: false };
  const n = h.getUint32(8);
  if (n < 1 || n > MAX_FACES) throw new Error('sfnt: bad collection');
  const d = await exact(read, 12, n * 4);
  return { offsets: Array.from({ length: n }, (_, i) => d.getUint32(i * 4)), collection: true };
}

async function tableDirectory(
  read: Reader,
  at: number,
): Promise<{ version: number; tables: Map<string, TableRecord> }> {
  const h = await exact(read, at, 12);
  const version = h.getUint32(0);
  const n = h.getUint16(4);
  if (n > MAX_TABLES) throw new Error('sfnt: too many tables');
  const d = await exact(read, at + 12, n * 16);
  const tables = new Map<string, TableRecord>();
  for (let i = 0; i < n; i++) {
    const o = i * 16;
    const tag = String.fromCharCode(
      d.getUint8(o),
      d.getUint8(o + 1),
      d.getUint8(o + 2),
      d.getUint8(o + 3),
    );
    tables.set(tag, { offset: d.getUint32(o + 8), length: d.getUint32(o + 12) });
  }
  return { version, tables };
}

async function table(
  read: Reader,
  tables: Map<string, TableRecord>,
  tag: string,
  max = 64 * 1024,
): Promise<DataView | null> {
  const t = tables.get(tag);
  if (!t) return null;
  const b = await read(t.offset, Math.min(t.length, max));
  return b.length ? view(b) : null;
}

/** The PostScript name (name ID 6), from Windows Unicode or Mac Roman records. */
export function postscriptNameOf(name: DataView | null): string {
  if (!name || name.byteLength < 6) return '';
  const count = name.getUint16(2);
  const strings = name.getUint16(4);
  let mac = '';
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 12;
    if (o + 12 > name.byteLength) break;
    const platform = name.getUint16(o);
    const encoding = name.getUint16(o + 2);
    const id = name.getUint16(o + 6);
    const len = name.getUint16(o + 8);
    const off = strings + name.getUint16(o + 10);
    if (id !== 6 || off + len > name.byteLength) continue;
    if (platform === 3 && (encoding === 1 || encoding === 0)) {
      let s = '';
      for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(name.getUint16(off + k));
      return s;
    }
    if (platform === 1 && encoding === 0 && !mac)
      for (let k = 0; k < len; k++) mac += String.fromCharCode(name.getUint8(off + k));
  }
  return mac;
}

/**
 * What the OS/2 fsType embedding bits allow (OpenType spec; with several
 * usage bits, as old fonts have, the least restrictive one applies).
 */
export function embeddingOf(fsType: number): 'ok' | 'restricted' | 'bitmap' | 'noSubset' {
  const usage = fsType & 0x000e;
  if (usage === 0x0002) return 'restricted';
  if (fsType & 0x0200) return 'bitmap';
  if (fsType & 0x0100) return 'noSubset';
  return 'ok';
}

/**
 * The standard family a font falls back to: monospaced (post isFixedPitch or
 * PANOSE proportion 9), serif (IBM class 1–5 or 7, or a PANOSE serif style
 * 2–10 of Latin text), else sans.
 */
export function standardOf(
  sFamilyClass: number,
  fixedPitch: boolean,
  panose: ArrayLike<number> = [],
): StandardFamily {
  const latinText = panose[0] === 2;
  if (fixedPitch || (latinText && panose[3] === 9)) return 'courier';
  const cls = (sFamilyClass >> 8) & 0xff;
  const serif = panose[1] ?? 0;
  return (cls >= 1 && cls <= 5) || cls === 7 || (latinText && serif >= 2 && serif <= 10)
    ? 'times'
    : 'helvetica';
}

/**
 * Inspects a font file: the face named `postscriptName` in a collection (else
 * its first face), what it allows and how it falls back. Never throws: a file
 * it cannot read is 'unreadable'.
 */
export async function inspectFont(read: Reader, postscriptName = ''): Promise<FontInspection> {
  const unreadable: FontInspection = {
    index: 0,
    collection: false,
    postscriptName,
    use: 'unreadable',
    standard: 'helvetica',
    variable: false,
  };
  try {
    const { offsets, collection } = await faceOffsets(read);
    let chosen: {
      index: number;
      tables: Map<string, TableRecord>;
      version: number;
      ps: string;
    } | null = null;
    for (const [index, at] of offsets.entries()) {
      const dir = await tableDirectory(read, at);
      const ps = postscriptNameOf(await table(read, dir.tables, 'name'));
      const face = { index, tables: dir.tables, version: dir.version, ps };
      chosen ??= face;
      if (!collection || !postscriptName || ps === postscriptName) {
        chosen = face;
        break;
      }
    }
    if (!chosen) return unreadable;
    const { tables, version } = chosen;
    const os2 = await table(read, tables, 'OS/2', 96);
    const post = await table(read, tables, 'post', 32);
    const fsType = os2 && os2.byteLength >= 10 ? os2.getUint16(8) : 0;
    const familyClass = os2 && os2.byteLength >= 32 ? os2.getInt16(30) : 0;
    const fixed = !!post && post.byteLength >= 16 && post.getUint32(12) !== 0;
    const panose =
      os2 && os2.byteLength >= 42 ? Array.from({ length: 10 }, (_, i) => os2.getUint8(32 + i)) : [];
    const truetype =
      (version === SFNT_TT || version === TAG_TRUE) && tables.has('glyf') && tables.has('loca');
    const cff = version === TAG_OTTO || tables.has('CFF ') || tables.has('CFF2');
    const embedding = embeddingOf(fsType);
    const use: FontUse =
      embedding !== 'ok'
        ? embedding
        : truetype && !cff
          ? 'ok'
          : tables.has('cmap')
            ? 'outlines'
            : 'unreadable';
    return {
      index: chosen.index,
      collection,
      postscriptName: chosen.ps || postscriptName,
      use,
      standard: standardOf(familyClass, fixed, panose),
      variable: tables.has('fvar'),
    };
  } catch {
    return unreadable;
  }
}

/**
 * One face of a collection as a font file of its own (the face's tables,
 * 4-byte aligned); a single font is returned as it is. HarfBuzz and the
 * subsetter take the result like any .ttf.
 */
export function extractFace(bytes: Uint8Array, index: number): Uint8Array {
  const v = view(bytes);
  if (bytes.length < 12 || v.getUint32(0) !== TAG_TTCF) return bytes;
  const n = v.getUint32(8);
  if (index < 0 || index >= n) throw new Error('sfnt: no such face');
  const at = v.getUint32(12 + index * 4);
  const numTables = v.getUint16(at + 4);
  if (numTables > MAX_TABLES) throw new Error('sfnt: too many tables');
  const records = Array.from({ length: numTables }, (_, i) => {
    const o = at + 12 + i * 16;
    return {
      tag: v.getUint32(o),
      checksum: v.getUint32(o + 4),
      offset: v.getUint32(o + 8),
      length: v.getUint32(o + 12),
    };
  });
  const pad = (x: number): number => (x + 3) & ~3;
  const head = 12 + numTables * 16;
  const size = records.reduce((s, r) => s + pad(r.length), head);
  const out = new Uint8Array(size);
  const ov = view(out);
  out.set(bytes.subarray(at, at + 12), 0);
  let pos = head;
  for (const [i, r] of records.entries()) {
    if (r.offset + r.length > bytes.length) throw new Error('sfnt: truncated table');
    const o = 12 + i * 16;
    ov.setUint32(o, r.tag);
    ov.setUint32(o + 4, r.checksum);
    ov.setUint32(o + 8, pos);
    ov.setUint32(o + 12, r.length);
    out.set(bytes.subarray(r.offset, r.offset + r.length), pos);
    pos += pad(r.length);
  }
  return out;
}

/** Whether the font (a single face) has a table, e.g. `fvar`. */
export function hasTable(bytes: Uint8Array, tag: string): boolean {
  if (bytes.length < 12) return false;
  const v = view(bytes);
  const n = v.getUint16(4);
  for (let i = 0; i < n && 12 + i * 16 + 16 <= bytes.length; i++) {
    const o = 12 + i * 16;
    const t = String.fromCharCode(
      v.getUint8(o),
      v.getUint8(o + 1),
      v.getUint8(o + 2),
      v.getUint8(o + 3),
    );
    if (t === tag) return true;
  }
  return false;
}
