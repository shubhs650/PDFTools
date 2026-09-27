import { describe, expect, it } from 'vitest';
import { encryptedVariants, hasQpdf } from '../../e2e/fixtures/encrypted';
import { simplePdf } from '../../e2e/fixtures/generate';
import {
  countOf,
  describeEncryption,
  findEncryption,
  isLinearized,
  lastIndexOf,
  revisionCount,
} from '../../src/model/pdfFacts';

// M2-12: facts read from the bytes (encryption, revisions, linearization).

const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

describe('byte scanning', () => {
  it('finds the last occurrence and counts', () => {
    const b = enc('startxref 1 startxref 2 startxref');
    expect(countOf(b, enc('startxref'))).toBe(3);
    expect(lastIndexOf(b, enc('startxref'))).toBe(24);
    expect(lastIndexOf(b, enc('startxref'), 23)).toBe(12);
    expect(lastIndexOf(b, enc('nope'))).toBe(-1);
  });

  it('revisions and linearization', () => {
    const one = simplePdf(1);
    expect(revisionCount(one)).toBe(1);
    const tail = enc('\n1 0 obj\n<< >>\nendobj\nxref\n0 1\ntrailer\n<< >>\nstartxref\n0\n%%EOF\n');
    const two = new Uint8Array(one.length + tail.length);
    two.set(one);
    two.set(tail, one.length);
    expect(revisionCount(two)).toBe(2);
    expect(isLinearized(one)).toBe(false);
    expect(isLinearized(enc('%PDF-1.7\n1 0 obj\n<< /Linearized 1 /L 1234 >>\nendobj'))).toBe(true);
  });
});

describe('encryption dictionaries', () => {
  it('maps /V, /Length and crypt filters to a method and key length', () => {
    expect(describeEncryption('<< /Filter /Standard /V 1 /R 2 >>')).toMatchObject({
      handler: 'Standard',
      method: 'RC4',
      keyBits: 40,
    });
    expect(describeEncryption('<< /Filter /Standard /V 2 /R 3 /Length 128 >>')).toMatchObject({
      method: 'RC4',
      keyBits: 128,
    });
    expect(
      describeEncryption('<< /Filter /Standard /V 4 /R 4 /CF << /StdCF << /CFM /AESV2 >> >> >>'),
    ).toMatchObject({ method: 'AES-128', keyBits: 128 });
    expect(
      describeEncryption('<< /Filter /Standard /V 5 /R 6 /CF << /StdCF << /CFM /AESV3 >> >> >>'),
    ).toMatchObject({ method: 'AES-256', keyBits: 256, r: 6 });
    expect(describeEncryption('<< /Filter /Custom /V 9 >>')).toMatchObject({ method: 'unknown' });
  });

  it('an unencrypted file has none', () => {
    expect(findEncryption(simplePdf(1))).toBeNull();
  });

  it.skipIf(!hasQpdf())('reads qpdf-encrypted files (RC4-40 … AES-256)', () => {
    const got = Object.fromEntries(
      encryptedVariants(simplePdf(1)).map((v) => {
        const e = findEncryption(v.bytes);
        return [v.name, e ? `${e.method}/${String(e.keyBits)}/R${String(e.r)}` : null];
      }),
    );
    expect(got).toEqual({
      'R2-rc4-40': 'RC4/40/R2',
      'R3-rc4-128': 'RC4/128/R3',
      'R4-aes-128': 'AES-128/128/R4',
      'R6-aes-256': 'AES-256/256/R6',
      'R6-owner-only': 'AES-256/256/R6',
    });
  });
});
