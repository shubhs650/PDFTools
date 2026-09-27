import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { cap } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M1-21: every save is verified by the Work worker before it counts; a failed
// check falls back to keep-all. Edits go through the e2e save probe.

const S1 = 'e2e/fixtures/self-made/s1-interop';

interface Verified {
  mode: 'narrow' | 'keep-all';
  fellBack: boolean;
  from: number;
  baseLength: number;
  tail: string;
  tailLength: number;
}

async function openOne(page: Page, name: string, bytes: Buffer): Promise<string> {
  const [id] = (await cap(page, 'open', 'openHandles', [
    { name, b64: bytes.toString('base64') },
  ])) as string[];
  if (!id) throw new Error('not opened');
  return id;
}

const squares = async (page: Page, id: string) =>
  (
    (await cap(page, 'save', 'workDigest', id, [0])) as {
      pages: { annots: { subtype: number }[] }[];
    }
  ).pages[0]?.annots.filter((a) => a.subtype === 5).length ?? 0;

function qpdfCheck(bytes: Buffer): number | null | 'absent' {
  if (spawnSync('qpdf', ['--version']).status !== 0) return 'absent';
  const file = join(mkdtempSync(join(tmpdir(), 'pdftools-verify-')), 'saved.pdf');
  writeFileSync(file, bytes);
  return spawnSync('qpdf', ['--check', file]).status;
}

test('a verified save refreshes the Work copy: a Work job sees the new annotation', async ({
  page,
}) => {
  await page.goto('/');
  const id = await openOne(page, 'plain.pdf', readFileSync(`${S1}/original__plain.pdf`));
  expect(await squares(page, id)).toBe(0);
  expect(await cap(page, 'save', 'addSquares', id, 2)).toBeNull();

  const r = (await cap(page, 'save', 'verifiedSave', id)) as Verified;
  expect(r).toMatchObject({ mode: 'narrow', fellBack: false });
  expect(await cap(page, 'save', 'workState', id)).toMatchObject({
    appliedTailBytes: r.tailLength,
  });
  expect(await squares(page, id)).toBe(2);
  expect(await cap(page, 'save', 'fallbacks')).toEqual([]);
  // Nothing changed since: no second revision.
  expect(await cap(page, 'save', 'verifiedSave', id)).toBeNull();
});

test('forced mismatch takes the keep-all path, logs counts only, and the file is still clean', async ({
  page,
}) => {
  await page.goto('/');
  const original = readFileSync(`${S1}/original__form.pdf`);
  const id = await openOne(page, 'form.pdf', original);
  expect(await cap(page, 'save', 'addSquares', id, 1)).toBeNull();
  expect(
    ((await cap(page, 'save', 'fillText', id, 'Verified')) as string[]).length,
  ).toBeGreaterThan(0);

  const r = (await cap(page, 'save', 'verifiedSave', id, true)) as Verified;
  expect(r).toMatchObject({ mode: 'keep-all', fellBack: true, from: original.length });
  const fallbacks = (await cap(page, 'save', 'fallbacks')) as {
    code: string;
    counts: Record<string, number>;
  }[];
  expect(fallbacks).toHaveLength(1);
  expect(fallbacks[0]?.code).toMatch(/^save-fallback:/);
  expect(Object.keys(fallbacks[0]?.counts ?? {}).sort()).toEqual(['objectCount', 'size']);

  const saved = Buffer.concat([original, Buffer.from(r.tail, 'base64')]);
  expect(saved.subarray(0, original.length).equals(original)).toBe(true);
  expect([0, 3, 'absent']).toContain(qpdfCheck(saved));
  expect(await squares(page, id)).toBe(1);
});

test('object-layer keys (M3-03) save in the same revision and pass the Work worker check', async ({
  page,
}) => {
  await page.goto('/');
  // An xref-stream file: the Work worker's reader inflates in the worker.
  const original = readFileSync(`${S1}/original__objstm.pdf`);
  const id = await openOne(page, 'objstm.pdf', original);
  expect(await cap(page, 'save', 'addSquares', id, 1)).toBeNull();
  const measure = {
    dict: {
      Type: { name: 'Measure' },
      Subtype: { name: 'RL' },
      R: { text: '1 mm = 100 mm' },
      X: [{ dict: { U: { text: 'm' }, C: 0.0352777778 } }],
    },
  };
  expect(
    await cap(page, 'save', 'stage', id, { page: 0, annot: 'e2e-square-0' }, { Measure: measure }),
  ).toBeNull();
  expect(
    await cap(page, 'save', 'stage', id, { page: 0 }, { VP: [{ dict: { Measure: measure } }] }),
  ).toBeNull();
  expect(await cap(page, 'save', 'stage', id, { page: 0 }, { Annots: [] })).toBe('patch-key');
  expect(await cap(page, 'save', 'state', id)).toMatchObject({ staged: 2 });

  const r = (await cap(page, 'save', 'verifiedSave', id)) as Verified;
  expect(r).toMatchObject({ mode: 'narrow', fellBack: false });
  const tail = Buffer.from(r.tail, 'base64').toString('latin1');
  expect(tail.match(/startxref/g)?.length).toBe(1);
  expect(tail).toContain('/VP');
  expect(tail).toContain('/Measure');
  expect(await cap(page, 'save', 'fallbacks')).toEqual([]);
  expect(await cap(page, 'save', 'state', id)).toMatchObject({ staged: 0 });
  expect([0, 3, 'absent']).toContain(
    qpdfCheck(Buffer.concat([original, Buffer.from(r.tail, 'base64')])),
  );
});
