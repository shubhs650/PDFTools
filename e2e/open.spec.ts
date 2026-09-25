import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { cap, drop, dropStaged, stage } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M1-13: open pipeline and document tabs.

interface OpenState {
  names: string[];
  active: string | null;
  activeId: string | null;
  engineActive: string | null;
  engineOrder: string[];
  sources: number;
  permissions: number[];
  pageCounts: number[];
}

const state = (page: Page) => cap(page, 'open', 'state') as Promise<OpenState>;

/** Uses the `<input type=file>` path, which Playwright's file chooser drives. */
async function withoutFsa(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined });
  });
}

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');

test('Ctrl+O opens files through the picker, each in its own tab; reopening focuses it', async ({
  page,
  pdfs,
}) => {
  await withoutFsa(page);
  await page.goto('/');
  await expect(page.getByTestId('start-screen')).toBeVisible();

  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Control+o');
  await (
    await chooser
  ).setFiles([
    { name: 'one.pdf', mimeType: 'application/pdf', buffer: pdfs.simple(1) },
    { name: 'three.pdf', mimeType: 'application/pdf', buffer: pdfs.simple(3) },
  ]);
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(0)).toHaveAccessibleName('one.pdf');
  await expect(tabs(page).nth(1)).toHaveAccessibleName('three.pdf');
  await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  let s = await state(page);
  expect(s.pageCounts).toEqual([1, 3]);
  expect(s.engineOrder).toHaveLength(2);
  expect(s.engineActive).toBe(s.activeId);
  // Permission flags are stored with each document (rule 9); unrestricted here.
  expect(s.permissions).toEqual([0xffffffff, 0xffffffff]);

  // The same bytes again (no handle on this path): the fingerprint matches.
  await tabs(page).nth(0).click();
  const again = page.waitForEvent('filechooser');
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+o');
  await (
    await again
  ).setFiles([{ name: 'three.pdf', mimeType: 'application/pdf', buffer: pdfs.simple(3) }]);
  await expect.poll(async () => (await state(page)).active).toBe('three.pdf');
  s = await state(page);
  expect(s.names).toEqual(['one.pdf', 'three.pdf']);
  expect(s.sources).toBe(2);
});

test('the FSA path: handles to the same file focus the existing tab (isSameEntry)', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  const b64 = pdfs.simple(2).toString('base64');
  await cap(page, 'open', 'openHandles', [
    { name: 'a.pdf', b64 },
    { name: 'b.pdf', b64: pdfs.simple(1).toString('base64') },
  ]);
  await expect(tabs(page)).toHaveCount(2);
  const ids = (await cap(page, 'open', 'openHandles', [{ name: 'a.pdf', b64 }])) as string[];
  expect(ids).toHaveLength(1);
  const s = await state(page);
  expect(s.names).toEqual(['a.pdf', 'b.pdf']);
  expect(s.active).toBe('a.pdf');
});

test('drop 3 files, switch between them, close them; the last close shows the start screen', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await drop(page, [
    { name: 'a.pdf', b64: pdfs.simple(1).toString('base64') },
    { name: 'b.pdf', b64: pdfs.simple(2).toString('base64') },
    { name: 'c.pdf', b64: pdfs.simple(3).toString('base64') },
  ]);
  await expect(tabs(page)).toHaveCount(3);
  expect((await state(page)).names).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);

  await tabs(page).nth(1).click();
  await expect
    .poll(async () => (await state(page)).engineActive)
    .toBe((await state(page)).activeId);
  expect((await state(page)).active).toBe('b.pdf');
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+PageDown');
  await expect.poll(async () => (await state(page)).active).toBe('c.pdf');

  await page.getByRole('button', { name: 'Close c.pdf' }).click();
  await expect(tabs(page)).toHaveCount(2);
  expect((await state(page)).active).toBe('b.pdf');

  // Overflow menu lists every document.
  await page.getByRole('button', { name: 'All open documents' }).click();
  await page.getByRole('menuitem', { name: 'a.pdf' }).click();
  expect((await state(page)).active).toBe('a.pdf');

  await page.getByRole('button', { name: 'Close a.pdf' }).click();
  await page.getByRole('button', { name: 'Close b.pdf' }).click();
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await expect.poll(async () => (await state(page)).engineOrder).toEqual([]);
  expect((await state(page)).sources).toBe(0);
});

test('closing a tab with unsaved changes asks first; Cancel keeps it, Don’t save closes it', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await drop(page, [{ name: 'draft.pdf', b64: pdfs.simple(1).toString('base64') }]);
  await expect(tabs(page)).toHaveCount(1);
  const { activeId } = await state(page);
  await page.evaluate((id) => {
    (
      window as unknown as {
        __pdftoolsTest: {
          capabilities: { stores: { documents: { getState(): { markDirty(id: string): void } } } };
        };
      }
    ).__pdftoolsTest.capabilities.stores.documents
      .getState()
      .markDirty(id ?? '');
  }, activeId);
  await expect(tabs(page).first()).toHaveAccessibleName('draft.pdf, unsaved changes');

  await page.getByRole('button', { name: 'Close draft.pdf' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save changes to draft.pdf?' });
  await expect(dialog).toBeVisible();
  // Save arrives with M1-22.
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(tabs(page)).toHaveCount(1);

  // Ctrl+F4 (and its alternate) go through the same prompt.
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+Alt+w');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: "Don't save" }).click();
  await expect(page.getByTestId('start-screen')).toBeVisible();
});

test('a text file and a truncated PDF get localized messages; no tab opens', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  const full = pdfs.simple(3);
  await drop(page, [
    {
      name: 'notes.txt',
      b64: Buffer.from('just some text').toString('base64'),
      type: 'text/plain',
    },
  ]);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAccessibleName("Couldn't open notes.txt");
  await expect(dialog).toContainText('This file is not a PDF.');
  await dialog.getByRole('button', { name: 'OK' }).click();

  await drop(page, [{ name: 'broken.pdf', b64: full.subarray(0, 40).toString('base64') }]);
  await expect(dialog).toHaveAccessibleName("Couldn't open broken.pdf");
  await expect(dialog).toContainText('This PDF is damaged');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('start-screen')).toBeVisible();
  const s = await state(page);
  expect(s.names).toEqual([]);
  expect(s.engineOrder).toEqual([]);
});

test('a password-protected file says it is not supported yet', async ({ page, pdfs }) => {
  let qpdf = true;
  try {
    execFileSync('qpdf', ['--version']);
  } catch {
    qpdf = false;
  }
  test.skip(!qpdf, 'qpdf is needed to make the encrypted fixture');
  const dir = mkdtempSync(join(tmpdir(), 'pdftools-open-'));
  writeFileSync(join(dir, 'in.pdf'), pdfs.simple(1));
  execFileSync('qpdf', [
    '--encrypt',
    'u',
    'o',
    '256',
    '--',
    join(dir, 'in.pdf'),
    join(dir, 'out.pdf'),
  ]);
  await page.goto('/');
  await drop(page, [
    { name: 'locked.pdf', b64: readFileSync(join(dir, 'out.pdf')).toString('base64') },
  ]);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAccessibleName("Couldn't open locked.pdf");
  await expect(dialog).toContainText('password-protected');
  await dialog.getByRole('button', { name: 'OK' }).click();
  expect((await state(page)).engineOrder).toEqual([]);
});

// Long tasks during open are gated in e2e/perf/open.spec.ts (serial, perf project).
test('opening the 2,000-page stand-in writes nothing to OPFS (§4.3)', async ({ page, pdfs }) => {
  await page.goto('/');
  await cap(page, 'storage', 'clearAll');
  await drop(page, [{ name: 'contract.pdf', b64: pdfs.contract(2000).toString('base64') }]);
  await expect(tabs(page)).toHaveCount(1);
  expect((await state(page)).pageCounts).toEqual([2000]);
  const entries = (await cap(page, 'storage', 'opfsEntries')) as string[];
  expect(entries).not.toContain('recovery');
});
