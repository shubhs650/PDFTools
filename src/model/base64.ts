// Base64 (RFC 4648, standard alphabet, padded) for bytes carried inside JSON:
// the comments PDF of a JSON v2 comment export (ADR-025). Chunked so a large
// file never builds one huge argument list; run it in a worker for big data
// (rule 1).

const CHUNK = 0x8000;

export function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK)
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  return btoa(parts.join(''));
}

/** Standard, padded base64 only (no whitespace, no URL alphabet). */
export const isBase64 = (s: string): boolean =>
  s.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/u.test(s);

/** The bytes, or null when `s` is not base64. */
export function fromBase64(s: string): Uint8Array | null {
  if (!isBase64(s)) return null;
  let bin: string;
  try {
    bin = atob(s);
  } catch {
    return null;
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
