// M4-01 spike (ADR-016): which of the objects PDFium re-appends in its
// FPDF_INCREMENTAL output actually changed since the base? PDFium re-writes
// every object it has loaded, so a page operation (whose changes the save
// tracker never sees) makes the save fall back to keep-all. Here each appended
// object is parsed and compared with the base's version, semantically
// (decrypted strings and stream data, numbers by value), and the changed ones
// become the narrow tail's dirty set.
import { parseTailObjects } from '../../src/workers/render/save/narrowTail.ts';
import {
  isDict,
  numOf,
  Parser,
  PdfName,
  PdfRef,
  PdfStream,
  PdfString,
  type PdfValue,
} from '../../src/model/pdf/objects.ts';
import { inflateStream, type PdfReader } from '../../src/model/pdf/reader.ts';

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Deep, semantic equality of two PDF values; `/Length` of streams is ignored. */
export function sameValue(a: PdfValue | undefined, b: PdfValue | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b;
  if (a instanceof PdfName && b instanceof PdfName) return a.name === b.name;
  if (a instanceof PdfRef && b instanceof PdfRef) return a.num === b.num && a.gen === b.gen;
  if (a instanceof PdfString && b instanceof PdfString) return sameBytes(a.bytes, b.bytes);
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  if (isDict(a) && isDict(b)) {
    const keys = new Set([...a.keys(), ...b.keys()]);
    keys.delete('Length');
    for (const k of keys) if (!sameValue(a.get(k), b.get(k))) return false;
    return true;
  }
  if (a instanceof PdfStream && b instanceof PdfStream)
    return sameValue(a.dict, b.dict) && sameBytes(a.raw, b.raw);
  return false;
}

const FILTER_KEYS = new Set(['Length', 'Filter', 'DecodeParms']);

/** Flate or no filter only; anything else is "cannot tell" (treated as changed). */
async function decoded(s: PdfStream): Promise<Uint8Array | null> {
  const f = s.dict.get('Filter');
  if (f === undefined) return s.raw;
  const name = Array.isArray(f) && f.length === 1 ? f[0] : f;
  if (name instanceof PdfName && name.name === 'FlateDecode' && !s.dict.has('DecodeParms'))
    return inflateStream(s.raw);
  return null;
}

/**
 * PDFium re-encodes an unfiltered stream with Flate once it has loaded it
 * (page contents after a page load): same data, different bytes.
 */
async function sameDecoded(a: PdfValue, b: PdfValue): Promise<boolean> {
  if (!(a instanceof PdfStream) || !(b instanceof PdfStream)) return false;
  const keys = new Set([...a.dict.keys(), ...b.dict.keys()]);
  for (const k of keys)
    if (!FILTER_KEYS.has(k) && !sameValue(a.dict.get(k), b.dict.get(k))) return false;
  const [x, y] = await Promise.all([decoded(a), decoded(b)]);
  return x !== null && y !== null && sameBytes(x, y);
}

/** Parses one `N G obj … endobj` at `start` of `bytes`, with its stream data. */
function parseAt(bytes: Uint8Array, start: number): { num: number; gen: number; value: PdfValue } {
  const p = new Parser(bytes, start);
  const num = p.parse();
  const gen = p.parse();
  if (typeof num !== 'number' || typeof gen !== 'number') throw new Error('not an object');
  p.expectKeyword('obj');
  let value = p.parse();
  if (isDict(value)) {
    const len = numOf(value.get('Length'));
    const s = len === undefined ? null : p.streamAfter(value, len);
    if (s) value = s;
  }
  return { num, gen, value };
}

export interface DiffResult {
  /** Existing objects whose value differs from the base (the dirty set). */
  changed: number[];
  /** Existing objects PDFium re-appended unchanged. */
  unchanged: number;
  /** Objects at or past the base's /Size (always kept by the narrow tail). */
  fresh: number;
  ms: number;
}

/**
 * @param base  reader over the file as last saved (opened with the password)
 * @param full  PDFium's FPDF_INCREMENTAL output
 * @param from  length of the file PDFium opened
 */
export async function changedObjects(
  base: PdfReader,
  full: Uint8Array,
  from: number,
): Promise<DiffResult> {
  const t0 = performance.now();
  const size = base.maxObjNum();
  const out: DiffResult = { changed: [], unchanged: 0, fresh: 0, ms: 0 };
  for (const o of parseTailObjects(full, from)) {
    if (/\/Type\s*\/XRef\b/.test(o.dict)) continue;
    if (o.num >= size || !base.xref.has(o.num)) {
      out.fresh++;
      continue;
    }
    const { num, gen, value } = parseAt(full, o.start);
    let now = value;
    let was = await base.get(num);
    const crypt = base.crypt;
    if (crypt) {
      // Strings: the base's are decrypted by the reader; PDFium's are not yet.
      if (now instanceof PdfStream) {
        now = new PdfStream(
          crypt.mapStrings(now.dict, num, gen, false) as Map<string, PdfValue>,
          crypt.decryptStream(num, gen, now.raw),
        );
        if (was instanceof PdfStream)
          was = new PdfStream(was.dict, crypt.decryptStream(num, gen, was.raw));
      } else now = crypt.mapStrings(now, num, gen, false);
    }
    if (sameValue(was, now) || (await sameDecoded(was, now))) out.unchanged++;
    else out.changed.push(num);
  }
  out.ms = Math.round((performance.now() - t0) * 100) / 100;
  return out;
}
