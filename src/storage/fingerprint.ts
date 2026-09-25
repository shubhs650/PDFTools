// Document fingerprint (ARCHITECTURE §4.3, D-05): the key for recovery
// snapshots and recent-file entries. SHA-256 over the size, the trailer `/ID`
// and the first and last 64 KB, so it costs the same for a 1 KB and a 500 MB
// file. Runs in the storage worker; only slices of the Blob are read.
//
// It is the fingerprint of the file as opened. The recovery tail (§4.3) is
// stored beside the original in OPFS and never changes the key.

export const SAMPLE_BYTES = 64 * 1024;

/** First `/ID [<hex> …]` in `bytes`, lower-cased hex, or '' if none. */
export function findTrailerId(bytes: Uint8Array): string {
  // latin1 keeps one char per byte, so binary stream data can't break the match.
  const text = new TextDecoder('latin1').decode(bytes);
  const m = /\/ID\s*\[\s*<([0-9A-Fa-f\s]*)>/.exec(text);
  return m?.[1]?.replace(/\s+/g, '').toLowerCase() ?? '';
}

const hex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function fingerprint(file: Blob): Promise<string> {
  const size = file.size;
  const head = new Uint8Array(await file.slice(0, SAMPLE_BYTES).arrayBuffer());
  const tailStart = Math.max(SAMPLE_BYTES, size - SAMPLE_BYTES);
  const tail = new Uint8Array(await file.slice(tailStart, size).arrayBuffer());
  // The newest trailer is at the end; a linearized file also has one at the start.
  const id = findTrailerId(tail) || findTrailerId(head);
  const prefix = new TextEncoder().encode(`pdftools-fp1\n${String(size)}\n${id}\n`);
  const input = new Uint8Array(prefix.length + head.length + tail.length);
  input.set(prefix, 0);
  input.set(head, prefix.length);
  input.set(tail, prefix.length + head.length);
  return hex(await crypto.subtle.digest('SHA-256', input));
}
