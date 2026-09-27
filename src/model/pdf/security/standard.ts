// The PDF Standard security handler for our own object layer (M3-04,
// ADR-007 decision 4): file-key derivation from the user or owner password
// for R2–R6 (ISO 32000-1 7.6.3 Algorithms 2, 6, 7; ISO 32000-2 7.6.4.3.3
// Algorithms 2.A, 2.B) and per-object encryption of strings and streams
// (RC4, AESV2, AESV3, Identity crypt filters). It lets us read and write
// /Measure and /VP in encrypted files; PDFium still owns everything else.
//
// The file key lives in worker memory only, like the password it came from
// (M2-Q7), and is never logged or reported (rule 10). Writing is gated by the
// permission map elsewhere (rule 9); nothing here protects new files.
import { PdfName, PdfString, isDict, nameOf, numOf, type PdfDict, type PdfValue } from '../objects';
import { cbcDecrypt, cbcEncrypt } from './aes';
import { md5 } from './md5';
import { rc4 } from './rc4';

type Method = 'none' | 'rc4' | 'aesv2' | 'aesv3';

const PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const bytesOf = (v: PdfValue | undefined): Uint8Array =>
  v instanceof PdfString ? v.bytes : new Uint8Array();
const equal = (a: Uint8Array, b: Uint8Array, n = a.length): boolean => {
  if (a.length < n || b.length < n) return false;
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
};
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

export class SecurityError extends Error {
  readonly code: 'security-unsupported' | 'security-password';
  constructor(code: 'security-unsupported' | 'security-password', message: string) {
    super(message);
    this.code = code;
  }
}

/** The parts of /Encrypt the Standard handler needs. */
export interface EncryptInfo {
  v: number;
  r: number;
  /** Key length in bytes (R2–R4). */
  length: number;
  o: Uint8Array;
  u: Uint8Array;
  oe: Uint8Array;
  ue: Uint8Array;
  p: number;
  encryptMetadata: boolean;
  strings: Method;
  streams: Method;
  /** First element of the trailer /ID. */
  id0: Uint8Array;
}

function cryptMethod(enc: PdfDict, filter: string | undefined): Method {
  if (!filter || filter === 'Identity') return 'none';
  const cf = enc.get('CF');
  const def = isDict(cf) ? cf.get(filter) : undefined;
  const cfm = isDict(def) ? nameOf(def.get('CFM')) : undefined;
  if (cfm === 'V2') return 'rc4';
  if (cfm === 'AESV2') return 'aesv2';
  if (cfm === 'AESV3') return 'aesv3';
  if (cfm === 'None') return 'none';
  throw new SecurityError('security-unsupported', `Unsupported crypt filter method ${cfm ?? '?'}`);
}

/** Reads /Encrypt (never itself encrypted) and the trailer /ID. */
export function encryptInfo(enc: PdfDict, id: PdfValue | undefined): EncryptInfo {
  if (nameOf(enc.get('Filter')) !== 'Standard')
    throw new SecurityError(
      'security-unsupported',
      'Only the Standard security handler is supported',
    );
  const v = numOf(enc.get('V')) ?? 0;
  const r = numOf(enc.get('R')) ?? 0;
  if (![1, 2, 4, 5].includes(v) || r < 2 || r > 6)
    throw new SecurityError(
      'security-unsupported',
      `Unsupported encryption V${String(v)} R${String(r)}`,
    );
  let strings: Method = 'rc4';
  let streams: Method = 'rc4';
  if (v >= 4) {
    strings = cryptMethod(enc, nameOf(enc.get('StrF')) ?? 'Identity');
    streams = cryptMethod(enc, nameOf(enc.get('StmF')) ?? 'Identity');
  }
  const bits = v === 1 ? 40 : (numOf(enc.get('Length')) ?? 40);
  return {
    v,
    r,
    length: v >= 5 ? 32 : Math.max(5, Math.min(16, bits / 8)),
    o: bytesOf(enc.get('O')),
    u: bytesOf(enc.get('U')),
    oe: bytesOf(enc.get('OE')),
    ue: bytesOf(enc.get('UE')),
    p: numOf(enc.get('P')) ?? 0,
    encryptMetadata: enc.get('EncryptMetadata') !== false,
    strings,
    streams,
    id0: Array.isArray(id) ? bytesOf(id[0]) : new Uint8Array(),
  };
}

// ---- R2–R4 (ISO 32000-1 7.6.3.3) ------------------------------------------------

const padPassword = (pw: Uint8Array): Uint8Array => concat(pw.subarray(0, 32), PAD).subarray(0, 32);

/** Algorithm 2: the file key from a (padded) user password. */
function keyR4(info: EncryptInfo, password: Uint8Array): Uint8Array {
  const p = new Uint8Array(4);
  new DataView(p.buffer).setInt32(0, info.p, true);
  const meta =
    info.r >= 4 && !info.encryptMetadata ? Uint8Array.from([255, 255, 255, 255]) : new Uint8Array();
  let h = md5(padPassword(password), info.o.subarray(0, 32), p, info.id0, meta);
  const n = info.r === 2 ? 5 : info.length;
  if (info.r >= 3) for (let i = 0; i < 50; i++) h = md5(h.subarray(0, n));
  return h.subarray(0, n);
}

/** Algorithms 4/5 + 6: is `key` right for the user password? */
function userKeyMatches(info: EncryptInfo, key: Uint8Array): boolean {
  if (info.r === 2) return equal(rc4(key, PAD), info.u, 32);
  let x = rc4(key, md5(PAD, info.id0));
  for (let i = 1; i <= 19; i++)
    x = rc4(
      key.map((b) => b ^ i),
      x,
    );
  return equal(x, info.u, 16);
}

/** Algorithm 7: the user password hidden in /O, from the owner password. */
function userFromOwner(info: EncryptInfo, owner: Uint8Array): Uint8Array {
  let h = md5(padPassword(owner));
  const n = info.r === 2 ? 5 : info.length;
  if (info.r >= 3) for (let i = 0; i < 50; i++) h = md5(h);
  const key = h.subarray(0, n);
  let x = info.o.subarray(0, 32);
  if (info.r === 2) return rc4(key, x);
  for (let i = 19; i >= 0; i--)
    x = rc4(
      key.map((b) => b ^ i),
      x,
    );
  return x;
}

// ---- R5/R6 (ISO 32000-2 7.6.4.3.3) ------------------------------------------------

async function sha(bits: 256 | 384 | 512, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest(`SHA-${String(bits)}`, data as Uint8Array<ArrayBuffer>),
  );
}

/** Algorithm 2.B (R6); R5 is a single SHA-256. */
async function hash(r: number, password: Uint8Array, salt: Uint8Array, udata: Uint8Array) {
  let k = await sha(256, concat(password, salt, udata));
  if (r === 5) return k;
  for (let round = 0; ; round++) {
    const one = concat(password, k, udata);
    const k1 = new Uint8Array(one.length * 64);
    for (let i = 0; i < 64; i++) k1.set(one, i * one.length);
    const e = cbcEncrypt(k.subarray(0, 16), k.subarray(16, 32), k1, false);
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += e[i] ?? 0;
    const mod = sum % 3;
    k = await sha(mod === 0 ? 256 : mod === 1 ? 384 : 512, e);
    if (round >= 63 && (e[e.length - 1] ?? 0) <= round - 31) break;
  }
  return k.subarray(0, 32);
}

async function keyR6(info: EncryptInfo, password: Uint8Array): Promise<Uint8Array | null> {
  const pw = password.subarray(0, 127);
  const u = info.u;
  const o = info.o;
  const iv = new Uint8Array(16);
  if (equal(await hash(info.r, pw, o.subarray(32, 40), u.subarray(0, 48)), o, 32)) {
    const k = await hash(info.r, pw, o.subarray(40, 48), u.subarray(0, 48));
    return cbcDecrypt(k, iv, info.oe.subarray(0, 32), false);
  }
  if (equal(await hash(info.r, pw, u.subarray(32, 40), new Uint8Array()), u, 32)) {
    const k = await hash(info.r, pw, u.subarray(40, 48), new Uint8Array());
    return cbcDecrypt(k, iv, info.ue.subarray(0, 32), false);
  }
  return null;
}

// ---- the file key and per-object crypt ----------------------------------------------

/**
 * The file key for `password` (user or owner; empty for owner-only files).
 * Throws `security-password` when neither matches.
 */
export async function fileKey(info: EncryptInfo, password = ''): Promise<Uint8Array> {
  const pw = new TextEncoder().encode(password);
  if (info.r >= 5) {
    const k = await keyR6(info, pw);
    if (k) return k;
  } else {
    // PDF 1.7 passwords are PDFDocEncoding; Latin-1 bytes cover what users type there.
    const latin = Uint8Array.from(password, (c) => c.charCodeAt(0) & 0xff);
    const asUser = keyR4(info, latin);
    if (userKeyMatches(info, asUser)) return asUser;
    const asOwner = keyR4(info, userFromOwner(info, latin));
    if (userKeyMatches(info, asOwner)) return asOwner;
  }
  throw new SecurityError('security-password', 'The password does not open this document');
}

/** Strings and streams of one encrypted document, by object number and generation. */
export class StandardCrypt {
  readonly info: EncryptInfo;
  private readonly key: Uint8Array;

  constructor(info: EncryptInfo, key: Uint8Array) {
    this.info = info;
    this.key = key;
  }

  static async open(enc: PdfDict, id: PdfValue | undefined, password?: string) {
    const info = encryptInfo(enc, id);
    return new StandardCrypt(info, await fileKey(info, password));
  }

  private objectKey(method: Method, num: number, gen: number): Uint8Array {
    if (method === 'aesv3') return this.key;
    const salt = method === 'aesv2' ? Uint8Array.from([0x73, 0x41, 0x6c, 0x54]) : new Uint8Array();
    const h = md5(
      this.key,
      Uint8Array.from([
        num & 0xff,
        (num >> 8) & 0xff,
        (num >> 16) & 0xff,
        gen & 0xff,
        (gen >> 8) & 0xff,
      ]),
      salt,
    );
    return h.subarray(0, Math.min(this.key.length + 5, 16));
  }

  private run(method: Method, num: number, gen: number, data: Uint8Array, encrypt: boolean) {
    if (method === 'none') return data;
    const key = this.objectKey(method, num, gen);
    if (method === 'rc4') return rc4(key, data);
    if (encrypt) {
      const iv = crypto.getRandomValues(new Uint8Array(16));
      return concat(iv, cbcEncrypt(key, iv, data));
    }
    if (data.length < 16) return new Uint8Array();
    return cbcDecrypt(key, data.subarray(0, 16), data.subarray(16));
  }

  decryptString(num: number, gen: number, data: Uint8Array): Uint8Array {
    return this.run(this.info.strings, num, gen, data, false);
  }

  encryptString(num: number, gen: number, data: Uint8Array): Uint8Array {
    return this.run(this.info.strings, num, gen, data, true);
  }

  decryptStream(num: number, gen: number, data: Uint8Array): Uint8Array {
    return this.run(this.info.streams, num, gen, data, false);
  }

  /** Every string in `v` (deep), en- or decrypted for object `num`/`gen`. */
  mapStrings(v: PdfValue, num: number, gen: number, encrypt: boolean): PdfValue {
    if (v instanceof PdfString) {
      const out = encrypt
        ? this.encryptString(num, gen, v.bytes)
        : this.decryptString(num, gen, v.bytes);
      // Ciphertext is written as hex; plaintext is serialized canonically again.
      return new PdfString(out, encrypt);
    }
    if (Array.isArray(v)) return v.map((x) => this.mapStrings(x, num, gen, encrypt));
    if (isDict(v)) {
      const d = new Map<string, PdfValue>();
      for (const [k, x] of v) d.set(k, this.mapStrings(x, num, gen, encrypt));
      return d;
    }
    return v;
  }
}

export const isStandard = (enc: PdfValue | undefined): boolean =>
  isDict(enc) && enc.get('Filter') instanceof PdfName && nameOf(enc.get('Filter')) === 'Standard';
