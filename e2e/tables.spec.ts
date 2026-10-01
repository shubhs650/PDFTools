import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { BOLTS, FLANGE, PIPE, tablesPdf } from './fixtures/tables.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { folderFiles, savedFiles, stubFolderPicker, stubSavePicker } from './support/savePicker.ts';

// M4-13 (§7.7, ADR-015, M4-Q5): Convert → Express Extract (Beta) over the
// self-made table fixture — the selected pages, else the current page → an
// XLSX with a sheet per table (merged header cells kept) or CSV files; "No
// tables found" and the OCR note; Cancel.

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

async function open(page: Page): Promise<string> {
  await page.goto('/');
  await drop(page, [{ name: 'tables.pdf', b64: b64(tablesPdf()) }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  return (await cap(page, 'view', 'activeDocId')) as string;
}

async function express(page: Page) {
  await page.getByRole('tab', { name: 'Convert' }).click();
  await page
    .getByRole('toolbar', { name: 'Convert commands' })
    .getByRole('button', { name: 'Express Extract' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Express Extract (Beta)' });
  await expect(dialog).toBeVisible();
  return dialog;
}

interface Last {
  packaging: string;
  files: { path: string; size: number; text: string | null; b64: string | null }[];
}
const last = async (page: Page) => (await cap(page, 'extract', 'lastExport', 'tables')) as Last;

const list = (page: Page) => page.getByRole('listbox', { name: 'Page thumbnails' });
const thumb = (page: Page, label: string) =>
  list(page).getByRole('option', { name: label, exact: true });

test('current page → XLSX: a sheet per table, merged headers kept, numbers as numbers', async ({
  page,
}) => {
  await open(page);
  await stubSavePicker(page);
  const dialog = await express(page);
  await expect(dialog).toContainText('Page 1 (select pages');
  await expect(dialog).toContainText('Beta:');
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  await dialog.getByRole('button', { name: 'Find Tables' }).click();
  await expect(dialog.getByRole('status')).toContainText('2 tables found.', { timeout: 20_000 });
  await dialog.getByRole('button', { name: 'Save…' }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  expect((await savedFiles(page)).map((f) => f.name)).toEqual(['tables tables.xlsx']);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(
    new Uint8Array(Buffer.from((await last(page)).files[0]?.b64 ?? '', 'base64')).buffer,
  );
  expect(wb.worksheets.map((w) => w.name)).toEqual(['p1-t1', 'p1-t2']);
  const [pipe, flange] = wb.worksheets;
  expect((pipe?.model as { merges?: string[] }).merges?.slice().sort()).toEqual([
    'A1:A2',
    'B1:C1',
    'D1:E1',
    'F1:F2',
  ]);
  expect(pipe?.getRow(1).font.bold).toBe(true);
  const text = (ws: ExcelJS.Worksheet | undefined, r: number, c: number) => {
    const v = ws?.getRow(r + 1).getCell(c + 1).value;
    return typeof v === 'number' ? String(v) : typeof v === 'string' ? v : '';
  };
  // Every non-empty expected cell, numbers compared by value.
  for (const [ws, exp] of [
    [pipe, PIPE],
    [flange, FLANGE],
  ] as const)
    exp.cells.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (!cell) return;
        const got = text(ws, r, c);
        if (/^\d+\.\d+$/.test(cell)) expect(Number(got)).toBe(Number(cell));
        else expect(got.replace(/\s+/g, ' ')).toBe(cell.replace(/\s+/g, ' '));
      });
    });
});

test('selected pages → CSV files into a folder; OCR note for the scanned page', async ({
  page,
}) => {
  const id = await open(page);
  await stubFolderPicker(page);
  await thumb(page, '3').click();
  await thumb(page, '4').click({ modifiers: ['ControlOrMeta'] });
  await expect.poll(() => cap(page, 'pages', 'selection', id)).toEqual([2, 3]);
  const dialog = await express(page);
  await expect(dialog).toContainText('Pages 3 and 4.');
  await dialog.getByRole('radio', { name: /CSV/ }).check();
  await dialog.getByRole('button', { name: 'Find Tables' }).click();
  await expect(dialog.getByRole('status')).toContainText('2 tables found.', { timeout: 20_000 });
  await expect(dialog).toContainText('Page 4 has no text layer');
  await expect(dialog).toContainText('The CSV files go into the folder you choose.');
  await dialog.getByRole('button', { name: 'Save…' }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  expect((await folderFiles(page)).map((f) => f.path)).toEqual([
    'tables p3-t1.csv',
    'tables p3-t2.csv',
  ]);
  const csv = (await last(page)).files[0]?.text ?? '';
  // Blob.text() drops the BOM (checked in tests/tables/export-integration.test.ts).
  const rows = csv.trimEnd().split('\r\n');
  expect(rows[0]).toBe(BOLTS.cells[0]?.join(','));
});

test('a page without tables says so and saves nothing', async ({ page }) => {
  const id = await open(page);
  await stubSavePicker(page);
  await thumb(page, '5').click();
  await expect.poll(() => cap(page, 'pages', 'selection', id)).toEqual([4]);
  const dialog = await express(page);
  await dialog.getByRole('button', { name: 'Find Tables' }).click();
  await expect(dialog.getByRole('status')).toContainText('No tables found on these pages.', {
    timeout: 20_000,
  });
  await expect(dialog.getByRole('button', { name: 'Save…' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close' }).first().click();
  await expect(dialog).toBeHidden();
  expect(await savedFiles(page)).toEqual([]);
});

test('Cancel stops the search', async ({ page }) => {
  // 200 pages: the search is still running when Cancel is pressed.
  await page.goto('/');
  await drop(page, [{ name: 'many.pdf', b64: b64(tablesPdf(40)) }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await cap(page, 'extract', 'openExpress', id, [...Array(200).keys()]);
  const dialog = page.getByRole('dialog', { name: 'Express Extract (Beta)' });
  await dialog.getByRole('button', { name: 'Find Tables' }).click();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog.getByRole('button', { name: 'Find Tables' })).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog).not.toContainText('tables found');
});
