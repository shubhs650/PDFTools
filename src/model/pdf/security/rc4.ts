// RC4 for the PDF Standard security handler (ISO 32000-1 7.6.2, R2–R4).
// Symmetric: the same call encrypts and decrypts.

export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    const si = s[i] ?? 0;
    j = (j + si + (key[i % key.length] ?? 0)) & 0xff;
    s[i] = s[j] ?? 0;
    s[j] = si;
  }
  const out = new Uint8Array(data.length);
  let x = 0;
  let y = 0;
  for (let k = 0; k < data.length; k++) {
    x = (x + 1) & 0xff;
    const sx = s[x] ?? 0;
    y = (y + sx) & 0xff;
    s[x] = s[y] ?? 0;
    s[y] = sx;
    out[k] = (data[k] ?? 0) ^ (s[((s[x] ?? 0) + sx) & 0xff] ?? 0);
  }
  return out;
}
