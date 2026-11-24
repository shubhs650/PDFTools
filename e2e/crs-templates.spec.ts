import type { Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { A, templateA } from './fixtures/crsTemplates.ts';
import { markedContractPdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M13-07 (D-71, plan M13 §6): Export CRS into a project template through the
// real Work worker — page labels read from the PDF, one sheet per commented
// page or per document, snapshots in the Snapshot column, progress and
// Cancel, CSV; and a template kept on the device, written as a template file
// and imported again. The screens come in M13-08; this drives the engine
// through the test hook. The template is made by script (rule 13).

async function open(page: Page, name: string, bytes: Uint8Array): Promise<string> {
  const before = (await cap(page, 'view', 'activeDocId')) as string | null;
  await drop(page, [{ name, b64: Buffer.from(bytes).toString('base64') }]);
  await expect.poll(() => cap(page, 'view', 'activeDocId')).not.toBe(before);
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect
    .poll(async () => ((await cap(page, 'annotate', 'list', id)) as unknown[] | null)?.length ?? 0)
    .toBeGreaterThan(0);
  return id;
}

/** Template A's set-up: the fields on its columns, the detail cells, sheet per page. */
const settings = (sheetPerPage: boolean) => ({
  sheet: A.sheet,
  startRow: A.startRow,
  lastPreDrawn: null,
  details: { docNumber: 'C4', revision: 'G4', title: 'C5', reviewer: 'C6', reviewDate: 'G6' },
  fileNameRule: '',
  columns: [
    { field: 'srNo', col: A.cols.srNo, on: true },
    { field: 'pageLabel', col: A.cols.page, on: true },
    { field: 'type', col: A.cols.type, on: true },
    { field: 'text', col: A.cols.text, on: true },
    { field: 'snapshot', col: A.cols.snapshot, on: true },
    { field: 'author', col: A.cols.author, on: true },
    { field: 'created', col: A.cols.date, on: true },
    { field: 'fixed', col: A.cols.status, on: true, text: 'Open' },
  ],
  status: {},
  snapshotMaxPx: 160,
  sheetPerPage,
});

const xlsx = { scope: 'all', ignoreHighlights: true, snapshots: true, format: 'xlsx' } as const;

interface ExportResult {
  b64?: string;
  names?: string[];
  reports: number;
  error?: string;
}

async function workbook(r: ExportResult): Promise<ExcelJS.Workbook> {
  if (!r.b64) throw new Error(`no file: ${r.error ?? ''}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(Buffer.from(r.b64, 'base64')).buffer);
  return wb;
}

test('fills a project template in the Work worker: a sheet per labelled page, snapshots, Cancel @smoke', async ({
  page,
}) => {
  await page.goto('/');
  const id = await open(page, 'pump.pdf', markedContractPdf(4, 5, true));
  const tpl = Buffer.from(await templateA(ExcelJS)).toString('base64');

  const r = (await cap(
    page,
    'annotate',
    'crsTemplateExport',
    [id],
    tpl,
    settings(true),
    xlsx,
  )) as ExportResult;
  // Page labels from the PDF name the sheets (C5).
  expect(r.names).toEqual(['A-101', 'A-102', 'A-103', 'A-104']);
  expect(r.reports).toBeGreaterThan(1);
  const wb = await workbook(r);
  expect(wb.worksheets.map((w) => w.name)).toEqual([
    'A-101',
    'A-102',
    'A-103',
    'A-104',
    'Lists',
    'Notes',
  ]);
  const ws = wb.getWorksheet('A-102');
  if (!ws) throw new Error('no sheet');
  // Five comments per page, Sr. No. from 1 on every sheet (C6), top to bottom (C12).
  expect([10, 11, 12, 13, 14].map((r) => ws.getCell(r, A.cols.srNo).value)).toEqual([
    1, 2, 3, 4, 5,
  ]);
  expect(ws.getCell(10, A.cols.text).value).toBe('Comment m-1-0');
  expect(ws.getCell(14, A.cols.text).value).toBe('Comment m-1-4');
  expect(ws.getCell(10, A.cols.page).value).toBe('A-102');
  expect(ws.getCell(10, A.cols.status).value).toBe('Open');
  expect(ws.getCell(10, A.cols.author).value).toBe('Reviewer 0');
  expect((ws.getCell(10, A.cols.date).value as Date).getUTCFullYear()).toBe(2026);
  expect(ws.getCell('C4').value).toBe('PA-1200-ME-DWG-0042');
  expect(ws.getCell('G4').value).toBe('B');
  // One snapshot per row, in the Snapshot column (the logo and sign-off mark are the others).
  const shots = ws.getImages().filter((im) => im.range.tl.nativeCol === A.cols.snapshot - 1);
  expect(shots.map((im) => im.range.tl.nativeRow + 1)).toEqual([10, 11, 12, 13, 14]);
  // The totals still count the table (formulas are worked out on opening).
  expect(ws.getCell('K4').formula).toBe('COUNTA(E10:E24)');

  // Cancel at the first progress report of a long export: the job stops (rule 2).
  const big = await open(page, 'contract.pdf', markedContractPdf(60, 5));
  const cancelled = (await cap(
    page,
    'annotate',
    'crsTemplateExport',
    [big],
    tpl,
    settings(false),
    xlsx,
    1,
  )) as ExportResult;
  expect(['aborted', 'AbortError']).toContain(cancelled.error);
  expect(cancelled.b64).toBeUndefined();
});

test('several documents get a sheet each (C15); CSV has the same columns', async ({ page }) => {
  await page.goto('/');
  const pump = await open(page, 'pump.pdf', markedContractPdf(2, 3, true));
  const valve = await open(page, 'valve.pdf', markedContractPdf(3, 2));
  const tpl = Buffer.from(await templateA(ExcelJS)).toString('base64');

  const r = (await cap(page, 'annotate', 'crsTemplateExport', [pump, valve], tpl, settings(false), {
    ...xlsx,
    snapshots: false,
  })) as ExportResult;
  expect(r.names).toEqual(['pump', 'valve']);
  const wb = await workbook(r);
  expect(wb.getWorksheet('pump')?.getCell(15, A.cols.srNo).value).toBe(6);
  expect(wb.getWorksheet('pump')?.getCell(15, A.cols.page).value).toBe('A-102');
  // No page labels: the page number.
  expect(wb.getWorksheet('valve')?.getCell(15, A.cols.page).value).toBe('3');
  expect(wb.getWorksheet('valve')?.getCell(16, A.cols.srNo).value).toBeNull();

  const csv = (await cap(page, 'annotate', 'crsTemplateExport', [pump], tpl, settings(false), {
    ...xlsx,
    format: 'csv',
  })) as ExportResult;
  const text = Buffer.from(csv.b64 ?? '', 'base64').toString('utf8');
  expect(text.startsWith('﻿')).toBe(true);
  expect(text).toContain(
    'Sr. No.,Page label,Comment type,Comment text,Author,Date created,Fixed text',
  );
  expect(text).not.toContain('Snapshot');
});

test('a template kept on the device, written as a template file and imported again (C14)', async ({
  page,
}) => {
  await page.goto('/');
  const tpl = Buffer.from(await templateA(ExcelJS)).toString('base64');
  const r = (await cap(page, 'annotate', 'crsTemplateRoundTrip', tpl, settings(true))) as {
    inspection: { ok: boolean; kind: string; lastPreDrawn: number; lost: string[] };
    fileName: string;
    names: string[];
    same: boolean;
    bad: { ok: boolean; reason?: string };
  };
  expect(r.inspection).toMatchObject({ ok: true, kind: 'xlsx', lastPreDrawn: 24, lost: [] });
  expect(r.fileName).toBe('Project CRS (CRS template).json');
  expect(r.names).toEqual(['Project CRS', 'Project CRS (2)']);
  expect(r.same).toBe(true);
  expect(r.bad).toEqual({ ok: false, reason: 'not-template' });
});
