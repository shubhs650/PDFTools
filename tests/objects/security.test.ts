// M3-04 (ADR-007 decision 4): the Standard security handler for our object
// layer — MD5, RC4, AES against published vectors, and whole files encrypted
// by qpdf (R2, R3, R4, R6, owner-only) read back against qpdf's own decryption.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OWNER_PW, USER_PW, encryptedVariants, hasQpdf } from '../../e2e/fixtures/encrypted';
import { buildPdf } from '../../e2e/fixtures/generate';
import { PdfStream, PdfString, isDict, type PdfValue } from '../../src/model/pdf/objects';
import { PdfReader } from '../../src/model/pdf/reader';
import {
  cbcDecrypt,
  cbcEncrypt,
  decryptBlock,
  encryptBlock,
  expandKey,
} from '../../src/model/pdf/security/aes';
import { md5 } from '../../src/model/pdf/security/md5';
import { rc4 } from '../../src/model/pdf/security/rc4';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const unhex = (s: string) => new Uint8Array(Buffer.from(s.replace(/\s+/g, ''), 'hex'));
const ascii = (s: string) => new TextEncoder().encode(s);

describe('MD5 (RFC 1321 A.5)', () => {
  it.each([
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['a', '0cc175b9c0f1b6a831c399e269772661'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
    [
      '12345678901234567890123456789012345678901234567890123456789012345678901234567890',
      '57edf4a22be3c955ac49da2e2107b67a',
    ],
  ])('md5(%j)', (input, want) => {
    expect(hex(md5(ascii(input)))).toBe(want);
  });

  it('hashes parts as one message', () => {
    expect(hex(md5(ascii('message '), ascii('digest')))).toBe('f96b697d7cb7938d525a2f31aaf161d0');
  });
});

describe('RC4 (RFC 6229)', () => {
  it('40-bit key 0x0102030405: keystream offsets 0 and 16', () => {
    const ks = rc4(unhex('0102030405'), new Uint8Array(32));
    expect(hex(ks.subarray(0, 16))).toBe('b2396305f03dc027ccc3524a0a1118a8');
    expect(hex(ks.subarray(16, 32))).toBe('6982944f18fc82d589c403a47a0d0919');
  });

  it('is its own inverse', () => {
    const key = unhex('0102030405060708');
    const data = ascii('Scale 1:100 (m)');
    expect(rc4(key, rc4(key, data))).toEqual(data);
  });
});

describe('AES (FIPS-197 appendix C)', () => {
  const pt = unhex('00112233445566778899aabbccddeeff');
  it('AES-128', () => {
    const rk = expandKey(unhex('000102030405060708090a0b0c0d0e0f'));
    const ct = encryptBlock(rk, pt);
    expect(hex(ct)).toBe('69c4e0d86a7b0430d8cdb78070b4c55a');
    expect(decryptBlock(rk, ct)).toEqual(pt);
  });
  it('AES-256', () => {
    const rk = expandKey(unhex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'));
    const ct = encryptBlock(rk, pt);
    expect(hex(ct)).toBe('8ea2b7ca516745bfeafc49904b496089');
    expect(decryptBlock(rk, ct)).toEqual(pt);
  });

  it.each([16, 32])('CBC with PKCS#7 matches WebCrypto (%i-byte key)', async (n) => {
    for (const len of [0, 1, 15, 16, 17, 100]) {
      const key = crypto.getRandomValues(new Uint8Array(n));
      const iv = crypto.getRandomValues(new Uint8Array(16));
      const data = crypto.getRandomValues(new Uint8Array(len));
      const k = await crypto.subtle.importKey('raw', key, 'AES-CBC', false, ['encrypt', 'decrypt']);
      const web = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, k, data));
      expect(hex(cbcEncrypt(key, iv, data))).toBe(hex(web));
      expect(cbcDecrypt(key, iv, web)).toEqual(data);
    }
  });

  it('unpadded CBC needs whole blocks', () => {
    expect(() =>
      cbcEncrypt(new Uint8Array(16), new Uint8Array(16), new Uint8Array(5), false),
    ).toThrow();
  });
});

/** A page with a text content stream, an annotation with /Contents, and /Info /Title. */
const source = (): Uint8Array =>
  buildPdf(
    [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Annots [5 0 R] /Resources << /Font << /F1 6 0 R >> >> >>',
      { dict: '<< >>', stream: 'BT /F1 24 Tf 72 740 Td (Secret drawing notes) Tj ET' },
      '<< /Type /Annot /Subtype /Text /Rect [100 100 120 120] /Contents (Check nozzle N3 \\(Rev B\\)) /NM (note-1) >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      '<< /Title (Measured sheet \\351) /Author <FEFF00C9006C0069> >>',
    ],
    ' /Info 7 0 R',
  );

function qpdf(args: string[], input: Uint8Array): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), 'pdftools-sec-'));
  writeFileSync(join(dir, 'in.pdf'), input);
  const r = spawnSync('qpdf', [...args, join(dir, 'in.pdf'), join(dir, 'out.pdf')]);
  if (r.status !== 0 && r.status !== 3) throw new Error(r.stderr.toString());
  return new Uint8Array(readFileSync(join(dir, 'out.pdf')));
}

async function facts(r: PdfReader) {
  const [page] = await r.pages();
  if (!page) throw new Error('no page');
  const content = await r.resolve(page.dict.get('Contents'));
  const annots = await r.resolve(page.dict.get('Annots'));
  const annot = Array.isArray(annots) ? await r.resolve(annots[0]) : undefined;
  const info = await r.resolve(r.trailer.get('Info'));
  const text = (d: PdfValue | undefined, k: string) =>
    isDict(d) ? ((d.get(k) as PdfString | undefined)?.text() ?? null) : null;
  return {
    content:
      content instanceof PdfStream
        ? new TextDecoder('latin1').decode(await r.decode(content))
        : null,
    contents: text(annot, 'Contents'),
    nm: text(annot, 'NM'),
    title: text(info, 'Title'),
    author: text(info, 'Author'),
  };
}

describe.skipIf(!hasQpdf())('Standard handler on qpdf-encrypted files', () => {
  const plain = source();
  const variants = [
    ...encryptedVariants(plain),
    // The same, with object streams (their contents are encrypted as streams).
    ...encryptedVariants(qpdf(['--object-streams=generate'], plain)).map((v) => ({
      ...v,
      name: `${v.name}+objstm`,
    })),
  ];

  it.each(variants.map((v) => [v.name, v] as const))('%s', async (name, v) => {
    const want = await facts(
      await PdfReader.open(qpdf(['--decrypt', `--password=${OWNER_PW}`], v.bytes)),
    );
    expect(want.contents).toBe('Check nozzle N3 (Rev B)');
    const ownerOnly = name.startsWith('R6-owner-only');
    for (const password of ownerOnly ? ['', OWNER_PW] : [USER_PW, OWNER_PW]) {
      const r = await PdfReader.open(v.bytes, undefined, { password });
      expect(r.encrypted).toBe(true);
      expect(r.readable).toBe(true);
      expect(await facts(r)).toEqual(want);
    }
    if (!ownerOnly) {
      const wrong = await PdfReader.open(v.bytes, undefined, { password: 'nope' });
      expect(wrong.readable).toBe(false);
      await expect(facts(wrong)).rejects.toThrow(/could not be decrypted/);
    }
  });
});
