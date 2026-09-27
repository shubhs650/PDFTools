// Print-ready output, last step (D-25, §7.13, M2-16, ADR-013 decision 6): the
// flattened copy PDFium wrote as a full rewrite still has the catalog's
// /AcroForm, which keeps the old field objects and their values in the file.
// This drops it, then drops every object nothing reaches any more (the fields,
// pages removed from the copy), and writes a new cross-reference table.
//
// Input: a file with one classic xref section (what FPDF_SaveAsCopy writes
// with FPDF_NO_INCREMENTAL, even from a source with object streams). Object
// numbers and bytes are kept as they are, so encrypted strings and streams
// (keyed by object number) stay valid. Refs are found by pattern, so a string
// that happens to read "n g R" can only keep an extra object, never lose one.
// Pure (no PDFium): runs in the Work worker and in unit tests.
import { dictAt } from './ocg';

export class PrintReadyFormatError extends Error {
  override readonly name = 'PrintReadyFormatError';
}

const latin1 = (u8: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < u8.length; i += 0x4000)
    out += String.fromCharCode(...u8.subarray(i, i + 0x4000));
  return out;
};
const ascii = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(s, (c) => c.charCodeAt(0));

interface XrefEntry {
  num: number;
  gen: number;
  offset: number;
}

interface Parsed {
  entries: XrefEntry[];
  size: number;
  trailer: string;
  xrefAt: number;
}

/** The last xref table and its trailer. Throws on anything but one classic section. */
function parseXref(bytes: Uint8Array): Parsed {
  const tail = latin1(bytes.subarray(Math.max(0, bytes.length - 1024)));
  const sx = /startxref\s+(\d+)/g;
  let m: RegExpExecArray | null;
  let xrefAt = -1;
  while ((m = sx.exec(tail))) xrefAt = Number(m[1]);
  if (xrefAt < 0 || xrefAt >= bytes.length) throw new PrintReadyFormatError('no startxref');
  const text = latin1(bytes.subarray(xrefAt));
  if (!text.startsWith('xref')) throw new PrintReadyFormatError('not a classic xref table');
  const trailerAt = text.indexOf('trailer');
  if (trailerAt < 0) throw new PrintReadyFormatError('no trailer');
  const trailer = dictAt(text, trailerAt);
  if (!trailer) throw new PrintReadyFormatError('bad trailer');
  if (/\/(Prev|XRefStm)\b/.test(trailer))
    throw new PrintReadyFormatError('more than one xref section');
  const lines = text
    .slice(4, trailerAt)
    .trim()
    .split(/\r\n|\r|\n/);
  const entries: XrefEntry[] = [];
  let num = 0;
  let size = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;
    const head = /^(\d+)\s+(\d+)$/.exec(line);
    if (head) {
      num = Number(head[1]);
      size = Math.max(size, num + Number(head[2]));
      continue;
    }
    const e = /^(\d{10})\s+(\d{5})\s+([nf])$/.exec(line);
    if (!e) throw new PrintReadyFormatError('bad xref entry');
    if (e[3] === 'n') entries.push({ num, gen: Number(e[2]), offset: Number(e[1]) });
    num++;
  }
  const declared = /\/Size\s+(\d+)/.exec(trailer);
  size = Math.max(size, declared ? Number(declared[1]) : 0);
  return { entries, size, trailer, xrefAt };
}

/** Object numbers referenced ("n g R") in `text`. */
const refs = (text: string): number[] =>
  [...text.matchAll(/(\d+)\s+\d+\s+R(?![A-Za-z0-9])/g)].map((r) => Number(r[1]));

/**
 * The part of an object that can hold references: a stream's dictionary
 * (never its data), or the whole of any other object.
 */
function syntaxOf(chunk: Uint8Array): string {
  let text = latin1(chunk.subarray(0, 4096));
  if (!/^\s*\d+\s+\d+\s+obj\s*<</.test(text)) return latin1(chunk);
  let dict = dictAt(text, 0);
  if (!dict && chunk.length > 4096) {
    text = latin1(chunk);
    dict = dictAt(text, 0);
  }
  if (!dict) return latin1(chunk);
  const after = text.slice(text.indexOf(dict) + dict.length).trimStart();
  return after.startsWith('stream') ? dict : latin1(chunk);
}

/** `dict` without `/key` and its value (a reference, a dictionary, an array or a token). */
export function removeKey(dict: string, key: string): string {
  const at = new RegExp(`/${key}(?![A-Za-z0-9#])`).exec(dict);
  if (!at) return dict;
  const start = at.index;
  let i = start + at[0].length;
  while (/\s/.test(dict[i] ?? '')) i++;
  const rest = dict.slice(i);
  let len: number;
  const ref = /^\d+\s+\d+\s+R/.exec(rest);
  if (ref) len = ref[0].length;
  else if (rest.startsWith('<<')) len = dictAt(rest, 0)?.length ?? 0;
  else if (rest.startsWith('[')) {
    let depth = 0;
    len = 0;
    for (let k = 0; k < rest.length; k++) {
      if (rest[k] === '[') depth++;
      else if (rest[k] === ']' && --depth === 0) {
        len = k + 1;
        break;
      }
    }
  } else len = /^[^\s/<>[\]()]*|^\/[^\s/<>[\]()]*/.exec(rest)?.[0].length ?? 0;
  if (len === 0) throw new PrintReadyFormatError(`bad /${key} value`);
  return dict.slice(0, start) + ' ' + dict.slice(i + len);
}

export interface PruneResult {
  bytes: Uint8Array<ArrayBuffer>;
  /** Objects dropped as unreachable. */
  dropped: number;
}

/**
 * Removes the catalog's /AcroForm and every object no longer reachable from
 * the trailer (/Root, /Info, /Encrypt), and writes a fresh xref table.
 */
export function prunePrintReady(bytes: Uint8Array): PruneResult {
  const { entries, size, trailer, xrefAt } = parseXref(bytes);
  const sorted = [...entries].sort((a, b) => a.offset - b.offset);
  const chunks = new Map<number, { entry: XrefEntry; bytes: Uint8Array }>();
  sorted.forEach((e, i) => {
    const end = sorted[i + 1]?.offset ?? xrefAt;
    const chunk = bytes.subarray(e.offset, end);
    const head = latin1(chunk.subarray(0, 32));
    if (!new RegExp(`^\\s*${String(e.num)}\\s+${String(e.gen)}\\s+obj`).test(head))
      throw new PrintReadyFormatError(`object ${String(e.num)} is not at its offset`);
    chunks.set(e.num, { entry: e, bytes: chunk });
  });

  const root = /\/Root\s+(\d+)\s+\d+\s+R/.exec(trailer);
  if (!root) throw new PrintReadyFormatError('no /Root');
  const rootNum = Number(root[1]);
  const catalogChunk = chunks.get(rootNum);
  if (!catalogChunk) throw new PrintReadyFormatError('catalog missing');
  const catalogText = latin1(catalogChunk.bytes);
  const catalogDict = dictAt(catalogText, 0);
  if (!catalogDict) throw new PrintReadyFormatError('bad catalog');
  const newDict = removeKey(catalogDict, 'AcroForm');
  const catalog = ascii(catalogText.replace(catalogDict, () => newDict));

  // Reachability from the trailer, with the edited catalog.
  const keep = new Set<number>();
  const queue = refs(trailer);
  while (queue.length > 0) {
    const n = queue.pop() ?? 0;
    if (keep.has(n)) continue;
    const c = chunks.get(n);
    if (!c) continue;
    keep.add(n);
    queue.push(...refs(n === rootNum ? newDict : syntaxOf(c.bytes)));
  }

  // Header (everything before the first object), kept objects, new xref, trailer.
  const firstAt = sorted[0]?.offset ?? xrefAt;
  const parts: Uint8Array[] = [bytes.subarray(0, firstAt)];
  let at = firstAt;
  const offsets = new Map<number, { offset: number; gen: number }>();
  for (const e of sorted) {
    if (!keep.has(e.num)) continue;
    const chunk = e.num === rootNum ? catalog : (chunks.get(e.num)?.bytes ?? new Uint8Array(0));
    offsets.set(e.num, { offset: at, gen: e.gen });
    parts.push(chunk);
    at += chunk.length;
    if (e.num === rootNum && !/[\r\n]$/.test(latin1(chunk.subarray(-1)))) {
      parts.push(ascii('\n'));
      at += 1;
    }
  }
  const gens = new Map(entries.map((e) => [e.num, e.gen]));
  // Free list: 0 → first free → … → 0; a freed object's generation goes up by one.
  const free: number[] = [];
  for (let n = 1; n < size; n++) if (!offsets.has(n)) free.push(n);
  const next = new Map<number, number>();
  [0, ...free].forEach((n, i) => next.set(n, free[i] ?? 0));
  let xref = `xref\n0 ${String(size)}\n`;
  const pad = (v: number, w: number) => String(v).padStart(w, '0');
  for (let n = 0; n < size; n++) {
    const o = offsets.get(n);
    if (o) xref += `${pad(o.offset, 10)} ${pad(o.gen, 5)} n\r\n`;
    else {
      const gen = n === 0 ? 65535 : Math.min(65535, (gens.get(n) ?? 0) + (gens.has(n) ? 1 : 0));
      xref += `${pad(next.get(n) ?? 0, 10)} ${pad(gen, 5)} f\r\n`;
    }
  }
  const newTrailer = trailer.replace(/\/Size\s+\d+/, `/Size ${String(size)}`);
  xref += `trailer\n${newTrailer}\nstartxref\n${String(at)}\n%%EOF\n`;
  parts.push(ascii(xref));

  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return { bytes: out, dropped: entries.length - keep.size };
}
