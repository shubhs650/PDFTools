// Signature dictionaries read from a PDF's bytes (D-24, §7.11, M2-13): each
// /ByteRange with its /Contents (the DER CMS), /M, /Name, /Reason,
// /Location and /SubFilter, and which revision it covers. Pure; the
// cryptographic check is workers/work/signatures.ts.

export interface SignatureField {
  byteRange: [number, number, number, number];
  /** The CMS (DER), without the zero padding. */
  cms: Uint8Array;
  subFilter: string;
  name: string;
  reason: string;
  location: string;
  /** /M as written (PDF date string). */
  m: string;
}

export interface Coverage {
  /** 1-based revision the signature covers, and the number of revisions. */
  revision: number;
  revisions: number;
  /** Bytes were appended after the signed revision. */
  changedAfter: boolean;
}

const latin1 = (u8: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < u8.length; i += 0x4000)
    out += String.fromCharCode(...u8.subarray(i, i + 0x4000));
  return out;
};

function indexesOf(hay: Uint8Array, needle: string): number[] {
  const n = Uint8Array.from(needle, (c) => c.charCodeAt(0));
  const out: number[] = [];
  outer: for (let i = 0; i <= hay.length - n.length; i++) {
    for (let k = 0; k < n.length; k++) if (hay[i + k] !== n[k]) continue outer;
    out.push(i);
  }
  return out;
}

/** The DER length of a SEQUENCE at the start of `raw` (header + content), or null. */
export function derLength(raw: Uint8Array): number | null {
  if (raw[0] !== 0x30 || raw.length < 2) return null;
  const l0 = raw[1] ?? 0;
  if (!(l0 & 0x80)) return 2 + l0;
  const n = l0 & 0x7f;
  if (n < 1 || n > 4) return null;
  let len = 0;
  for (let i = 0; i < n; i++) len = len * 256 + (raw[2 + i] ?? 0);
  return 2 + n + len;
}

const str = (dict: string, key: string): string => {
  const m = new RegExp(`/${key}\\s*\\(((?:\\\\.|[^\\\\)])*)\\)`).exec(dict);
  return m?.[1]?.replace(/\\([()\\])/g, '$1') ?? '';
};

/** Every signature dictionary in the file, in file order (a later revision may add more). */
export function findSignatures(bytes: Uint8Array): SignatureField[] {
  const out: SignatureField[] = [];
  for (const at of indexesOf(bytes, '/ByteRange')) {
    // The dictionary: from its object header to endobj (signature dicts are plain objects).
    const from = Math.max(0, at - 32768);
    const before = latin1(bytes.subarray(from, at));
    const objAt = before.lastIndexOf(' obj');
    const start = objAt >= 0 ? from + objAt : at;
    const window = latin1(bytes.subarray(start, Math.min(bytes.length, at + 65536)));
    const end = window.indexOf('endobj');
    const dict = end > 0 ? window.slice(0, end) : window;
    const br = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(dict);
    if (!br) continue;
    const byteRange = [Number(br[1]), Number(br[2]), Number(br[3]), Number(br[4])] as [
      number,
      number,
      number,
      number,
    ];
    const hex = /\/Contents\s*<([0-9A-Fa-f\s]*)>/.exec(dict)?.[1]?.replace(/\s+/g, '') ?? '';
    const raw = new Uint8Array(Math.floor(hex.length / 2));
    for (let i = 0; i < raw.length; i++) raw[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    const len = derLength(raw);
    out.push({
      byteRange,
      cms: len !== null && len <= raw.length ? raw.slice(0, len) : raw,
      subFilter: /\/SubFilter\s*\/([\w.]+)/.exec(dict)?.[1] ?? '',
      name: str(dict, 'Name'),
      reason: str(dict, 'Reason'),
      location: str(dict, 'Location'),
      m: str(dict, 'M'),
    });
  }
  return out;
}

/** The signed bytes: the two ByteRange spans, concatenated. */
export function signedBytes(
  bytes: Uint8Array,
  br: SignatureField['byteRange'],
): Uint8Array<ArrayBuffer> {
  const [a, b, c, d] = br;
  const out = new Uint8Array(b + d);
  out.set(bytes.subarray(a, a + b), 0);
  out.set(bytes.subarray(c, c + d), b);
  return out;
}

/** Offsets just past each revision's %%EOF (and its end-of-line). */
export function revisionEnds(bytes: Uint8Array): number[] {
  return indexesOf(bytes, '%%EOF').map((i) => {
    let end = i + 5;
    if (bytes[end] === 13) end++;
    if (bytes[end] === 10) end++;
    return end;
  });
}

/** Which revision a signature covers, and whether anything came after it. */
export function coverage(br: SignatureField['byteRange'], bytes: Uint8Array): Coverage {
  const covered = br[2] + br[3];
  const ends = revisionEnds(bytes);
  const revisions = Math.max(1, ends.length);
  // The signed revision is the first whose end is at (or just past) the covered length.
  const index = ends.findIndex((e) => e >= covered);
  const revision = index < 0 ? revisions : index + 1;
  // Trailing whitespace after the last %%EOF isn't a change.
  const tail = latin1(bytes.subarray(covered, Math.min(bytes.length, covered + 64)));
  const changedAfter =
    bytes.length > covered && !(bytes.length - covered <= 2 && /^\s*$/.test(tail));
  return { revision, revisions, changedAfter };
}
