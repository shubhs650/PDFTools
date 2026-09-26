// Facts about a PDF file read from its bytes (M2-12): what PDFium's API
// doesn't tell — the encryption method and key length, the number of
// revisions (incremental updates), linearization. The bytes are scanned,
// never parsed as a whole, so a 500 MB file costs one pass at most. Pure.

export type EncryptionMethod = 'RC4' | 'AES-128' | 'AES-256' | 'unknown';

export interface Encryption {
  /** The security handler (/Filter), e.g. "Standard". */
  handler: string;
  method: EncryptionMethod;
  /** Key length in bits (null when the dictionary doesn't say). */
  keyBits: number | null;
  /** /V and /R of the encryption dictionary. */
  v: number | null;
  r: number | null;
}

const enc = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));
const latin1 = (u8: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < u8.length; i += 0x4000)
    out += String.fromCharCode(...u8.subarray(i, i + 0x4000));
  return out;
};

/** Last index of `needle` in `hay` at or before `from`, or -1. */
export function lastIndexOf(hay: Uint8Array, needle: Uint8Array, from = hay.length - 1): number {
  const first = needle[0];
  outer: for (let i = Math.min(from, hay.length - needle.length); i >= 0; i--) {
    if (hay[i] !== first) continue;
    for (let k = 1; k < needle.length; k++) if (hay[i + k] !== needle[k]) continue outer;
    return i;
  }
  return -1;
}

/** Number of non-overlapping occurrences of `needle`. */
export function countOf(hay: Uint8Array, needle: Uint8Array): number {
  let n = 0;
  const first = needle[0];
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    if (hay[i] !== first) continue;
    for (let k = 1; k < needle.length; k++) if (hay[i + k] !== needle[k]) continue outer;
    n++;
    i += needle.length - 1;
  }
  return n;
}

/** Incremental revisions: one cross-reference section (startxref) each. */
export const revisionCount = (bytes: Uint8Array): number =>
  Math.max(1, countOf(bytes, enc('startxref')));

/** Linearized ("fast web view"): the dictionary is the first object of the file. */
export const isLinearized = (bytes: Uint8Array): boolean =>
  /\/Linearized\s/.test(latin1(bytes.subarray(0, 1024)));

const num = (dict: string, key: string): number | null => {
  const m = new RegExp(`/${key}\\s+(\\d+)`).exec(dict);
  return m?.[1] ? Number(m[1]) : null;
};

/** Reads an encryption dictionary's text. */
export function describeEncryption(dict: string): Encryption {
  const handler = /\/Filter\s*\/([A-Za-z0-9.+_-]+)/.exec(dict)?.[1] ?? 'unknown';
  const v = num(dict, 'V');
  const r = num(dict, 'R');
  const length = num(dict, 'Length');
  const cfm = /\/CFM\s*\/(\w+)/.exec(dict)?.[1];
  let method: EncryptionMethod = 'unknown';
  let keyBits: number | null = null;
  if (v === 1) {
    method = 'RC4';
    keyBits = 40;
  } else if (v === 2 || v === 3) {
    method = 'RC4';
    keyBits = length ?? 40;
  } else if (v === 4) {
    if (cfm === 'AESV2') {
      method = 'AES-128';
      keyBits = 128;
    } else if (cfm === 'V2') {
      method = 'RC4';
      // /Length in a crypt filter is in bytes (ISO 32000-1 Table 25).
      const cfLength = /\/CF\s*<<[\s\S]*?\/Length\s+(\d+)/.exec(dict)?.[1];
      keyBits = cfLength ? Number(cfLength) * 8 : 128;
    }
  } else if (v === 5 || v === 6 || cfm === 'AESV3') {
    method = 'AES-256';
    keyBits = 256;
  }
  return { handler, method, keyBits, v, r };
}

/**
 * The file's encryption dictionary (the last /Encrypt in a trailer or xref
 * stream, direct or by reference), or null when the file isn't encrypted.
 */
export function findEncryption(bytes: Uint8Array): Encryption | null {
  // "/Encrypt" as a whole key, not the start of "/EncryptMetadata".
  const key = enc('/Encrypt');
  let at = lastIndexOf(bytes, key);
  while (at >= 0 && /[A-Za-z]/.test(String.fromCharCode(bytes[at + key.length] ?? 32)))
    at = lastIndexOf(bytes, key, at - 1);
  if (at < 0) return null;
  const after = latin1(bytes.subarray(at + 8, at + 8 + 64));
  const ref = /^\s*(\d+)\s+(\d+)\s+R/.exec(after);
  if (ref?.[1] && ref[2]) {
    const header = enc(`${ref[1]} ${ref[2]} obj`);
    let i = lastIndexOf(bytes, header);
    // The object number must stand alone ("12 0 obj", not "112 0 obj").
    while (i > 0 && /[0-9]/.test(String.fromCharCode(bytes[i - 1] ?? 32)))
      i = lastIndexOf(bytes, header, i - 1);
    if (i < 0) return { handler: 'unknown', method: 'unknown', keyBits: null, v: null, r: null };
    const text = latin1(bytes.subarray(i, i + 4096));
    const end = text.indexOf('endobj');
    return describeEncryption(end > 0 ? text.slice(0, end) : text);
  }
  if (/^\s*<</.test(after)) return describeEncryption(latin1(bytes.subarray(at, at + 4096)));
  return null;
}
