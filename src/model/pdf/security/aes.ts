// AES (FIPS-197) in CBC mode for the PDF Standard security handler (AESV2,
// AESV3; ISO 32000-2 7.6.3). Synchronous, because strings are encrypted inside
// the save path, and because PDF needs unpadded CBC (the /OE, /UE keys and the
// R6 hash) that WebCrypto doesn't offer.

const SBOX = new Uint8Array(256);
const INV = new Uint8Array(256);
(() => {
  // Multiplicative inverse in GF(2^8) via log/antilog tables, then the affine map.
  const exp = new Uint8Array(256);
  const log = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    exp[i] = x;
    log[x] = i;
    x ^= (x << 1) ^ (x & 0x80 ? 0x1b : 0);
    x &= 0xff;
  }
  for (let i = 0; i < 256; i++) {
    const inv = i === 0 ? 0 : (exp[(255 - (log[i] ?? 0)) % 255] ?? 0);
    let s = inv;
    for (let k = 1; k < 5; k++) s ^= ((inv << k) | (inv >> (8 - k))) & 0xff;
    s ^= 0x63;
    SBOX[i] = s;
    INV[s] = i;
  }
})();

const xtime = (b: number): number => ((b << 1) ^ (b & 0x80 ? 0x1b : 0)) & 0xff;
function mul(a: number, b: number): number {
  let r = 0;
  while (b) {
    if (b & 1) r ^= a;
    a = xtime(a);
    b >>= 1;
  }
  return r;
}

/** Round keys for a 16- or 32-byte key. */
export function expandKey(key: Uint8Array): Uint8Array[] {
  const nk = key.length / 4;
  if (nk !== 4 && nk !== 8) throw new Error('AES key must be 16 or 32 bytes');
  const rounds = nk + 6;
  const w = new Uint8Array(16 * (rounds + 1));
  w.set(key);
  let rcon = 1;
  for (let i = nk; i < 4 * (rounds + 1); i++) {
    let t = w.slice((i - 1) * 4, i * 4);
    if (i % nk === 0) {
      t = Uint8Array.from([
        (SBOX[t[1] ?? 0] ?? 0) ^ rcon,
        SBOX[t[2] ?? 0] ?? 0,
        SBOX[t[3] ?? 0] ?? 0,
        SBOX[t[0] ?? 0] ?? 0,
      ]);
      rcon = xtime(rcon);
    } else if (nk === 8 && i % nk === 4) {
      t = t.map((b) => SBOX[b] ?? 0);
    }
    for (let k = 0; k < 4; k++) w[i * 4 + k] = (w[(i - nk) * 4 + k] ?? 0) ^ (t[k] ?? 0);
  }
  return Array.from({ length: rounds + 1 }, (_, r) => w.slice(r * 16, r * 16 + 16));
}

function addRoundKey(s: Uint8Array, k: Uint8Array): void {
  for (let i = 0; i < 16; i++) s[i] = (s[i] ?? 0) ^ (k[i] ?? 0);
}

export function encryptBlock(rk: Uint8Array[], input: Uint8Array): Uint8Array {
  const s = input.slice(0, 16);
  const rounds = rk.length - 1;
  addRoundKey(s, rk[0] ?? new Uint8Array(16));
  for (let r = 1; r <= rounds; r++) {
    for (let i = 0; i < 16; i++) s[i] = SBOX[s[i] ?? 0] ?? 0;
    // ShiftRows (column-major state).
    const t = s.slice();
    for (let c = 0; c < 4; c++)
      for (let row = 1; row < 4; row++) s[c * 4 + row] = t[((c + row) % 4) * 4 + row] ?? 0;
    if (r !== rounds) {
      for (let c = 0; c < 4; c++) {
        const a0 = s[c * 4] ?? 0;
        const a1 = s[c * 4 + 1] ?? 0;
        const a2 = s[c * 4 + 2] ?? 0;
        const a3 = s[c * 4 + 3] ?? 0;
        s[c * 4] = xtime(a0) ^ xtime(a1) ^ a1 ^ a2 ^ a3;
        s[c * 4 + 1] = a0 ^ xtime(a1) ^ xtime(a2) ^ a2 ^ a3;
        s[c * 4 + 2] = a0 ^ a1 ^ xtime(a2) ^ xtime(a3) ^ a3;
        s[c * 4 + 3] = xtime(a0) ^ a0 ^ a1 ^ a2 ^ xtime(a3);
      }
    }
    addRoundKey(s, rk[r] ?? new Uint8Array(16));
  }
  return s;
}

export function decryptBlock(rk: Uint8Array[], input: Uint8Array): Uint8Array {
  const s = input.slice(0, 16);
  const rounds = rk.length - 1;
  addRoundKey(s, rk[rounds] ?? new Uint8Array(16));
  for (let r = rounds - 1; r >= 0; r--) {
    const t = s.slice();
    for (let c = 0; c < 4; c++)
      for (let row = 1; row < 4; row++) s[((c + row) % 4) * 4 + row] = t[c * 4 + row] ?? 0;
    for (let i = 0; i < 16; i++) s[i] = INV[s[i] ?? 0] ?? 0;
    addRoundKey(s, rk[r] ?? new Uint8Array(16));
    if (r !== 0) {
      for (let c = 0; c < 4; c++) {
        const a0 = s[c * 4] ?? 0;
        const a1 = s[c * 4 + 1] ?? 0;
        const a2 = s[c * 4 + 2] ?? 0;
        const a3 = s[c * 4 + 3] ?? 0;
        s[c * 4] = mul(a0, 14) ^ mul(a1, 11) ^ mul(a2, 13) ^ mul(a3, 9);
        s[c * 4 + 1] = mul(a0, 9) ^ mul(a1, 14) ^ mul(a2, 11) ^ mul(a3, 13);
        s[c * 4 + 2] = mul(a0, 13) ^ mul(a1, 9) ^ mul(a2, 14) ^ mul(a3, 11);
        s[c * 4 + 3] = mul(a0, 11) ^ mul(a1, 13) ^ mul(a2, 9) ^ mul(a3, 14);
      }
    }
  }
  return s;
}

/** CBC encryption; `pad` adds PKCS#7 padding (PDF strings and streams), else the length must be a multiple of 16. */
export function cbcEncrypt(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
  pad = true,
): Uint8Array {
  const rk = expandKey(key);
  const n = pad ? 16 - (data.length % 16) : 0;
  if (!pad && data.length % 16) throw new Error('unpadded CBC needs whole blocks');
  const src = new Uint8Array(data.length + n);
  src.set(data);
  src.fill(n, data.length);
  const out = new Uint8Array(src.length);
  let prev = iv;
  for (let off = 0; off < src.length; off += 16) {
    const block = src.slice(off, off + 16);
    for (let i = 0; i < 16; i++) block[i] = (block[i] ?? 0) ^ (prev[i] ?? 0);
    prev = encryptBlock(rk, block);
    out.set(prev, off);
  }
  return out;
}

/** CBC decryption; `pad` removes PKCS#7 padding (tolerating a bad pad as PDF readers do). */
export function cbcDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
  pad = true,
): Uint8Array {
  const rk = expandKey(key);
  const whole = data.length - (data.length % 16);
  const out = new Uint8Array(whole);
  let prev = iv;
  for (let off = 0; off < whole; off += 16) {
    const block = data.subarray(off, off + 16);
    const plain = decryptBlock(rk, block);
    for (let i = 0; i < 16; i++) out[off + i] = (plain[i] ?? 0) ^ (prev[i] ?? 0);
    prev = block;
  }
  if (!pad || whole === 0) return out;
  const n = out[whole - 1] ?? 0;
  return n >= 1 && n <= 16 ? out.subarray(0, whole - n) : out;
}
