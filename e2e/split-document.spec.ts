import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { annotatedPdf, buildPdf, type PdfObject } from './fixtures/generate.ts';
import { cap, darkTheme, drop, dropStaged } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { folderFiles, savedFiles, stubFolderPicker, stubSavePicker } from './support/savePicker.ts';

// M11-08·O7 (D-55, §7.8): Organize › Split Document. Every N pages, page
// ranges (one file per range) or top-level bookmarks; the Work worker builds
// the parts from the copy with the unsaved changes; they go into a folder the
// user picks, named after the original, never replacing a file there (one ZIP
// where the browser has no folder picker). The open document is not changed.

/** `n` pages of distinct widths from `start` (start, start + 20, …). */
function sized(n: number, start: number): Uint8Array {
  const objs: PdfObject[] = ['<< /Type /Catalog /Pages 2 0 R >>', ''];
  const font = 3 + n * 2;
  const kids: string[] = [];
  for (let i = 0; i < n; i++) {
    kids.push(`${String(3 + i * 2)} 0 R`);
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(start + i * 20)} 600] /Resources << /Font << /F1 ${String(font)} 0 R >> >> /Contents ${String(4 + i * 2)} 0 R >>`,
      { dict: '<< >>', stream: `BT /F1 24 Tf 40 500 Td (Sheet ${String(start + i * 20)}) Tj ET` },
    );
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${String(n)} >>`;
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  return buildPdf(objs);
}

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const activeId = async (page: Page) => (await cap(page, 'view', 'activeDocId')) as string;
const widths = async (page: Page, id: string) =>
  ((await cap(page, 'pages', 'info', id)) as { w: number }[]).map((p) => p.w);
const organize = (page: Page) => page.getByRole('toolbar', { name: 'Organize commands' });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Split Document' });
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
const toast = (page: Page) => page.getByTestId('snapshot-toast');

async function open(page: Page, bytes: Uint8Array, name: string): Promise<string> {
  await page.goto('/');
  await drop(page, [{ name, b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  return activeId(page);
}

async function openSplit(page: Page) {
  await page.getByRole('tab', { name: 'Organize' }).click();
  await organize(page).getByRole('button', { name: 'Split Document' }).click();
  await expect(dialog(page)).toBeVisible();
}

/** Opens a file the split wrote (the fake folder keeps it) in a new tab: its page widths. */
async function reopen(page: Page, path: string): Promise<number[]> {
  const before = await tabs(page).count();
  await page.evaluate((p) => {
    const w = window as unknown as { folderBlobs: Record<string, Blob>; __staged: File[] };
    const blob = w.folderBlobs[p];
    if (!blob) throw new Error(`not written: ${p}`);
    w.__staged = [new File([blob], p, { type: 'application/pdf' })];
  }, path);
  await dropStaged(page);
  await expect(tabs(page)).toHaveCount(before + 1);
  const id = await activeId(page);
  await expect.poll(() => widths(page, id).catch(() => [])).not.toEqual([]);
  return widths(page, id);
}

test('every N pages: names, preview, a free name beside an existing file, the parts @smoke', async ({
  page,
}) => {
  const id = await open(page, sized(7, 400), 'sheets.pdf');
  // A file of the first part's name is already in the folder: it is kept.
  await stubFolderPicker(page, ['sheets (pages 1-3).pdf']);
  await openSplit(page);
  await expect(dialog(page).getByLabel('Every few pages')).toBeChecked();
  await dialog(page).getByLabel('Pages in each file').fill('3');
  const preview = dialog(page).getByRole('list', { name: '3 files:' });
  await expect(preview.getByRole('listitem')).toHaveText([
    'sheets (pages 1-3).pdf',
    'sheets (pages 4-6).pdf',
    'sheets (page 7).pdf',
  ]);
  await expect(dialog(page)).toContainText('Files already in it are never replaced.');
  expect((await new AxeBuilder({ page }).include('.ui-dialog').analyze()).violations).toEqual([]);

  await dialog(page).getByLabel('Pages in each file').fill('0');
  await expect(dialog(page).getByRole('alert')).toHaveText(
    'Type a whole number of pages from 1 to 7.',
  );
  await expect(dialog(page).getByRole('button', { name: 'Split' })).toBeDisabled();
  await dialog(page).getByLabel('Pages in each file').fill('3');

  await dialog(page).getByRole('button', { name: 'Split' }).click();
  await expect(toast(page)).toHaveText(/^Saved 3 files in/u);
  await expect(dialog(page)).toHaveCount(0);
  expect((await folderFiles(page)).map((f) => f.path)).toEqual([
    'sheets (pages 1-3) (2).pdf',
    'sheets (pages 4-6).pdf',
    'sheets (page 7).pdf',
  ]);
  // The open document is not changed.
  expect(await widths(page, id)).toEqual([400, 420, 440, 460, 480, 500, 520]);
  expect(await reopen(page, 'sheets (pages 4-6).pdf')).toEqual([460, 480, 500]);
  expect(await reopen(page, 'sheets (page 7).pdf')).toEqual([520]);
});

test('page ranges: one file per range, with the unsaved changes', async ({ page }) => {
  const id = await open(page, sized(6, 400), 'plan.pdf');
  // An unsaved change: page 2 deleted (pages are now 400, 440, 460, 480, 500).
  await cap(page, 'pages', 'run', id, { kind: 'delete', pages: [1] });
  await expect.poll(() => widths(page, id)).toEqual([400, 440, 460, 480, 500]);
  await stubFolderPicker(page);
  await openSplit(page);
  await dialog(page).getByLabel('By page ranges, one file per range').check();
  const ranges = dialog(page).getByRole('textbox', { name: 'Page ranges' });
  await ranges.fill('1-2, 9');
  await expect(dialog(page).getByRole('alert')).toHaveText('Some pages are not in this document.');
  await expect(dialog(page).getByRole('button', { name: 'Split' })).toBeDisabled();
  await ranges.fill('4-; 1 - 2');
  await expect(
    dialog(page).getByRole('list', { name: '2 files:' }).getByRole('listitem'),
  ).toHaveText(['plan (pages 4-5).pdf', 'plan (pages 1-2).pdf']);
  await dialog(page).getByRole('button', { name: 'Split' }).click();
  await expect(toast(page)).toHaveText(/^Saved 2 files in/u);
  expect(await reopen(page, 'plan (pages 4-5).pdf')).toEqual([480, 500]);
  expect(await reopen(page, 'plan (pages 1-2).pdf')).toEqual([400, 440]);
});

test('top-level bookmarks: one numbered file per bookmark; none: the choice is off', async ({
  page,
}) => {
  // Two bookmarks: "Introduction" → page 1, "Appendix GLOSSARIUM" → page 3.
  await open(page, annotatedPdf(), 'manual.pdf');
  await stubFolderPicker(page);
  await openSplit(page);
  const byBookmarks = dialog(page).getByLabel('By top-level bookmarks, one file per bookmark');
  await expect(byBookmarks).toBeEnabled();
  await byBookmarks.check();
  await expect(
    dialog(page).getByRole('list', { name: '2 files:' }).getByRole('listitem'),
  ).toHaveText(['manual - 01 Introduction.pdf', 'manual - 02 Appendix GLOSSARIUM.pdf']);
  await dialog(page).getByRole('button', { name: 'Split' }).click();
  await expect(toast(page)).toHaveText(/^Saved 2 files in/u);
  expect((await reopen(page, 'manual - 01 Introduction.pdf')).length).toBe(2);
  expect((await reopen(page, 'manual - 02 Appendix GLOSSARIUM.pdf')).length).toBe(1);

  // A document without bookmarks: the choice says so and can't be picked.
  await drop(page, [{ name: 'plain.pdf', b64: b64(sized(2, 400)) }]);
  await expect(tabs(page)).toHaveCount(4);
  await openSplit(page);
  await expect(
    dialog(page).getByLabel('By top-level bookmarks (this document has none that go to its pages)'),
  ).toBeDisabled();
  // The last choice (bookmarks) is kept in the session, but gives way when it can't apply.
  await expect(dialog(page).getByLabel('Every few pages')).toBeChecked();
  await expect(dialog(page).getByRole('button', { name: 'Split' })).toBeEnabled();
});

test('no folder picker: one ZIP; dark theme dialog passes axe', async ({ page }) => {
  await darkTheme(page);
  await open(page, sized(4, 400), 'sheets.pdf');
  await stubSavePicker(page);
  await page.evaluate(() => {
    (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker = undefined;
  });
  await openSplit(page);
  await dialog(page).getByLabel('Pages in each file').fill('2');
  await expect(dialog(page)).toContainText('The files are saved together in one ZIP file.');
  expect((await new AxeBuilder({ page }).include('.ui-dialog').analyze()).violations).toEqual([]);
  await dialog(page).getByRole('button', { name: 'Split' }).click();
  await expect(toast(page)).toHaveText('Saved 2 files in sheets (split).zip');
  const saved = await savedFiles(page);
  expect(saved.map((f) => f.name)).toEqual(['sheets (split).zip']);
  expect(saved[0]?.bytes ?? 0).toBeGreaterThan(500);
});
