import { beforeAll, describe, expect, it } from 'vitest';
import {
  makeSigner,
  savedAfterSigning,
  signedPdf,
  tampered,
  twiceSignedPdf,
  type Signer,
} from '../../e2e/fixtures/signed';
import { coverage, derLength, findSignatures, revisionEnds } from '../../src/model/signatures';
import type { JobSlice } from '../../src/workers/work/scheduler';
import { checkSignatures } from '../../src/workers/work/signatures';

// M2-13: signature parsing, coverage and the offline integrity check.

let alice: Signer;
let bob: Signer;
let one: Uint8Array;

beforeAll(async () => {
  alice = await makeSigner('Alice Tester');
  bob = await makeSigner('Bob Reviewer');
  one = await signedPdf(alice);
});

const slice = (): JobSlice => ({
  signal: new AbortController().signal,
  checkpoint: () => Promise.resolve(),
});
const run = (bytes: Uint8Array) => checkSignatures(bytes, slice(), () => undefined);

describe('parsing', () => {
  it('finds the ByteRange, the DER CMS and the dictionary strings', () => {
    const [sig] = findSignatures(one);
    expect(sig).toMatchObject({
      subFilter: 'adbe.pkcs7.detached',
      name: 'Test Signer',
      reason: 'Approved',
      location: 'Test Lab',
      m: 'D:20240301120000Z',
    });
    expect(sig?.byteRange[0]).toBe(0);
    expect(sig?.byteRange[2]).toBeGreaterThan(sig?.byteRange[1] ?? 0);
    expect(derLength(sig?.cms ?? new Uint8Array())).toBe(sig?.cms.length);
  });

  it('revision ends and coverage', () => {
    expect(revisionEnds(one)).toEqual([one.length]);
    const [sig] = findSignatures(one);
    if (!sig) throw new Error('sig');
    expect(coverage(sig.byteRange, one)).toEqual({
      revision: 1,
      revisions: 1,
      changedAfter: false,
    });
    const later = savedAfterSigning(one);
    expect(coverage(sig.byteRange, later)).toEqual({
      revision: 1,
      revisions: 2,
      changedAfter: true,
    });
  });
});

describe('checkSignatures (offline)', () => {
  it('a valid signature is unchanged since signing', async () => {
    expect(await run(one)).toEqual([
      {
        signer: 'Alice Tester',
        signedAt: '2024-03-01T12:00:00.000Z',
        reason: 'Approved',
        location: 'Test Lab',
        subFilter: 'adbe.pkcs7.detached',
        integrity: 'unchanged',
        revision: 1,
        revisions: 1,
        changedAfter: false,
      },
    ]);
  });

  it('a changed byte in the signed range is "modified"', async () => {
    expect((await run(tampered(one)))[0]?.integrity).toBe('modified');
  });

  it('a truncated or corrupted signature is "damaged"', async () => {
    const [sig] = findSignatures(one);
    if (!sig) throw new Error('sig');
    // Truncated file: the ByteRange points past the end.
    expect((await run(one.slice(0, one.length - 100)))[0]?.integrity).toBe('damaged');
    // Corrupt one hex digit of the signature value near the end of /Contents.
    const bad = one.slice();
    const at = sig.byteRange[1] + 1 + sig.cms.length * 2 - 10;
    bad[at] = bad[at] === 0x30 ? 0x31 : 0x30;
    expect((await run(bad))[0]?.integrity).toBe('damaged');
  });

  it('twice signed: the first covers revision 1 of 2 and is still unchanged', async () => {
    const two = await twiceSignedPdf(alice, bob);
    const r = await run(two);
    expect(r.map((s) => [s.signer, s.integrity, s.revision, s.revisions, s.changedAfter])).toEqual([
      ['Alice Tester', 'unchanged', 1, 2, true],
      ['Bob Reviewer', 'unchanged', 2, 2, false],
    ]);
  });

  it('an incremental save after signing keeps the signature unchanged, changed after', async () => {
    const [sig] = await run(savedAfterSigning(one));
    expect(sig).toMatchObject({
      integrity: 'unchanged',
      changedAfter: true,
      revision: 1,
      revisions: 2,
    });
  });
});

describe('findSignatures after a save that re-appends the signature (ADR-016 finding 9)', () => {
  it('lists each signed range once', async () => {
    const signed = await signedPdf(await makeSigner('Dup Signer'));
    const text = Buffer.from(signed).toString('latin1');
    const at = text.lastIndexOf('/Type /Sig');
    const objAt = text.lastIndexOf(' obj', at);
    const start = text.lastIndexOf('\n', objAt) + 1;
    const end = text.indexOf('endobj', at) + 'endobj'.length;
    // The same dictionary appended again, as PDFium's keep-all tail does.
    const again = Buffer.concat([
      Buffer.from(signed),
      Buffer.from(`\n${text.slice(start, end)}\n`, 'latin1'),
    ]);
    expect(findSignatures(new Uint8Array(again))).toHaveLength(1);
  });
});
