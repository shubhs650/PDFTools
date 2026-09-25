import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { cap } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M1-20: the save core runs in the Render worker; the page only receives bytes.
// Edits go through the engine (the e2e save probe) until M3's annotation UI.

const S1 = 'e2e/fixtures/self-made/s1-interop';

interface Saved {
  tail: string;
  tailLength: number;
  mode: string;
  kept: number[];
  baseLength: number;
}

async function openOne(page: Page, name: string, bytes: Buffer): Promise<string> {
  const [id] = (await cap(page, 'open', 'openHandles', [
    { name, b64: bytes.toString('base64') },
  ])) as string[];
  if (!id) throw new Error('not opened');
  return id;
}

const save = (page: Page, id: string) => cap(page, 'save', 'saveIncremental', id) as Promise<Saved>;

function qpdfCheck(bytes: Buffer): number | null | 'absent' {
  if (spawnSync('qpdf', ['--version']).status !== 0) return 'absent';
  const file = join(mkdtempSync(join(tmpdir(), 'pdftools-e2e-')), 'saved.pdf');
  writeFileSync(file, bytes);
  return spawnSync('qpdf', ['--check', file]).status;
}

test('annotations and form values save as a narrow tail; commit makes the next save relative to it', async ({
  page,
}) => {
  await page.goto('/');
  const original = readFileSync(`${S1}/original__form.pdf`);
  const id = await openOne(page, 'form.pdf', original);

  expect((await save(page, id)).tailLength).toBe(0);
  expect(await cap(page, 'save', 'addSquares', id, 2)).toBeNull();
  expect(((await cap(page, 'save', 'fillText', id, 'e2e')) as string[]).length).toBeGreaterThan(0);

  const first = await save(page, id);
  expect(first.mode).toBe('narrow');
  expect(first.baseLength).toBe(original.length);
  const saved = Buffer.concat([original, Buffer.from(first.tail, 'base64')]);
  expect(saved.subarray(0, original.length).equals(original)).toBe(true);
  expect(saved.toString('latin1')).toMatch(/\/Prev \d+[\s\S]*%%EOF\s*$/);
  expect([0, 3, 'absent']).toContain(qpdfCheck(saved));

  expect(await cap(page, 'save', 'commit', id, first.tailLength)).toEqual({
    baseLength: saved.length,
  });
  expect((await save(page, id)).tailLength).toBe(0);
  expect(await cap(page, 'save', 'addSquares', id, 1, 2)).toBeNull();
  const second = await save(page, id);
  expect(second.baseLength).toBe(saved.length);
  expect(second.tailLength).toBeGreaterThan(0);
  expect([0, 3, 'absent']).toContain(
    qpdfCheck(Buffer.concat([saved, Buffer.from(second.tail, 'base64')])),
  );
});

test('a document without annotate permission refuses edits (rule 9)', async ({ page }) => {
  await page.goto('/');
  const id = await openOne(
    page,
    'locked.pdf',
    readFileSync(`${S1}/original__encrypted-noannotate.pdf`),
  );
  expect(await cap(page, 'save', 'addSquares', id, 1)).toBe('pdfium:5');
  expect(await cap(page, 'save', 'state', id)).toMatchObject({ dirty: [], untracked: false });
  expect((await save(page, id)).tailLength).toBe(0);
});
