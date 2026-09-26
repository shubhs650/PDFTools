// Narrow incremental tail (ADR-005 decisions 1–2). PDFium's FPDF_INCREMENTAL
// output (1) re-appends every object it has loaded, not only changed ones, and
// (2) writes a malformed xref stream when the original's newest section is an
// xref stream. We keep PDFium's serialization of each object (it handles
// encryption), keep only what changed, and write the xref section and trailer
// ourselves in the base's form.
//
// Kept: objects new since the base (objnum ≥ base /Size), objects the edit
// layer reported dirty, existing objects that now reference a new object (the
// hidden catalog / page edits), indirect arrays referenced by kept objects
// (/Annots, /Fields), and extra objects patched by our own object layer
// (ADR-007 decision 5), which replace PDFium's version of the same number.
import { concatBytes, encodeLatin1, indexOfBytes, isWs, latin1 } from './bytes';
import { trailerIds, trailerRef, writeXrefSection, type SaveBase, type XrefKind } from './xref';

export interface TailObject {
  num: number;
  gen: number;
  start: number;
  end: number;
  /** Latin-1 text up to `stream` (the whole object if there is none). */
  dict: string;
}

/** A complete `N G obj … endobj` written by our own object layer (ADR-007 d5). */
export interface ExtraObject {
  num: number;
  gen: number;
  bytes: Uint8Array;
}

export interface NarrowResult {
  /** Bytes to append to the base file (empty when nothing changed). */
  tail: Uint8Array<ArrayBuffer>;
  kept: number[];
  droppedNums: number[];
  xrefKind: XrefKind;
  /** The base after appending `tail` (unchanged when the tail is empty). */
  next: SaveBase;
}

/**
 * Sequentially parse the `N G obj … endobj` objects after `from`. Stream data
 * is skipped by its direct /Length, so binary data can't pose as a header.
 * Stops at `xref`, `trailer` or `startxref`.
 */
export function parseTailObjects(bytes: Uint8Array, from: number): TailObject[] {
  const out: TailObject[] = [];
  let i = from;
  const head = /^(\d+)\s+(\d+)\s+obj\b/;
  while (i < bytes.length) {
    while (i < bytes.length && isWs(bytes[i])) i++;
    const m = head.exec(latin1(bytes.subarray(i, i + 32)));
    if (!m) break;
    const start = i;
    const endobjAt = indexOfBytes(bytes, 'endobj', i);
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
      // PDFium's own tail xref stream has no endobj: accept either after endstream.
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

export interface NarrowOptions {
  /** Keep every appended object (verification fallback, ADR-005 d2) — still with our xref. */
  keepAll?: boolean;
  /** Patched objects from our object layer (ADR-007 d5). */
  extra?: readonly ExtraObject[];
}

/**
 * @param base  the file as last saved
 * @param full  PDFium's FPDF_INCREMENTAL output (its prefix is the file PDFium opened)
 * @param from  where PDFium's appended objects start in `full` (the opened file's length)
 * @param dirty existing objects changed since the base
 */
export function narrowTail(
  base: SaveBase,
  full: Uint8Array,
  from: number,
  dirty: Iterable<number> = [],
  opts: NarrowOptions = {},
): NarrowResult {
  const objects = parseTailObjects(full, from);
  // PDFium's own xref-stream object (if any) is replaced by ours.
  const pdfiumXref = objects.find(
    (o) => /\/Root\s+\d+\s+\d+\s+R/.test(o.dict) && /\/W\s*\[/.test(o.dict),
  );
  const pdfiumTrailer =
    pdfiumXref?.dict ??
    /trailer[\s\S]*$/.exec(latin1(full.subarray(Math.max(from, full.length - 8192))))?.[0] ??
    '';
  const spans = new Map(objects.filter((o) => o !== pdfiumXref).map((o) => [o.num, o]));
  const extra = new Map((opts.extra ?? []).map((e) => [e.num, e]));
  const refsOf = (num: number): number[] => {
    const text = extra.has(num)
      ? latin1(extra.get(num)?.bytes.subarray(0, 4096) ?? new Uint8Array())
      : (spans.get(num)?.dict ?? '');
    return [...text.matchAll(REF)].map((m) => Number(m[1])).filter((r) => r !== num);
  };
  const newFrom = base.newFrom ?? base.size;
  const isNew = (n: number): boolean => n >= newFrom;

  const keep = new Set<number>(extra.keys());
  for (const num of spans.keys()) if (opts.keepAll || isNew(num)) keep.add(num);
  for (const d of dirty) if (spans.has(d)) keep.add(d);
  for (const num of spans.keys()) {
    if (!keep.has(num) && refsOf(num).some(isNew)) keep.add(num);
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
    // Nothing changed since the base: no new revision (Ctrl+S is a no-op).
    return { tail: new Uint8Array(0), kept, droppedNums, xrefKind: base.kind, next: base };
  }

  const parts: Uint8Array[] = [];
  let pos = base.length;
  const push = (b: Uint8Array): void => {
    parts.push(b);
    pos += b.length;
  };
  if (!base.endsWithEol) push(encodeLatin1('\r\n'));
  const offsets = new Map<number, [number, number]>();
  for (const num of kept) {
    const e = extra.get(num);
    const o = spans.get(num);
    if (e) {
      offsets.set(num, [pos, e.gen]);
      push(e.bytes);
    } else if (o) {
      offsets.set(num, [pos, o.gen]);
      push(full.subarray(o.start, o.end));
    } else continue;
    push(encodeLatin1('\r\n'));
  }

  // Root/Encrypt/Info from PDFium's trailer (falling back to the base's); the
  // first /ID element stays the file's permanent identifier (ISO 32000-1 14.4).
  const pdfiumSize = Number(/\/Size\s+(\d+)/.exec(pdfiumTrailer)?.[1] ?? base.size);
  const size = Math.max(pdfiumSize, (kept.at(-1) ?? 0) + 1, base.size);
  const root = trailerRef(pdfiumTrailer, 'Root') ?? trailerRef(base.trailer, 'Root');
  const encrypt = trailerRef(pdfiumTrailer, 'Encrypt') ?? trailerRef(base.trailer, 'Encrypt');
  const info = trailerRef(pdfiumTrailer, 'Info') ?? trailerRef(base.trailer, 'Info');
  if (!root) throw new Error('narrowTail: no /Root in trailer');
  if (trailerRef(base.trailer, 'Encrypt') && !encrypt) throw new Error('narrowTail: lost /Encrypt');
  const idBase = trailerIds(base.trailer);
  const idNew = trailerIds(pdfiumTrailer);
  const id = idBase
    ? `[${idBase[0]}${idNew?.[1] ?? idBase[1]}]`
    : idNew
      ? `[${idNew[0]}${idNew[1]}]`
      : undefined;
  const common =
    `/Root ${root}` +
    (encrypt ? ` /Encrypt ${encrypt}` : '') +
    (info ? ` /Info ${info}` : '') +
    (id ? ` /ID ${id}` : '') +
    ` /Prev ${String(base.startxref)}`;

  const xrefStart = pos;
  const xref = writeXrefSection(base.kind, xrefStart, offsets, size, common);
  push(xref.bytes);
  const tail = concatBytes(parts);
  return {
    tail,
    kept,
    droppedNums,
    xrefKind: base.kind,
    next: {
      length: base.length + tail.length,
      size: xref.size,
      kind: base.kind,
      trailer: xref.trailer,
      startxref: xrefStart,
      endsWithEol: true,
      newFrom: Math.max(pdfiumSize, newFrom),
    },
  };
}
