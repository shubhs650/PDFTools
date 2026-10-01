import type { Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { encryptedVariants, hasQpdf, USER_PW } from './fixtures/encrypted.ts';
import { markedContractPdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { savedFiles, stubSavePicker } from './support/savePicker.ts';

// M4-08 (§7.6, M4-Q7, ADR-018): Comment → Export Annotations writes every
// comment as CSV (BOM, CRLF), an Excel workbook built in the Work worker, or
// the import-ready JSON v1 (docs/formats/pdftools-annotations-v1.md);
// disabled without the copy permission (rule 9).

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

async function open(page: Page, bytes: Uint8Array): Promise<string> {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name: 'pump.pdf', b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect
    .poll(async () => ((await cap(page, 'annotate', 'list', id)) as unknown[] | null)?.length ?? 0)
    .toBe(50);
  await stubSavePicker(page);
  return id;
}

async function exportAs(page: Page, format: string): Promise<{ name: string; bytes: Buffer }> {
  await page.getByRole('tab', { name: 'Comment' }).click();
  await page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name: 'Export Comments (CSV / XLSX / JSON)' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Export Annotations' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(format).check();
  await dialog.getByRole('button', { name: 'Export' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  const f = (await cap(page, 'annotate', 'lastAnnotationExport')) as {
    name: string;
    b64: string;
  } | null;
  if (!f) throw new Error('no file');
  return { name: f.name, bytes: Buffer.from(f.b64, 'base64') };
}

test('50 comments exported as XLSX, CSV and JSON v1, and read back', async ({ page }) => {
  await open(page, markedContractPdf(10, 5));

  const xlsx = await exportAs(page, 'Excel workbook (.xlsx)');
  expect(xlsx.name).toBe('pump (annotations).xlsx');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(xlsx.bytes).buffer);
  const ws = wb.getWorksheet('Annotations');
  if (!ws) throw new Error('no sheet');
  let head = 0;
  ws.eachRow((row, n) => {
    if (!head && row.getCell(1).value === 'No.') head = n;
  });
  expect(head).toBeGreaterThan(0);
  expect(ws.getRow(head).getCell(3).value).toBe('Type');
  expect(ws.getRow(head).getCell(6).value).toBe('Comment');
  expect(ws.getRow(head + 1).getCell(1).value).toBe(1);
  expect(ws.getRow(head + 1).getCell(3).value).toBe('Rectangle');
  expect(ws.getRow(head + 1).getCell(6).value).toBe('Comment m-0-0');
  expect(ws.getRow(head + 50).getCell(1).value).toBe(50);
  expect(ws.getImages()).toHaveLength(0);

  const csv = await exportAs(page, 'CSV (.csv)');
  expect(csv.name).toBe('pump (annotations).csv');
  expect([...csv.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const lines = csv.bytes.subarray(3).toString('utf8').split('\r\n');
  expect(lines[0]).toBe('No.,Page,Type,Author,Subject,Comment,Replies,Status,Created,Modified');
  expect(lines.filter((l) => /^\d+,\d+,Rectangle,/u.test(l))).toHaveLength(50);

  const json = await exportAs(page, 'JSON (.json) — can be imported again');
  expect(json.name).toBe('pump (annotations).json');
  const doc = JSON.parse(json.bytes.toString('utf8')) as {
    format: string;
    version: number;
    annotations: {
      number: number;
      page: number;
      type: string;
      contents: string;
      annotation: { rect: unknown };
    }[];
  };
  expect(doc.format).toBe('pdftools-annotations');
  expect(doc.version).toBe(1);
  expect(doc.annotations).toHaveLength(50);
  expect(doc.annotations[0]).toMatchObject({ number: 1, page: 1, type: 'square' });
  expect(doc.annotations[0]?.contents).toBe('Comment m-0-0');
  expect(doc.annotations[0]?.annotation.rect).toBeTruthy();
  expect(await savedFiles(page)).toHaveLength(3);
});

test('without the copy permission Export Annotations is disabled', async ({ page }) => {
  test.skip(!hasQpdf(), 'qpdf is needed to make the encrypted fixture');
  const v = encryptedVariants(markedContractPdf(2, 1)).find((x) => x.name === 'R6-aes-256');
  if (!v) throw new Error('fixture');
  await page.goto('/');
  await drop(page, [{ name: 'locked.pdf', b64: b64(v.bytes) }]);
  const pw = page.getByRole('dialog', { name: 'Password required' });
  await pw.getByLabel('Password').fill(USER_PW);
  await pw.getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  await page.getByRole('tab', { name: 'Comment' }).click();
  await expect(
    page
      .getByRole('toolbar', { name: 'Comment commands' })
      .getByRole('button', { name: 'Export Comments (CSV / XLSX / JSON)' }),
  ).toBeDisabled();
});
