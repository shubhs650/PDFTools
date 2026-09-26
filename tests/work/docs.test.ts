import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { OWNER_PW, USER_PW, encryptedVariants, hasQpdf } from '../../e2e/fixtures/encrypted';
import { simplePdf } from '../../e2e/fixtures/generate';
import { WorkDocs, concat } from '../../src/workers/work/docs';

const require = createRequire(import.meta.url);
const S1 = 'e2e/fixtures/self-made/s1-interop';
const ab = (b: Buffer): ArrayBuffer =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

let native: PdfiumNative;
beforeAll(async () => {
  native = new PdfiumNative(
    await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) }),
    { fontFallback: null },
  );
});

/** The S1 pair: the original, and the same file after a narrow incremental save. */
function pair() {
  const original = readFileSync(`${S1}/original__plain.pdf`);
  const saved = readFileSync(`${S1}/plain__narrow.pdf`);
  expect(saved.subarray(0, original.length).equals(original)).toBe(true); // prefix (ADR-005)
  return { original: ab(original), tail: ab(saved.subarray(original.length)) };
}

async function annotationCount(docs: WorkDocs, docId: string): Promise<number> {
  const { doc } = await docs.get(docId);
  let n = 0;
  for (const p of doc.pages) {
    const annots = (await native.getPageAnnotations(doc, p).toPromise()) as unknown[];
    n += annots.length;
  }
  return n;
}

describe('WorkDocs: original + tail, refreshed lazily (ADR-001 B11)', () => {
  it('concat joins original and tail without touching the original', () => {
    const a = new Uint8Array([1, 2]).buffer;
    const b = new Uint8Array([3]).buffer;
    expect([...new Uint8Array(concat(a, b))]).toEqual([1, 2, 3]);
    expect([...new Uint8Array(concat(a, null))]).toEqual([1, 2]);
  });

  it('applies a refreshed tail only on the next access, by reopening original + tail', async () => {
    const { original, tail } = pair();
    const docs = new WorkDocs(() => native);
    await docs.open('d1', original, undefined);
    const before = await annotationCount(docs, 'd1');
    expect((await docs.get('d1')).appliedTailBytes).toBe(0);

    expect(docs.refresh('d1', tail)).toBe(true);
    // Nothing reopened yet: the refresh is only recorded.
    const after = await annotationCount(docs, 'd1');
    expect((await docs.get('d1')).appliedTailBytes).toBe(tail.byteLength);
    expect(after).toBeGreaterThan(before);
    await docs.close('d1');
    expect(docs.size).toBe(0);
  });

  it('opens directly with a tail (the respawn path)', async () => {
    const { original, tail } = pair();
    const docs = new WorkDocs(() => native);
    await docs.open('d2', original, tail);
    expect((await docs.get('d2')).appliedTailBytes).toBe(tail.byteLength);
    await docs.close('d2');
  });

  it('refuses unknown documents with a typed error', () => {
    const docs = new WorkDocs(() => native);
    expect(() => docs.refresh('nope', new ArrayBuffer(1))).toThrow(/not open/);
  });
});

describe.skipIf(!hasQpdf())('WorkDocs: owner unlock (§7.12, ADR-013 decision 3)', () => {
  it('unlocks the kept copy and unlocks again after a lazy reload', async () => {
    const v = encryptedVariants(simplePdf(1)).find((x) => x.name === 'R6-aes-256');
    if (!v) throw new Error('R6');
    const docs = new WorkDocs(() => native);
    const bytes = (): ArrayBuffer => v.bytes.slice().buffer;
    const perms = async () => {
      const { doc } = await docs.get('enc');
      return (await native.getDocPermissions(doc).toPromise()) >>> 0;
    };
    await docs.open('enc', bytes(), undefined, USER_PW);
    expect(await perms()).toBe(0xfffff2c0);
    expect(await docs.unlock('enc', 'wrong')).toBe(false);
    expect(await docs.unlock('enc', OWNER_PW)).toBe(true);
    expect(await perms()).toBe(0xfffffffc);
    docs.refresh('enc', new ArrayBuffer(0)); // forces a reopen on the next access
    expect(await perms()).toBe(0xfffffffc);
    await docs.close('enc');
  });
});
