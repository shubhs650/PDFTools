import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { cap } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M1-22: Ctrl+S appends the verified tail to the file's own handle; Save As
// writes a full copy to a new file. OPFS handles stand in for files on disk;
// edits come from the e2e save probe. The 20-page contract stand-in is large
// enough that these saves stay under the 30 % growth prompt (M1-23).

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
  const file = join(mkdtempSync(join(tmpdir(), 'pdftools-save-')), 'saved.pdf');
  writeFileSync(file, bytes);
  return spawnSync('qpdf', ['--check', file]).status;
}

async function saveAsTarget(page: Page, name: string): Promise<void> {
  await page.evaluate((n) => {
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async () => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('e2e-files', { create: true });
      return dir.getFileHandle(n, { create: true });
    };
  }, name);
}

test('Ctrl+S appends to the original; a second Ctrl+S is a no-op; the dirty mark clears', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  const original = pdfs.contract(20);
  const id = await openHandle(page, 'doc.pdf', original);
  expect(await cap(page, 'save', 'addSquares', id, 3)).toBeNull();
  await expect(tabs(page).first()).toHaveAccessibleName(/unsaved changes/);

  await page.keyboard.press('Control+S');
  await expect(tabs(page).first()).toHaveAccessibleName('doc.pdf');
  const saved = await fileOf(page, 'doc.pdf');
  expect(saved.length).toBeGreaterThan(original.length);
  expect(saved.subarray(0, original.length).equals(original)).toBe(true);
  expect(squaresIn(saved)).toBe(3);
  expect([0, 3, 'absent']).toContain(qpdfCheck(saved));

  await page.keyboard.press('Control+S');
  await expect(page.getByRole('status').filter({ hasText: /Saving|Checking|Writing/ })).toHaveCount(
    0,
  );
  expect((await fileOf(page, 'doc.pdf')).length).toBe(saved.length);

  // Another edit, another revision appended to the saved file.
  expect(await cap(page, 'save', 'addSquares', id, 1, 3)).toBeNull();
  await page.keyboard.press('Control+S');
  await expect(tabs(page).first()).toHaveAccessibleName('doc.pdf');
  const twice = await fileOf(page, 'doc.pdf');
  expect(twice.subarray(0, saved.length).equals(saved)).toBe(true);
  expect(squaresIn(twice)).toBe(4);
  expect([0, 3, 'absent']).toContain(qpdfCheck(twice));
});

test('Save As writes original + changes to a new file, which becomes the document', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  const original = pdfs.contract(20);
  const id = await openHandle(page, 'first.pdf', original);
  expect(await cap(page, 'save', 'addSquares', id, 2)).toBeNull();
  await saveAsTarget(page, 'copy.pdf');
  await page.keyboard.press('Control+Shift+S');
  await expect(tabs(page).first()).toHaveAccessibleName('copy.pdf');

  const copy = await fileOf(page, 'copy.pdf');
  expect(copy.subarray(0, original.length).equals(original)).toBe(true);
  expect(squaresIn(copy)).toBe(2);
  expect((await fileOf(page, 'first.pdf')).equals(original)).toBe(true);

  // Ctrl+S now appends to the copy.
  expect(await cap(page, 'save', 'addSquares', id, 1, 2)).toBeNull();
  await page.keyboard.press('Control+S');
  await expect(tabs(page).first()).toHaveAccessibleName('copy.pdf');
  const again = await fileOf(page, 'copy.pdf');
  expect(again.subarray(0, copy.length).equals(copy)).toBe(true);
  expect(squaresIn(again)).toBe(3);
  expect([0, 3, 'absent']).toContain(qpdfCheck(again));
});

test('closing with unsaved changes: Save writes the file, then the tab closes', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  const id = await openHandle(page, 'closing.pdf', pdfs.simple(1));
  expect(await cap(page, 'save', 'addSquares', id, 2)).toBeNull();
  await page.getByRole('button', { name: 'Close closing.pdf' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save changes to closing.pdf?' });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('start-screen')).toBeVisible();
  expect(squaresIn(await fileOf(page, 'closing.pdf'))).toBe(2);
});

test('write permission denied: a localized error offers Save As; the original is untouched', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  const original = pdfs.simple(1);
  const id = await openHandle(page, 'locked.pdf', original);
  expect(await cap(page, 'save', 'addSquares', id, 1)).toBeNull();
  await page.evaluate(() => {
    const proto = FileSystemHandle.prototype as unknown as Record<string, unknown>;
    proto.queryPermission = () => Promise.resolve('denied');
    proto.requestPermission = () => Promise.resolve('denied');
  });
  await page.keyboard.press('Control+S');
  const dialog = page.getByRole('dialog', { name: "Couldn't save locked.pdf" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("doesn't have permission");
  expect((await fileOf(page, 'locked.pdf')).equals(original)).toBe(true);
  // The modal dialog hides the rest of the page from the accessibility tree.
  await expect(page.getByRole('tab', { name: /unsaved changes/, includeHidden: true })).toHaveCount(
    1,
  );

  await saveAsTarget(page, 'unlocked.pdf');
  await dialog.getByRole('button', { name: 'Save As…' }).click();
  await expect(tabs(page).first()).toHaveAccessibleName('unlocked.pdf');
  expect(squaresIn(await fileOf(page, 'unlocked.pdf'))).toBe(1);
});

test('without a file handle (dropped file / fallback) Ctrl+S downloads a copy', async ({
  page,
  pdfs,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined });
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined });
  });
  await page.goto('/');
  const { stage, dropStaged } = await import('./support/app.ts');
  await stage(page, [{ name: 'dropped.pdf', b64: pdfs.simple(1).toString('base64') }]);
  await dropStaged(page);
  await expect(tabs(page)).toHaveCount(1);
  const id = (await cap(page, 'open', 'state')) as { activeId: string };
  expect(await cap(page, 'save', 'addSquares', id.activeId, 1)).toBeNull();
  const download = page.waitForEvent('download');
  await page.keyboard.press('Control+S');
  const d = await download;
  expect(d.suggestedFilename()).toBe('dropped.pdf');
  const path = await d.path();
  const { readFileSync } = await import('node:fs');
  expect(squaresIn(readFileSync(path))).toBe(1);
  await expect(tabs(page).first()).toHaveAccessibleName('dropped.pdf');
});
