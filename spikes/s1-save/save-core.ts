// M0-S1 core: save through PDFium directly (ADR-001 B14), shared by the Node
// harness and the browser worker. EmbedPDF's `saveAsCopy` calls its own
// `PDFiumExt_SaveAsCopy(doc, writer)` with no flags argument and copies the
// result one byte at a time; here we call `FPDF_SaveAsCopy(doc, writer, flags)`
// with our own FPDF_FILEWRITE whose WriteBlock callback receives each block.

import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import type { PdfiumNative } from '@embedpdf/engines/pdfium';

export const FPDF_INCREMENTAL = 1;
export const FPDF_NO_INCREMENTAL = 2;
export const FPDF_REMOVE_SECURITY = 3;

export type SaveMode = 'embedpdf' | 'incremental' | 'rewrite';

interface Emscripten {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
  addFunction(fn: (...a: number[]) => number, sig: string): number;
  removeFunction(p: number): void;
}

type Fn = (...a: (number | string)[]) => number;

function em(mod: WrappedPdfiumModule): Emscripten {
  return mod.pdfium as unknown as Emscripten;
}

function fn(mod: WrappedPdfiumModule, name: string): Fn {
  const f = (mod as unknown as Record<string, Fn | undefined>)[name];
  if (!f) throw new Error(`PDFium function ${name} is not exported`);
  return f;
}

/**
 * The FPDF_DOCUMENT pointer EmbedPDF holds for an open document. Not public
 * API: `PdfiumNative.cache` is private. M1 needs EmbedPDF to expose this (or
 * a `saveAsCopy(doc, { flags })`), or we keep this one accessor under test.
 */
export function docPtrOf(native: PdfiumNative, docId: string): number {
  const cache = (
    native as unknown as { cache?: { getContext(id: string): { docPtr: number } | undefined } }
  ).cache;
  const ctx = cache?.getContext(docId);
  if (!ctx) throw new Error(`document ${docId} is not open`);
  return ctx.docPtr;
}

export interface SaveResult {
  bytes: Uint8Array<ArrayBuffer>;
  ms: number;
  blocks: number;
}

/**
 * FPDF_SaveAsCopy with explicit flags. `onBlock` (optional) receives every
 * block as PDFium produces it — the hook for streaming an incremental tail
 * straight to OPFS without assembling it first.
 */
export function saveWithFlags(
  mod: WrappedPdfiumModule,
  docPtr: number,
  flags: number,
  onBlock?: (block: Uint8Array) => void,
): SaveResult {
  const e = em(mod);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const writeBlock = e.addFunction((_self: number, data: number, size: number) => {
    const block = e.HEAPU8.slice(data, data + size);
    chunks.push(block);
    total += size;
    onBlock?.(block);
    return 1;
  }, 'iiii');
  // struct FPDF_FILEWRITE { int version; int (*WriteBlock)(FPDF_FILEWRITE*, const void*, unsigned long); }
  const writer = e.wasmExports.malloc(8);
  e.HEAP32[writer >> 2] = 1;
  e.HEAP32[(writer + 4) >> 2] = writeBlock;
  const t0 = performance.now();
  try {
    const ok = fn(mod, 'FPDF_SaveAsCopy')(docPtr, writer, flags);
    if (!ok) throw new Error(`FPDF_SaveAsCopy(flags=${String(flags)}) failed`);
  } finally {
    e.wasmExports.free(writer);
    e.removeFunction(writeBlock);
  }
  const ms = performance.now() - t0;
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    bytes.set(c, off);
    off += c.length;
  }
  return { bytes, ms, blocks: chunks.length };
}

export async function save(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  docId: string,
  mode: SaveMode,
): Promise<SaveResult> {
  if (mode === 'embedpdf') {
    const doc = { id: docId } as Parameters<PdfiumNative['saveAsCopy']>[0];
    const t0 = performance.now();
    const buf = (await native.saveAsCopy(doc).toPromise()) as ArrayBuffer;
    return { bytes: new Uint8Array(buf), ms: performance.now() - t0, blocks: 1 };
  }
  return saveWithFlags(
    mod,
    docPtrOf(native, docId),
    mode === 'incremental' ? FPDF_INCREMENTAL : FPDF_NO_INCREMENTAL,
  );
}

// ---------------------------------------------------------------------------
// Pure byte-level checks (unit-tested in tests/s1-pdf-bytes.test.ts).

const latin1 = (b: Uint8Array): string => {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < b.length; i += CH) {
    s += String.fromCharCode(...b.subarray(i, i + CH));
  }
  return s;
};

export function isPrefix(prefix: Uint8Array, whole: Uint8Array): boolean {
  if (whole.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (prefix[i] !== whole[i]) return false;
  return true;
}

export function count(bytes: Uint8Array, token: string): number {
  const s = latin1(bytes);
  let n = 0;
  for (let i = s.indexOf(token); i >= 0; i = s.indexOf(token, i + token.length)) n++;
  return n;
}

/** Object numbers of `N G obj` headers in the bytes (e.g. an incremental tail). */
export function objectNumbers(bytes: Uint8Array): number[] {
  return [...latin1(bytes).matchAll(/(?:^|[\r\n\s])(\d+)\s+(\d+)\s+obj\b/g)].map((m) =>
    Number(m[1]),
  );
}

/** Byte offsets from the last `startxref` of each revision. */
export function startxrefs(bytes: Uint8Array): number[] {
  return [...latin1(bytes).matchAll(/startxref\s+(\d+)/g)].map((m) => Number(m[1]));
}

/** The /ByteRange of the first signature dictionary, if any. */
export function byteRange(bytes: Uint8Array): [number, number, number, number] | undefined {
  const m = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(latin1(bytes));
  if (!m) return undefined;
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}

/** Signed bytes (ByteRange concatenation) and the DER CMS from /Contents. */
export function signatureParts(
  bytes: Uint8Array,
): { signed: Uint8Array; cms: Uint8Array } | undefined {
  const br = byteRange(bytes);
  if (!br) return undefined;
  const [a, b, c, d] = br;
  const signed = new Uint8Array(b + d);
  signed.set(bytes.subarray(a, a + b), 0);
  signed.set(bytes.subarray(c, c + d), b);
  const hex = latin1(bytes.subarray(a + b + 1, c - 1));
  const raw = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < raw.length; i++) raw[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  // /Contents is zero-padded: take the exact DER length from the outer SEQUENCE.
  const l0 = raw[1] ?? 0;
  let len = l0;
  let hdr = 2;
  if (l0 & 0x80) {
    const n = l0 & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + (raw[2 + i] ?? 0);
    hdr = 2 + n;
  }
  const cms = raw.slice(0, hdr + len);
  return { signed, cms };
}

// ---------------------------------------------------------------------------
// Narrow incremental tail (S1 findings, ADR-005):
//  1. PDFium's FPDF_INCREMENTAL appends every object it has *loaded*, not only
//     changed ones (a 23 MB file can grow by 22 MB for one annotation).
//  2. When the original's newest xref section is an xref *stream*, PDFium's
//     tail xref stream is malformed (no /Type, no endobj, wrong startxref).
// We keep PDFium's serialization of each object, drop unchanged objects, and
// write the xref section + trailer ourselves, in the same form as the original.

export interface TailObject {
  num: number;
  gen: number;
  start: number;
  end: number;
  /** Latin-1 text up to `stream` (whole object if none). */
  dict: string;
}

export interface NarrowResult {
  bytes: Uint8Array<ArrayBuffer>;
  kept: number[];
  dropped: number;
  droppedNums: number[];
  xrefKind: 'table' | 'stream';
}

/** Last `/Size N` in a file (trailer dict or xref-stream dict of the newest revision). */
export function trailerSize(bytes: Uint8Array): number {
  const s = latin1(bytes.subarray(Math.max(0, bytes.length - 4096)));
  const all = [...s.matchAll(/\/Size\s+(\d+)/g)];
  const last = all[all.length - 1];
  if (!last) throw new Error('no /Size in trailer');
  return Number(last[1]);
}

/** Absolute offset of the newest xref section (from the final `startxref`). */
export function lastStartxref(bytes: Uint8Array): number {
  const s = latin1(bytes.subarray(Math.max(0, bytes.length - 1024)));
  const all = [...s.matchAll(/startxref\s+(\d+)/g)];
  const last = all[all.length - 1];
  if (!last) throw new Error('no startxref');
  return Number(last[1]);
}

/** Whether the newest xref section of `bytes` is a classic table or an xref stream. */
export function xrefKind(bytes: Uint8Array): 'table' | 'stream' {
  const at = lastStartxref(bytes);
  return latin1(bytes.subarray(at, at + 8)).startsWith('xref') ? 'table' : 'stream';
}

/** The newest trailer dictionary text (classic `trailer << >>` or the xref-stream dict). */
export function newestTrailerDict(bytes: Uint8Array): string {
  const at = lastStartxref(bytes);
  if (latin1(bytes.subarray(at, at + 4)) === 'xref') {
    // A classic table can be hundreds of KB; the trailer sits just before the final startxref.
    const end = latin1(bytes.subarray(Math.max(at, bytes.length - 8192)));
    const t = end.lastIndexOf('trailer');
    if (t < 0) throw new Error('classic xref without trailer');
    return end.slice(t, end.lastIndexOf('startxref'));
  }
  const s = latin1(bytes.subarray(at, Math.min(bytes.length, at + 65536)));
  return s.slice(0, s.indexOf('stream'));
}

const isWs = (c: number | undefined): boolean =>
  c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;

function indexOfBytes(bytes: Uint8Array, token: string, from: number, to = bytes.length): number {
  const t = Array.from(token, (c) => c.charCodeAt(0));
  outer: for (let i = from; i + t.length <= to; i++) {
    for (let k = 0; k < t.length; k++) if (bytes[i + k] !== t[k]) continue outer;
    return i;
  }
  return -1;
}

/**
 * Sequentially parse the `N G obj … endobj` objects PDFium appended after
 * `from`. Stream data is skipped by its direct /Length, so binary data can't
 * be mistaken for object headers. Stops at `xref`, `trailer` or `startxref`.
 */
export function parseTailObjects(bytes: Uint8Array, from: number): TailObject[] {
  const out: TailObject[] = [];
  let i = from;
  const head = /^(\d+)\s+(\d+)\s+obj\b/;
  while (i < bytes.length) {
    while (i < bytes.length && isWs(bytes[i])) i++;
    const peek = latin1(bytes.subarray(i, i + 32));
    const m = head.exec(peek);
    if (!m) break; // xref / trailer / startxref
    const start = i;
    const endobjAt = indexOfBytes(bytes, 'endobj', i);
    // The dictionary precedes any stream data, so a bounded search is enough.
    const streamAt = indexOfBytes(bytes, 'stream', i, endobjAt >= 0 ? endobjAt : bytes.length);
    let end: number;
    let dict: string;
    if (streamAt >= 0 && (endobjAt < 0 || streamAt < endobjAt)) {
      dict = latin1(bytes.subarray(start, streamAt));
      const len = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
      let dataStart = streamAt + 6;
      if (bytes[dataStart] === 0x0d) dataStart++;
      if (bytes[dataStart] === 0x0a) dataStart++;
      const es = len
        ? indexOfBytes(bytes, 'endstream', dataStart + Number(len[1]))
        : indexOfBytes(bytes, 'endstream', dataStart);
      if (es < 0) throw new Error(`unterminated stream in object ${m[1] ?? '?'}`);
      // PDFium's own tail xref stream has no endobj: accept either right after endstream.
      let k = es + 9;
      while (k < bytes.length && isWs(bytes[k])) k++;
      end = latin1(bytes.subarray(k, k + 6)) === 'endobj' ? k + 6 : es + 9;
    } else {
      if (endobjAt < 0) throw new Error(`object ${m[1] ?? '?'} has no endobj`);
      end = endobjAt + 6;
      dict = latin1(bytes.subarray(start, end));
    }
    out.push({ num: Number(m[1]), gen: Number(m[2]), start, end, dict });
    i = end;
  }
  return out;
}

const REF = /(\d+)\s+(\d+)\s+R\b/g;

function trailerRef(dict: string, key: string): string | undefined {
  return new RegExp(`/${key}\\s+(\\d+\\s+\\d+\\s+R)`).exec(dict)?.[1];
}

function trailerIds(dict: string): [string, string] | undefined {
  const m = /\/ID\s*\[\s*(<[0-9A-Fa-f]*>)\s*(<[0-9A-Fa-f]*>)\s*\]/.exec(dict);
  return m ? [m[1] ?? '', m[2] ?? ''] : undefined;
}

/**
 * Keep: new objects (objnum ≥ original /Size), `dirty` objects reported by the
 * edit layer, existing objects that now reference a new object, and indirect
 * arrays referenced by any kept object (e.g. /Annots, /Fields). Then append
 * our own xref section and trailer.
 */
export function narrowTail(
  original: Uint8Array,
  full: Uint8Array,
  dirty: Iterable<number> = [],
  opts: { keepAll?: boolean } = {},
): NarrowResult {
  const origSize = trailerSize(original);
  const kind = xrefKind(original);
  const origTrailer = newestTrailerDict(original);
  const objects = parseTailObjects(full, original.length);
  // PDFium's own xref-stream object (if any) is replaced by ours.
  const pdfiumXref = objects.find(
    (o) => /\/Root\s+\d+\s+\d+\s+R/.test(o.dict) && /\/W\s*\[/.test(o.dict),
  );
  const pdfiumTrailer = pdfiumXref?.dict ?? newestTrailerDict(full);
  const spans = new Map(objects.filter((o) => o !== pdfiumXref).map((o) => [o.num, o]));
  const refsOf = (num: number): number[] =>
    [...(spans.get(num)?.dict ?? '').matchAll(REF)]
      .map((m) => Number(m[1]))
      .filter((r) => r !== num);

  const keep = new Set<number>();
  // keepAll = fallback: every object PDFium appended, but with our (correct) xref.
  for (const num of spans.keys()) if (opts.keepAll || num >= origSize) keep.add(num);
  for (const d of dirty) if (spans.has(d)) keep.add(d);
  for (const num of spans.keys()) {
    if (!keep.has(num) && refsOf(num).some((r) => r >= origSize)) keep.add(num);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const num of [...keep]) {
      for (const r of refsOf(num)) {
        const span = spans.get(r);
        if (!keep.has(r) && span && /obj\s*\[/.test(span.dict.slice(0, 64))) {
          keep.add(r);
          grew = true;
        }
      }
    }
  }

  const kept = [...keep].sort((a, b) => a - b);
  const droppedNums = [...spans.keys()].filter((n) => !keep.has(n)).sort((a, b) => a - b);
  if (kept.length === 0) {
    // Nothing changed: no new revision (Ctrl+S is a no-op).
    return {
      bytes: original.slice(),
      kept,
      dropped: droppedNums.length,
      droppedNums,
      xrefKind: kind,
    };
  }
  const enc = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
  const lastByte = original[original.length - 1];
  const parts: Uint8Array[] = [original];
  let pos = original.length;
  const push = (b: Uint8Array): void => {
    parts.push(b);
    pos += b.length;
  };
  if (lastByte !== 0x0a && lastByte !== 0x0d) push(enc('\r\n'));
  const offsets = new Map<number, [number, number]>();
  for (const num of kept) {
    const o = spans.get(num);
    if (!o) continue;
    offsets.set(num, [pos, o.gen]);
    push(full.subarray(o.start, o.end));
    push(enc('\r\n'));
  }

  // Trailer entries: Root/Encrypt/Info from PDFium's new trailer; the first
  // /ID element stays the original's permanent identifier (ISO 32000-1 14.4).
  const pdfiumSize = Number(/\/Size\s+(\d+)/.exec(pdfiumTrailer)?.[1] ?? origSize);
  const size = Math.max(pdfiumSize, (kept[kept.length - 1] ?? 0) + 1, origSize);
  const prev = lastStartxref(original);
  const root = trailerRef(pdfiumTrailer, 'Root') ?? trailerRef(origTrailer, 'Root');
  const encrypt = trailerRef(pdfiumTrailer, 'Encrypt') ?? trailerRef(origTrailer, 'Encrypt');
  const info = trailerRef(pdfiumTrailer, 'Info') ?? trailerRef(origTrailer, 'Info');
  if (!root) throw new Error('narrowTail: no /Root in trailer');
  if (trailerRef(origTrailer, 'Encrypt') && !encrypt) throw new Error('narrowTail: lost /Encrypt');
  const idOrig = trailerIds(origTrailer);
  const idNew = trailerIds(pdfiumTrailer);
  const id = idOrig
    ? `[${idOrig[0]}${idNew?.[1] ?? idOrig[1]}]`
    : idNew
      ? `[${idNew[0]}${idNew[1]}]`
      : undefined;
  const common =
    `/Root ${root}` +
    (encrypt ? ` /Encrypt ${encrypt}` : '') +
    (info ? ` /Info ${info}` : '') +
    (id ? ` /ID ${id}` : '') +
    ` /Prev ${String(prev)}`;

  const groups = (nums: number[]): [number, number][] => {
    const g: [number, number][] = [];
    for (const n of nums) {
      const last = g[g.length - 1];
      if (last && last[0] + last[1] === n) last[1]++;
      else g.push([n, 1]);
    }
    return g;
  };

  const xrefStart = pos;
  if (kind === 'table') {
    let x = 'xref\r\n';
    for (const [first, n] of groups(kept)) {
      x += `${String(first)} ${String(n)}\r\n`;
      for (let k = first; k < first + n; k++) {
        const [off, gen] = offsets.get(k) ?? [0, 0];
        x += `${String(off).padStart(10, '0')} ${String(gen).padStart(5, '0')} n\r\n`;
      }
    }
    x += `trailer\r\n<< /Size ${String(size)} ${common} >>\r\nstartxref\r\n${String(xrefStart)}\r\n%%EOF\r\n`;
    push(enc(x));
  } else {
    // Uncompressed xref stream; its own entry is included. W = [1 4 2].
    const selfNum = size;
    const nums = [...kept, selfNum];
    offsets.set(selfNum, [xrefStart, 0]);
    const data = new Uint8Array(nums.length * 7);
    nums.forEach((n, i) => {
      const [off, gen] = offsets.get(n) ?? [0, 0];
      const b = i * 7;
      data[b] = 1;
      data[b + 1] = (off >>> 24) & 0xff;
      data[b + 2] = (off >>> 16) & 0xff;
      data[b + 3] = (off >>> 8) & 0xff;
      data[b + 4] = off & 0xff;
      data[b + 5] = (gen >>> 8) & 0xff;
      data[b + 6] = gen & 0xff;
    });
    const index = groups(nums).flat().join(' ');
    push(
      enc(
        `${String(selfNum)} 0 obj\r\n<< /Type /XRef /Size ${String(selfNum + 1)} /W [1 4 2] /Index [${index}] ${common} /Length ${String(data.length)} >>\r\nstream\r\n`,
      ),
    );
    push(data);
    push(enc(`\r\nendstream\r\nendobj\r\nstartxref\r\n${String(xrefStart)}\r\n%%EOF\r\n`));
  }

  const bytes = new Uint8Array(pos);
  let o = 0;
  for (const p of parts) {
    bytes.set(p, o);
    o += p.length;
  }
  return { bytes, kept, dropped: droppedNums.length, droppedNums, xrefKind: kind };
}
