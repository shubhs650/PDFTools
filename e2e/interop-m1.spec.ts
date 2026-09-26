import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { cap } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M1-28: files saved by the real app for the owner's interop run
// (e2e/interop/CHECKLIST.md §M1, ADR-001 B16). Each self-made S1 original is
// opened, gets red squares (the e2e save probe: M1 has no annotation tools),
// and is written with Ctrl+S (two revisions), Save As, and Save Optimized as
// a new file. Every output is checked here (incremental prefix, qpdf); with
// M1_INTEROP_OUT=1 they are also written to e2e/fixtures/self-made/m1-interop/.

const SRC = 'e2e/fixtures/self-made/s1-interop';
const OUT = 'e2e/fixtures/self-made/m1-interop';
const INPUTS = [
  'plain',
  'annotated',
  'form',
  'objstm',
  'encrypted-aes256',
  'encrypted-rc4-128',
  'signed',
] as const;

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
const fileOf = async (page: Page, name: string) =>
  Buffer.from((await cap(page, 'open', 'readFile', name)) as string, 'base64');

function qpdfCheck(bytes: Buffer): number | null | 'absent' {
  if (spawnSync('qpdf', ['--version']).status !== 0) return 'absent';
  const file = join(mkdtempSync(join(tmpdir(), 'pdftools-m1-interop-')), 'saved.pdf');
  writeFileSync(file, bytes);
  return spawnSync('qpdf', ['--check', file]).status;
}

async function pickerTarget(page: Page, name: string): Promise<void> {
  await page.evaluate((n) => {
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async () => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('e2e-files', { create: true });
      return dir.getFileHandle(n, { create: true });
    };
  }, name);
}

/** Waits for a save to finish; small files can trip the > 30 % growth prompt: keep it incremental. */
async function saved(page: Page, name: string): Promise<void> {
  const prompt = page.getByRole('dialog', { name: 'Save optimized instead?' });
  const done = tabs(page).first();
  await expect(prompt.or(page.getByRole('tab', { name, exact: true }))).toBeVisible();
  if (await prompt.isVisible()) {
    await prompt.getByRole('button', { name: 'Just save' }).click();
    await expect(done).toHaveAccessibleName(name);
  }
  await expect(page.getByRole('status').filter({ hasText: /Saving|Checking|Writing/ })).toHaveCount(
    0,
  );
}

function keep(name: string, bytes: Buffer): void {
  if (process.env.M1_INTEROP_OUT !== '1') return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), bytes);
}

for (const input of INPUTS) {
  test(`M1 interop outputs: ${input}`, async ({ page }) => {
    const original = readFileSync(join(SRC, `original__${input}.pdf`));
    await page.goto('/');
    const name = `${input}.pdf`;
    const [id] = (await cap(page, 'open', 'openHandles', [
      { name, b64: original.toString('base64') },
    ])) as string[];
    if (!id) throw new Error('not opened');
    await expect(tabs(page)).toHaveCount(1);

    // Ctrl+S twice: two narrow revisions appended to the original bytes.
    expect(await cap(page, 'save', 'addSquares', id, 2)).toBeNull();
    if (input === 'form')
      expect(await cap(page, 'save', 'fillText', id, 'Edited by M1')).not.toEqual([]);
    await page.keyboard.press('Control+S');
    await saved(page, name);
    expect(await cap(page, 'save', 'addSquares', id, 1, 2)).toBeNull();
    await page.keyboard.press('Control+S');
    await saved(page, name);
    const ctrlS = await fileOf(page, name);
    expect(ctrlS.subarray(0, original.length).equals(original)).toBe(true);
    expect([0, 3, 'absent']).toContain(qpdfCheck(ctrlS));
    keep(`${input}__ctrl-s.pdf`, ctrlS);

    // Save As: the saved file plus one more square, to a new file.
    expect(await cap(page, 'save', 'addSquares', id, 1, 3)).toBeNull();
    const asName = `${input}__save-as.pdf`;
    await pickerTarget(page, asName);
    await page.keyboard.press('Control+Shift+S');
    await expect(tabs(page).first()).toHaveAccessibleName(asName);
    await saved(page, asName);
    const saveAs = await fileOf(page, asName);
    expect(saveAs.subarray(0, ctrlS.length).equals(ctrlS)).toBe(true);
    expect([0, 3, 'absent']).toContain(qpdfCheck(saveAs));
    keep(asName, saveAs);

    // Save Optimized as a new file: a full rewrite (signatures are invalidated, as warned).
    const optName = `${input}__optimized.pdf`;
    await pickerTarget(page, optName);
    await page.getByTestId('file-tab').click();
    const backstage = page.getByTestId('backstage');
    await backstage.getByRole('button', { name: 'Save Optimized' }).first().click();
    await backstage.getByRole('region').getByRole('button', { name: 'Save Optimized' }).click();
    const dialog = page.getByRole('dialog', { name: `Save ${asName} optimized` });
    if (input === 'signed') await expect(dialog).toContainText('digital signature');
    await dialog.getByRole('button', { name: 'Save as new file…' }).click();
    await expect(tabs(page).first()).toHaveAccessibleName(optName);
    await saved(page, optName);
    const optimized = await fileOf(page, optName);
    expect(optimized.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect([0, 'absent']).toContain(qpdfCheck(optimized));
    keep(optName, optimized);
  });
}

test('M1 interop: a file that denies annotations gets none (rule 9)', async ({ page }) => {
  const original = readFileSync(join(SRC, 'original__encrypted-noannotate.pdf'));
  await page.goto('/');
  const [id] = (await cap(page, 'open', 'openHandles', [
    { name: 'noannotate.pdf', b64: original.toString('base64') },
  ])) as string[];
  if (!id) throw new Error('not opened');
  expect(await cap(page, 'save', 'addSquares', id, 1)).not.toBeNull();
  await expect(tabs(page).first()).toHaveAccessibleName('noannotate.pdf');
});
