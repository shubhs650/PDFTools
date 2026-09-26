import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { cap } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M1-23: growth prompt, Save Optimized (copy / replace, signature warning) and
// save progress with cancel before commit. OPFS handles stand in for disk files.

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');

async function openHandle(page: Page, name: string, bytes: Buffer): Promise<string> {
  const [id] = (await cap(page, 'open', 'openHandles', [
    { name, b64: bytes.toString('base64') },
  ])) as string[];
  if (!id) throw new Error('not opened');
  await expect(tabs(page)).toHaveCount(1);
  return id;
}

const fileOf = async (page: Page, name: string) =>
  Buffer.from((await cap(page, 'open', 'readFile', name)) as string, 'base64');
const squaresIn = (pdf: Buffer) =>
  (pdf.toString('latin1').match(/\/Subtype\s*\/Square/g) ?? []).length;

function qpdfCheck(bytes: Buffer): number | null | 'absent' {
  if (spawnSync('qpdf', ['--version']).status !== 0) return 'absent';
  const file = join(mkdtempSync(join(tmpdir(), 'pdftools-opt-')), 'saved.pdf');
  writeFileSync(file, bytes);
  return spawnSync('qpdf', ['--check', file]).status;
}

async function saved(page: Page, name: string): Promise<void> {
  await expect(tabs(page).first()).toHaveAccessibleName(name);
}

async function openSaveOptimized(page: Page): Promise<void> {
  await page.getByTestId('file-tab').click();
  const backstage = page.getByTestId('backstage');
  await backstage.getByRole('button', { name: 'Save Optimized' }).first().click();
  await backstage.getByRole('region').getByRole('button', { name: 'Save Optimized' }).click();
}

test('growth prompt after > 30 % growth; "Just save" is remembered; Save Optimized replaces a smaller, clean file', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  const original = pdfs.simple(1);
  const id = await openHandle(page, 'grow.pdf', original);

  // First save: nothing appended yet, no prompt.
  expect(await cap(page, 'save', 'addSquares', id, 10)).toBeNull();
  await page.keyboard.press('Control+S');
  await saved(page, 'grow.pdf');
  expect((await fileOf(page, 'grow.pdf')).length).toBeGreaterThan(original.length * 1.3);

  // Now > 30 % appended: Ctrl+S asks.
  expect(await cap(page, 'save', 'addSquares', id, 10, 10)).toBeNull();
  await page.keyboard.press('Control+S');
  const prompt = page.getByRole('dialog', { name: 'Save optimized instead?' });
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', { name: 'Just save' }).click();
  await saved(page, 'grow.pdf');
  expect(await cap(page, 'save', 'addSquares', id, 10, 20)).toBeNull();
  await page.keyboard.press('Control+S');
  await saved(page, 'grow.pdf');
  await expect(prompt).toBeHidden();
  const grown = await fileOf(page, 'grow.pdf');
  expect(squaresIn(grown)).toBeGreaterThanOrEqual(30);

  await openSaveOptimized(page);
  const dialog = page.getByRole('dialog', { name: 'Save grow.pdf optimized' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Replace original' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Writing|Saving/ })).toHaveCount(0);
  const optimized = await fileOf(page, 'grow.pdf');
  expect(optimized.length).toBeLessThan(grown.length);
  expect([0, 'absent']).toContain(qpdfCheck(optimized));
  // PDFium compresses streams in a rewrite; count the annotations through the Work copy.
  const digest = (await cap(page, 'save', 'workDigest', id, [0])) as {
    pages: { annots: { subtype: number }[] }[];
  };
  expect(digest.pages[0]?.annots.filter((a) => a.subtype === 5)).toHaveLength(30);

  // Ctrl+S after Save Optimized appends a clean revision to the rewritten file.
  expect(await cap(page, 'save', 'addSquares', id, 1, 30)).toBeNull();
  await page.keyboard.press('Control+S');
  await saved(page, 'grow.pdf');
  const after = await fileOf(page, 'grow.pdf');
  expect(after.subarray(0, optimized.length).equals(optimized)).toBe(true);
  expect([0, 'absent']).toContain(qpdfCheck(after));
});

test('a signed file: Save Optimized warns with the signature count; the growth prompt never shows', async ({
  page,
}) => {
  await page.goto('/');
  const signed = readFileSync('e2e/fixtures/self-made/s1-interop/original__signed.pdf');
  const id = await openHandle(page, 'signed.pdf', signed);
  for (let i = 0; i < 3; i++) {
    expect(await cap(page, 'save', 'addSquares', id, 10, i * 10)).toBeNull();
    await page.keyboard.press('Control+S');
    await saved(page, 'signed.pdf');
  }
  await expect(page.getByRole('dialog', { name: 'Save optimized instead?' })).toBeHidden();

  await openSaveOptimized(page);
  const dialog = page.getByRole('dialog', { name: 'Save signed.pdf optimized' });
  await expect(dialog).toContainText('This file has 1 digital signature.');
  await expect(dialog).toContainText('will invalidate it');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});

test('save progress is shown while writing, and Cancel before the commit leaves the file untouched', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  const original = pdfs.simple(1);
  const id = await openHandle(page, 'slow.pdf', original);
  expect(await cap(page, 'save', 'addSquares', id, 2)).toBeNull();
  await page.evaluate(() => {
    const proto = FileSystemWritableFileStream.prototype;
    const write = Object.getOwnPropertyDescriptor(proto, 'write')?.value as (
      this: FileSystemWritableFileStream,
      data: FileSystemWriteChunkType,
    ) => Promise<void>;
    (window as unknown as { __slowWrite: boolean }).__slowWrite = true;
    proto.write = async function (
      this: FileSystemWritableFileStream,
      data: FileSystemWriteChunkType,
    ) {
      if ((window as unknown as { __slowWrite: boolean }).__slowWrite) {
        await new Promise((r) => setTimeout(r, 1500));
      }
      return write.call(this, data);
    };
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async () => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('e2e-files', { create: true });
      return dir.getFileHandle('slow-copy.pdf', { create: true });
    };
  });

  // Save As with a slow writer: the phase shows; Cancel aborts before the commit.
  await page.keyboard.press('Control+Shift+S');
  const status = page.getByRole('status').filter({ hasText: 'Writing' });
  await expect(status).toBeVisible();
  await status.getByRole('button', { name: 'Cancel' }).click();
  await expect(status).toBeHidden();
  expect((await fileOf(page, 'slow-copy.pdf')).length).toBe(0);
  await expect(tabs(page).first()).toHaveAccessibleName('slow.pdf, unsaved changes');

  // Uninterrupted: progress shows and the copy is complete.
  await page.keyboard.press('Control+Shift+S');
  await expect(page.getByRole('status').filter({ hasText: /Writing… 0/ })).toBeVisible();
  await saved(page, 'slow-copy.pdf');
  expect(squaresIn(await fileOf(page, 'slow-copy.pdf'))).toBe(2);
});
