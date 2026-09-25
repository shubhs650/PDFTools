// Cross-reference sections and trailers (ADR-005). A save base describes the
// newest revision of the file as last saved, so the next tail can link to it
// (/Prev) and keep its form (table or stream) without holding its bytes.
import { encodeLatin1, latin1 } from './bytes';

export type XrefKind = 'table' | 'stream';

export interface SaveBase {
  /** File length in bytes. */
  length: number;
  /** /Size of the newest trailer (first free object number). */
  size: number;
  kind: XrefKind;
  /** Newest trailer dictionary text (classic trailer or xref-stream dict). */
  trailer: string;
  /** Offset of the newest xref section. */
  startxref: number;
  /** Whether the file ends in an end-of-line (else the tail starts with one). */
  endsWithEol: boolean;
  /**
   * First object number PDFium had not yet allocated at the last save (its
   * trailer /Size): objects from here on are new since the base. Our own
   * xref-stream object may share a number with a later PDFium object; a
   * newer revision redefining it is valid PDF. Defaults to `size`.
   */
  newFrom?: number;
}

/** Offset of the newest xref section (from the final `startxref`). */
export function lastStartxref(bytes: Uint8Array): number {
  const s = latin1(bytes.subarray(Math.max(0, bytes.length - 1024)));
  const all = [...s.matchAll(/startxref\s+(\d+)/g)];
  const last = all.at(-1);
  if (!last) throw new Error('no startxref');
  return Number(last[1]);
}

/** Last `/Size N` of the newest revision. */
export function trailerSize(bytes: Uint8Array): number {
  const all = [...newestTrailerDict(bytes).matchAll(/\/Size\s+(\d+)/g)];
  const last = all.at(-1);
  if (!last) throw new Error('no /Size in trailer');
  return Number(last[1]);
}

export function xrefKind(bytes: Uint8Array): XrefKind {
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

export function saveBaseOf(bytes: Uint8Array): SaveBase {
  const last = bytes[bytes.length - 1];
  return {
    length: bytes.length,
    size: trailerSize(bytes),
    kind: xrefKind(bytes),
    trailer: newestTrailerDict(bytes),
    startxref: lastStartxref(bytes),
    endsWithEol: last === 0x0a || last === 0x0d,
  };
}

export function trailerRef(dict: string, key: string): string | undefined {
  return new RegExp(`/${key}\\s+(\\d+\\s+\\d+\\s+R)`).exec(dict)?.[1];
}

export function trailerIds(dict: string): [string, string] | undefined {
  const m = /\/ID\s*\[\s*(<[0-9A-Fa-f]*>)\s*(<[0-9A-Fa-f]*>)\s*\]/.exec(dict);
  return m ? [m[1] ?? '', m[2] ?? ''] : undefined;
}

/** Consecutive runs of object numbers: [first, count][]. */
export function runs(nums: readonly number[]): [number, number][] {
  const g: [number, number][] = [];
  for (const n of nums) {
    const last = g.at(-1);
    if (last && last[0] + last[1] === n) last[1]++;
    else g.push([n, 1]);
  }
  return g;
}

/**
 * Our xref section + trailer for the objects at `offsets` (absolute), in the
 * base's form. Returns its bytes and the new base's trailer text.
 */
export function writeXrefSection(
  kind: XrefKind,
  xrefStart: number,
  offsets: ReadonlyMap<number, [number, number]>,
  size: number,
  common: string,
): { bytes: Uint8Array; trailer: string; size: number } {
  const nums = [...offsets.keys()].sort((a, b) => a - b);
  if (kind === 'table') {
    let x = 'xref\r\n';
    for (const [first, n] of runs(nums)) {
      x += `${String(first)} ${String(n)}\r\n`;
      for (let k = first; k < first + n; k++) {
        const [off, gen] = offsets.get(k) ?? [0, 0];
        x += `${String(off).padStart(10, '0')} ${String(gen).padStart(5, '0')} n\r\n`;
      }
    }
    const trailer = `trailer\r\n<< /Size ${String(size)} ${common} >>\r\n`;
    x += `${trailer}startxref\r\n${String(xrefStart)}\r\n%%EOF\r\n`;
    return { bytes: encodeLatin1(x), trailer, size };
  }
  // Uncompressed xref stream that includes its own entry. W = [1 4 2].
  const selfNum = size;
  const all = [...nums, selfNum];
  const entries = new Map(offsets);
  entries.set(selfNum, [xrefStart, 0]);
  const data = new Uint8Array(all.length * 7);
  all.forEach((n, i) => {
    const [off, gen] = entries.get(n) ?? [0, 0];
    const b = i * 7;
    data[b] = 1;
    data[b + 1] = (off >>> 24) & 0xff;
    data[b + 2] = (off >>> 16) & 0xff;
    data[b + 3] = (off >>> 8) & 0xff;
    data[b + 4] = off & 0xff;
    data[b + 5] = (gen >>> 8) & 0xff;
    data[b + 6] = gen & 0xff;
  });
  const index = runs(all).flat().join(' ');
  const head = `${String(selfNum)} 0 obj\r\n<< /Type /XRef /Size ${String(selfNum + 1)} /W [1 4 2] /Index [${index}] ${common} /Length ${String(data.length)} >>\r\n`;
  const pre = encodeLatin1(`${head}stream\r\n`);
  const post = encodeLatin1(
    `\r\nendstream\r\nendobj\r\nstartxref\r\n${String(xrefStart)}\r\n%%EOF\r\n`,
  );
  const bytes = new Uint8Array(pre.length + data.length + post.length);
  bytes.set(pre, 0);
  bytes.set(data, pre.length);
  bytes.set(post, pre.length + data.length);
  return { bytes, trailer: head, size: selfNum + 1 };
}
