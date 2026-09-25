// Byte-level PDF helpers for the save core (ADR-005). Latin-1 views so binary
// data maps one char per byte; nothing here decodes streams.

export const latin1 = (b: Uint8Array): string => {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < b.length; i += CH) s += String.fromCharCode(...b.subarray(i, i + CH));
  return s;
};

export const encodeLatin1 = (s: string): Uint8Array =>
  Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function isPrefix(prefix: Uint8Array, whole: Uint8Array): boolean {
  if (whole.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (prefix[i] !== whole[i]) return false;
  return true;
}

export const isWs = (c: number | undefined): boolean =>
  c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;

export function indexOfBytes(
  bytes: Uint8Array,
  token: string,
  from: number,
  to = bytes.length,
): number {
  const t = Array.from(token, (c) => c.charCodeAt(0));
  outer: for (let i = from; i + t.length <= to; i++) {
    for (let k = 0; k < t.length; k++) if (bytes[i + k] !== t[k]) continue outer;
    return i;
  }
  return -1;
}

/** Object numbers of `N G obj` headers in the bytes (e.g. an incremental tail). */
export function objectNumbers(bytes: Uint8Array): number[] {
  return [...latin1(bytes).matchAll(/(?:^|[\r\n\s])(\d+)\s+(\d+)\s+obj\b/g)].map((m) =>
    Number(m[1]),
  );
}

/** The /ByteRange of the first signature dictionary, if any. */
export function byteRange(bytes: Uint8Array): [number, number, number, number] | undefined {
  const m = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(latin1(bytes));
  if (!m) return undefined;
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}

/** Signed bytes (ByteRange concatenation) and the DER CMS from zero-padded /Contents. */
export function signatureParts(
  bytes: Uint8Array,
): { signed: Uint8Array<ArrayBuffer>; cms: Uint8Array<ArrayBuffer> } | undefined {
  const br = byteRange(bytes);
  if (!br) return undefined;
  const [a, b, c, d] = br;
  const signed = new Uint8Array(b + d);
  signed.set(bytes.subarray(a, a + b), 0);
  signed.set(bytes.subarray(c, c + d), b);
  const hex = latin1(bytes.subarray(a + b + 1, c - 1));
  const raw = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < raw.length; i++) raw[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  // The exact DER length comes from the outer SEQUENCE (the padding may end in 0x00 too).
  const l0 = raw[1] ?? 0;
  let len = l0;
  let hdr = 2;
  if (l0 & 0x80) {
    const n = l0 & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + (raw[2 + i] ?? 0);
    hdr = 2 + n;
  }
  return { signed, cms: raw.slice(0, hdr + len) };
}
