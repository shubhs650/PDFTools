import type { Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { markedContractPdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { savedFiles, stubSavePicker } from './support/savePicker.ts';

// M3-19 (D-15, §7.5, ADR-015): Comment → Export CRS builds the sheet in the
// Work worker — XLSX with the header block, the §7.5 columns and a snapshot per
// row, or CSV (BOM, no images) — with progress and Cancel.

async function open(page: Page, bytes: Uint8Array): Promise<string> {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name: 'pump.pdf', b64: Buffer.from(bytes).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect
    .poll(async () => ((await cap(page, 'annotate', 'list', id)) as unknown[] | null)?.length ?? 0)
    .toBeGreaterThan(0);
  await stubSavePicker(page);
  return id;
}

async function exportDialog(page: Page) {
  await page.getByRole('tab', { name: 'Comment' }).click();
  await page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name: 'Export CRS' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Export Comment Review Sheet' });
  await expect(dialog).toBeVisible();
  return dialog;
}

const lastFile = async (page: Page) => {
  const f = (await cap(page, 'annotate', 'lastCrs')) as { name: string; b64: string } | null;
  return f ? { name: f.name, bytes: Buffer.from(f.b64, 'base64') } : null;
};

test('50 comments to XLSX: header block, columns, one snapshot per row; and to CSV', async ({
  page,
}) => {
  await open(page, markedContractPdf(10, 5));
  const dialog = await exportDialog(page);
  // Prefilled: the reviewer from the profile, the title from the file name.
  await expect(dialog.getByLabel('Reviewer')).toHaveValue('Ana de Vries');
  await dialog.getByLabel('Document number').fill('DOC-001');
  await dialog.getByLabel('Revision').fill('B');
  await dialog.getByRole('button', { name: 'Export' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  expect(await savedFiles(page)).toEqual([
    expect.objectContaining({ name: 'pump (CRS).xlsx' }) as unknown,
  ]);

  const file = await lastFile(page);
  if (!file) throw new Error('no file');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(file.bytes).buffer);
  const ws = wb.getWorksheet('CRS');
  if (!ws) throw new Error('no sheet');
  expect(ws.getCell('A1').text).toContain('Comment Review Sheet');
  expect(ws.getCell('B2').value).toBe('DOC-001');
  expect(ws.getCell('B3').value).toBe('B');
  expect(ws.getCell('B5').value).toBe('Ana de Vries');
  const head = ws.getRow(9);
  expect(head.getCell(1).value).toBe('No.');
  expect(head.getCell(9).value).toBe('Snapshot');
  expect(head.getCell(11).value).toBe('Final Status');
  expect(ws.getCell('A10').value).toBe(1);
  expect(ws.getCell('C10').value).toBe('Rectangle');
  expect(ws.getCell('F10').value).toBe('Comment m-0-0');
  expect(ws.getCell('A59').value).toBe(50);
  expect(ws.getImages()).toHaveLength(50);

  // CSV: BOM, the same rows, no images.
  const again = await exportDialog(page);
  await again.getByLabel('CSV (.csv, no snapshots)').check();
  await expect(again.getByLabel('Include a snapshot of each markup')).toBeDisabled();
  await again.getByRole('button', { name: 'Export' }).click();
  await expect(again).toBeHidden();
  const csv = await lastFile(page);
  if (!csv) throw new Error('no csv');
  expect(csv.name).toBe('pump (CRS).csv');
  expect([...csv.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const text = csv.bytes.subarray(3).toString('utf8');
  const lines = text.split('\r\n');
  expect(lines[0]).toBe('Document number,DOC-001');
  expect(lines).toContain(
    'No.,Page,Location/Type,Reviewer,Discipline,Comment,Replies,Status,Vendor Response,Final Status',
  );
  expect(lines.filter((l) => /^\d+,\d+,Rectangle,/u.test(l))).toHaveLength(50);
});

test('a large export shows progress and can be cancelled', async ({ page }) => {
  await open(page, markedContractPdf(200, 5));
  const dialog = await exportDialog(page);
  await dialog.getByRole('button', { name: 'Export' }).click();
  await expect(dialog.getByRole('status')).toHaveText(/Row \d+ of 1,000/, { timeout: 20_000 });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog.getByRole('button', { name: 'Export' })).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(await savedFiles(page)).toEqual([]);
  expect(await lastFile(page)).toBeNull();
});
