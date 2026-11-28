import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { A, B, templateA, templateB } from './fixtures/crsTemplates.ts';
import { crsCorpusFile } from './fixtures/crs-review/index.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M13-07 (D-71): the CRS review corpus — self-made review copies with
// comments of every kind (Synthetic PDF Corpus/crs_review_corpus) — exported
// into the project templates through the real Work worker. Every comment gets
// its row, type, status and replies, and every row its snapshot. Set CRS_OUT
// to a folder to keep the files for a look in a spreadsheet program.

const OUT = process.env.CRS_OUT;

async function open(page: Page, name: string): Promise<string> {
  const before = (await cap(page, 'view', 'activeDocId')) as string | null;
  await drop(page, [{ name, b64: Buffer.from(crsCorpusFile(name)).toString('base64') }]);
  await expect.poll(() => cap(page, 'view', 'activeDocId')).not.toBe(before);
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect
    .poll(async () => ((await cap(page, 'annotate', 'list', id)) as unknown[] | null)?.length ?? 0)
    .toBeGreaterThan(0);
  return id;
}

/** What the export dialog would hold for each document (by document id once open). */
const DETAILS: Record<string, Record<string, string>> = {};
const SET_DETAILS = {
  docNumber: 'S-101 to S-104',
  revision: 'B',
  title: 'Pump house steel framing plans',
  reviewer: 'R. Mehta',
  reviewDate: '24/11/2026',
};
const SPEC_DETAILS = {
  docNumber: 'PS-1200-ME-SPC-0007',
  revision: 'B',
  title: 'Centrifugal pump specification',
  reviewer: 'A. Iyer',
  reviewDate: '24/11/2026',
};

interface ExportResult {
  b64?: string;
  names?: string[];
  error?: string;
}

/** Template A with every field it has a column for. */
const settingsA = (sheetPerPage: boolean) => ({
  sheet: A.sheet,
  startRow: A.startRow,
  lastPreDrawn: null,
  details: { docNumber: 'C4', revision: 'G4', title: 'C5', reviewer: 'C6', reviewDate: 'G6' },
  fileNameRule: '',
  columns: [
    { field: 'srNo', col: A.cols.srNo, on: true },
    { field: 'pageLabel', col: A.cols.page, on: true },
    { field: 'type', col: A.cols.type, on: true },
    { field: 'discipline', col: A.cols.discipline, on: true },
    { field: 'text', col: A.cols.text, on: true },
    { field: 'snapshot', col: A.cols.snapshot, on: true },
    { field: 'author', col: A.cols.author, on: true },
    { field: 'created', col: A.cols.date, on: true },
    { field: 'status', col: A.cols.status, on: true },
    { field: 'allReplies', col: A.cols.reply, on: true },
  ],
  status: {
    accepted: 'Closed',
    completed: 'Closed',
    rejected: 'Open',
    cancelled: 'Closed',
    none: 'Open',
  },
  snapshotMaxPx: 160,
  sheetPerPage,
});

const settingsB = {
  sheet: B.sheet,
  startRow: B.startRow,
  lastPreDrawn: null,
  details: { docNumber: B.details.docNo, revision: B.details.rev },
  fileNameRule: '',
  columns: [
    { field: 'srNo', col: B.cols.srNo, on: true },
    { field: 'page', col: B.cols.page, on: true },
    { field: 'text', col: B.cols.text, on: true },
    { field: 'author', col: B.cols.author, on: true },
    { field: 'status', col: B.cols.status, on: true },
    { field: 'lastReply', col: B.cols.reply, on: true },
    { field: 'snapshot', col: B.cols.snapshot, on: true },
  ],
  status: {},
  snapshotMaxPx: 120,
  sheetPerPage: false,
};

interface Options {
  scope: 'all';
  ignoreHighlights: boolean;
  snapshots: boolean;
  format: 'xlsx';
  /** M14-08 (Q34): off by default; on here, so the corpus's distance measurement is a row. */
  measurements: boolean;
}
const xlsx: Options = {
  scope: 'all',
  ignoreHighlights: true,
  snapshots: true,
  format: 'xlsx',
  measurements: true,
};

async function exported(
  page: Page,
  ids: string[],
  tpl: string,
  settings: unknown,
  o: Options,
  keep: string,
): Promise<ExcelJS.Workbook> {
  const r = (await cap(
    page,
    'annotate',
    'crsTemplateExport',
    ids,
    tpl,
    settings,
    o,
  )) as ExportResult;
  if (!r.b64) throw new Error(`no file: ${r.error ?? ''}`);
  const bytes = Buffer.from(r.b64, 'base64');
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, keep), bytes);
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(bytes).buffer);
  return wb;
}

/** The filled rows of a sheet: column values by field, from the start row down. */
function rowsOf(ws: ExcelJS.Worksheet, start: number, cols: Record<string, number>) {
  const out: Record<string, unknown>[] = [];
  for (let r = start; ; r++) {
    if (ws.getCell(r, cols.srNo ?? 1).value === null) break;
    const row: Record<string, unknown> = { row: r };
    for (const [k, c] of Object.entries(cols)) row[k] = ws.getCell(r, c).value;
    out.push(row);
  }
  return out;
}

const shotRows = (ws: ExcelJS.Worksheet, col: number) =>
  ws
    .getImages()
    .filter((im) => im.range.tl.nativeCol === col - 1)
    .map((im) => im.range.tl.nativeRow + 1)
    .sort((x, y) => x - y);

test('the review corpus fills the project templates: every comment kind, status, reply and snapshot', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const set = await open(page, 'crs_01_steel_drawing_set_review.pdf');
  const spec = await open(page, 'crs_02_pump_specification_review.pdf');
  DETAILS[set] = SET_DETAILS;
  DETAILS[spec] = SPEC_DETAILS;
  const tplA = Buffer.from(await templateA(ExcelJS)).toString('base64');
  const tplB = Buffer.from(await templateB(ExcelJS)).toString('base64');

  const wb = await exported(
    page,
    [set],
    tplA,
    settingsA(true),
    xlsx,
    'crs_01 into template A (sheet per page).xlsx',
  );
  // Sheets by page label; S-103 has no comments.
  expect(wb.worksheets.map((w) => w.name)).toEqual(['S-101', 'S-102', 'S-104', 'Lists', 'Notes']);
  const sheet = (name: string) => {
    const ws = wb.getWorksheet(name);
    if (!ws) throw new Error(name);
    return ws;
  };
  const s101 = rowsOf(sheet('S-101'), A.startRow, A.cols);
  // 18 comments on S-101 less the three see-through check highlights.
  expect(s101).toHaveLength(15);
  // A review sheet's names for the kinds: arrows, clouds, callouts, typewriter text.
  expect(s101.map((r) => r.type)).toEqual(
    expect.arrayContaining([
      'Arrow',
      'Cloud',
      'Callout',
      'Typewriter text',
      'Note',
      'Rectangle',
      'Oval',
      'Polygon',
      'Polyline',
      'Pencil drawing',
      'Stamp',
      'Length measurement',
    ]),
  );
  const byText = (rows: Record<string, unknown>[], start: string) => {
    const r = rows.find((x) => String(x.text).startsWith(start));
    if (!r) throw new Error(start);
    return r;
  };
  expect(byText(s101, 'Beam B/2-3')).toMatchObject({ type: 'Cloud', status: 'Closed' });
  expect(byText(s101, 'Column missing')).toMatchObject({ type: 'Arrow', status: 'Open' });
  expect(String(byText(s101, 'Column missing').reply)).toContain('S. Kulkarni');
  expect(byText(s101, 'Base plate: Ø24 holes, tolerance ±2 mm').reply).toBe(
    'S. Kulkarni (Nov 6, 2026): Civil confirms 120 mm projection.\n  A. Iyer (Nov 6, 2026): Thanks, please add it to note 2.',
  );
  expect(byText(s101, 'Who approved').author).toBe('an unknown author');
  // Every row has its own snapshot, the turned sheet's too.
  for (const name of ['S-101', 'S-102', 'S-104']) {
    const ws = sheet(name);
    const rows = rowsOf(ws, A.startRow, A.cols).map((r) => r.row);
    expect(shotRows(ws, A.cols.snapshot)).toEqual(rows);
  }
  const media = new Set(
    sheet('S-104')
      .getImages()
      .filter((im) => im.range.tl.nativeCol === A.cols.snapshot - 1)
      .map((im) => im.imageId),
  );
  expect(media.size).toBe(4);

  // Both documents, a sheet each; the specification's text markups.
  const both = await exported(
    page,
    [set, spec],
    tplA,
    settingsA(false),
    xlsx,
    'crs_01 and crs_02 into template A (sheet per document).xlsx',
  );
  // Sheet names: the file names cut to Excel's 31 characters.
  expect(both.worksheets.map((w) => w.name).slice(0, 2)).toEqual([
    'crs_01_steel_drawing_set_review',
    'crs_02_pump_specification_revie',
  ]);
  const pump = both.getWorksheet('crs_02_pump_specification_revie');
  if (!pump) throw new Error('no pump sheet');
  const specRows = rowsOf(pump, A.startRow, A.cols);
  // 14 comments less one check highlight.
  expect(specRows).toHaveLength(13);
  expect(specRows.map((r) => r.type)).toEqual(
    expect.arrayContaining([
      'Highlight',
      'Underline',
      'Strikeout',
      'Inserted text',
      'Squiggly underline',
      'Callout',
      'Text box',
      'Stamp',
    ]),
  );
  expect(byText(specRows, 'dual')).toMatchObject({ type: 'Inserted text' });
  // No page labels: the page number.
  expect(byText(specRows, 'Design pressure').page).toBe('2');

  // Highlights kept: the check highlight is a row too.
  const keep = await exported(
    page,
    [spec],
    tplB,
    settingsB,
    { ...xlsx, ignoreHighlights: false },
    'crs_02 into template B (highlights kept).xlsx',
  );
  const ws = keep.getWorksheet(B.sheet);
  if (!ws) throw new Error('no sheet');
  expect(rowsOf(ws, B.startRow, B.cols)).toHaveLength(14);
});
