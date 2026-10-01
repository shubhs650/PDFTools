// Semantic dirty set (ADR-016 decision 2, from spikes/s14-pages/semdiff.ts):
// which objects really differ between two states of a document. PDFium's
// FPDF_INCREMENTAL output re-appends every object it has loaded, and a page
// operation's changes are invisible to the save tracker, so after one the
// tracker compares objects instead: strings decrypted, numbers by value,
// stream data after Flate decoding (PDFium re-encodes an unfiltered stream it
// has loaded). Synchronous inflate (fflate) keeps a comparison over a view of
// the WASM heap within one run of microtasks, so no PDFium call can grow (and
// detach) the heap meanwhile.
import { unzlibSync } from 'fflate';
import {
  Parser,
  PdfName,
  PdfRef,
  PdfStream,
  PdfString,
  isDict,
  numOf,
  serializeIndirect,
  type PdfDict,
  type PdfValue,
} from '../../../model/pdf/objects';
import type { Inflate, PdfReader } from '../../../model/pdf/reader';
import type { StandardCrypt } from '../../../model/pdf/security/standard';
import { parseTailObjects } from './narrowTail';

/** One complete `N G obj … endobj`, as written in a file. */
export interface Span {
  num: number;
  gen: number;
  bytes: Uint8Array;
}

/** Inflate that settles in a microtask (see the header comment). */
export const syncInflate: Inflate = (bytes) => Promise.resolve(unzlibSync(bytes));

/** The objects written after `from` (xref streams excluded), later versions winning. */
export function spansOf(bytes: Uint8Array, from: number): Map<number, Span> {
  const out = new Map<number, Span>();
  for (const o of parseTailObjects(bytes, from)) {
    // Xref streams, ours and PDFium's (which has no /Type, ADR-005 d1).
    if (/\/Type\s*\/XRef\b/.test(o.dict)) continue;
    if (/\/Root\s+\d+\s+\d+\s+R/.test(o.dict) && /\/W\s*\[/.test(o.dict)) continue;
    out.set(o.num, { num: o.num, gen: o.gen, bytes: bytes.slice(o.start, o.end) });
  }
  return out;
}

function latin1Slice(b: Uint8Array, from: number, to: number): string {
  let s = '';
  for (let i = from; i < to; i++) s += String.fromCharCode(b[i] ?? 0);
  return s;
}

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
function decoded(s: PdfStream): Uint8Array | null {
  const f = s.dict.get('Filter');
  if (f === undefined) return s.raw;
  const name = Array.isArray(f) && f.length === 1 ? f[0] : f;
  if (name instanceof PdfName && name.name === 'FlateDecode' && !s.dict.has('DecodeParms')) {
    try {
      return unzlibSync(s.raw);
    } catch {
      return null;
    }
  }
  return null;
}

/** Same stream data under a different encoding (PDFium re-encodes streams it loaded). */
function sameDecoded(a: PdfValue, b: PdfValue): boolean {
  if (!(a instanceof PdfStream) || !(b instanceof PdfStream)) return false;
  const keys = new Set([...a.dict.keys(), ...b.dict.keys()]);
  for (const k of keys)
    if (!FILTER_KEYS.has(k) && !sameValue(a.dict.get(k), b.dict.get(k))) return false;
  const x = decoded(a);
  const y = decoded(b);
  return x !== null && y !== null && sameBytes(x, y);
}

/** Parses one span into its value (with stream data), decrypted when `crypt` is given. */
export function parseSpan(span: Span, crypt: StandardCrypt | null): PdfValue {
  const p = new Parser(span.bytes, 0);
  p.parse();
  p.parse();
  p.expectKeyword('obj');
  let value = p.parse();
  if (isDict(value)) {
    const len = numOf(value.get('Length'));
    let s: PdfStream | null = null;
    if (len !== undefined) s = p.streamAfter(value, len);
    else {
      // An indirect /Length: the data runs to `endstream`.
      const at = p.pos;
      const text = latin1Slice(span.bytes, at, span.bytes.length);
      const m = /^\s*stream\r?\n/.exec(text);
      const end = text.lastIndexOf('endstream');
      if (m && end > 0) {
        let stop = at + end;
        if (span.bytes[stop - 1] === 0x0a) stop--;
        if (span.bytes[stop - 1] === 0x0d) stop--;
        s = new PdfStream(value, span.bytes.subarray(at + m[0].length, stop));
      }
    }
    if (s) value = s;
  }
  if (!crypt) return value;
  if (value instanceof PdfStream) {
    return new PdfStream(
      crypt.mapStrings(value.dict, span.num, span.gen, false) as PdfDict,
      crypt.decryptStream(span.num, span.gen, value.raw),
    );
  }
  return crypt.mapStrings(value, span.num, span.gen, false);
}

/** Two versions of one object mean the same (both decrypted with the document's key). */
export function sameObject(a: PdfValue, b: PdfValue): boolean {
  return sameValue(a, b) || sameDecoded(a, b);
}

/**
 * An object as the file `reader` reads it, decrypted (null when absent). For
 * a stream, the raw data is decrypted too, like `parseSpan`.
 */
export async function readerValue(reader: PdfReader, num: number): Promise<PdfValue | undefined> {
  const e = reader.xref.get(num);
  if (!e || e.type === 0) return undefined;
  const v = await reader.get(num);
  if (v instanceof PdfStream && reader.crypt && e.type === 1) {
    return new PdfStream(v.dict, reader.crypt.decryptStream(num, e.gen, v.raw));
  }
  return v;
}

/**
 * The object's bytes as written in the file `reader` reads (`N G obj …
 * endobj`), for writing that version again; an object inside an object
 * stream is serialized (its strings encrypted for its own number when the
 * file is encrypted). Null when the file has no such object.
 */
export async function readerSpan(
  reader: PdfReader,
  bytes: Uint8Array,
  num: number,
): Promise<Span | null> {
  const e = reader.xref.get(num);
  if (!e || e.type === 0) return null;
  if (e.type === 1) {
    const [o] = parseTailObjects(bytes, e.offset);
    if (o?.num !== num) return null;
    return { num, gen: o.gen, bytes: bytes.slice(o.start, o.end) };
  }
  const v = await reader.get(num);
  if (v instanceof PdfStream) return null; // streams are never in object streams
  const value = reader.crypt ? reader.crypt.mapStrings(v, num, 0, true) : v;
  return { num, gen: 0, bytes: serializeIndirect(num, 0, value) };
}
