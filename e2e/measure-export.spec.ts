import AxeBuilder from '@axe-core/playwright';
import ExcelJS from 'exceljs';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { simplePdf } from './fixtures/generate.ts';
import { cap, darkTheme, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { savedFiles, stubSavePicker } from './support/savePicker.ts';

// M14-10 (D-76, ADR-035, plan M14 §10): Export measurements from the
// Measurements pane — the Excel workbook (measurements and totals sheets, real
// numbers, pictures) and CSV, with progress; Attach to this PDF (replaces the
// earlier copy, out-of-date note and Refresh, listed in Attachments); Place
// summary (one table markup kept up to date, in the same undo step); axe light
// and dark; screenshots.

interface Obj {
  id: string;
  type: number;
  contents?: string;
  rect: { origin: { x: number; y: number }; size: { width: number; height: number } };
}

const T = { LINE: 4, FREETEXT: 3, POLYGON: 7 };
const MM = 72 / 25.4;
const H = 842; // simplePdf is A4: user y → EmbedPDF y = H - y
const SHOTS = '/mnt/project-files/M14-10';

const measureTab = (page: Page) => page.getByRole('toolbar', { name: 'Measure commands' });
const pane = (page: Page) => page.getByTestId('measurements-pane');
const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];
const axe = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );

test.use({ deviceScaleFactor: 2 });

async function shot(page: Page, name: string) {
  await page.waitForTimeout(500);
  try {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
  } catch {
    await page.screenshot({ path: `test-results/M14-10/${name}.png` });
  }
}

async function open(page: Page, o: { dark?: boolean } = {}) {
  await page.setViewportSize({ width: 1366, height: 800 });
  if (o.dark) await darkTheme(page);
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  const b64 = Buffer.from(simplePdf(1)).toString('base64');
  await drop(page, [{ name: 'sheet.pdf', b64 }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await stubSavePicker(page);
  await page.getByRole('tab', { name: 'Measure', exact: true }).click();
  return id;
}

async function setScale(page: Page) {
  await measureTab(page).getByRole('button', { name: 'Set Scale' }).click();
  const dialog = page.getByRole('dialog', { name: 'Set scale' });
  await dialog.getByLabel('Real').fill('100');
  await dialog.getByLabel('Units').selectOption({ label: 'Metres' });
  await dialog.getByLabel('Decimal places').selectOption({ value: '2' });
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toBeHidden();
}

async function at(page: Page, x: number, y: number) {
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  const s = box.width / 595;
  return { x: box.x + x * s, y: box.y + y * s };
}

async function clicks(page: Page, pts: [number, number][]) {
  for (const p of pts) {
    const s = await at(page, ...p);
    await page.mouse.move(s.x, s.y, { steps: 3 });
    await page.mouse.click(s.x, s.y);
  }
}

async function tool(page: Page, name: string) {
  await measureTab(page).getByRole('button', { name, exact: true }).click();
}

async function newest(page: Page, id: string, type: number, before: Set<string>) {
  let m: Obj | undefined;
  await expect
    .poll(async () => {
      m = (await objects(page, id)).find(
        (o) => o.type === type && !before.has(o.id) && !!o.contents,
      );
      return m?.id ?? null;
    })
    .not.toBeNull();
  if (!m) throw new Error('no measurement');
  return m.id;
}

/** A Length set to user-space points a → b (exact values, whatever the clicks were). */
async function length(page: Page, id: string, a: [number, number], b: [number, number]) {
  const before = new Set((await objects(page, id)).map((o) => o.id));
  await tool(page, 'Length');
  await clicks(page, [
    [100, 150],
    [200, 150],
  ]);
  await page.keyboard.press('Enter');
  const m = await newest(page, id, T.LINE, before);
  await page.keyboard.press('Escape');
  await cap(page, 'annotate', 'update', id, 0, m, {
    linePoints: { start: { x: a[0], y: H - a[1] }, end: { x: b[0], y: H - b[1] } },
  });
  return m;
}

/** An Area set to a w × h mm (paper) rectangle at user-space x, y. */
async function area(page: Page, id: string, x: number, y: number, w: number, h: number) {
  const before = new Set((await objects(page, id)).map((o) => o.id));
  await tool(page, 'Area');
  await clicks(page, [
    [330, 60],
    [480, 60],
    [480, 180],
  ]);
  await page.keyboard.press('Enter');
  const m = await newest(page, id, T.POLYGON, before);
  await page.keyboard.press('Escape');
  const pts = [
    [x, y],
    [x + w * MM, y],
    [x + w * MM, y + h * MM],
    [x, y + h * MM],
  ].map(([px = 0, py = 0]) => ({ x: px, y: H - py }));
  await cap(page, 'annotate', 'update', id, 0, m, { vertices: pts });
  return m;
}

async function openPane(page: Page) {
  if (await pane(page).isVisible()) return;
  await page.locator('[data-rail="rail.measurements"] button').click();
  await expect(pane(page)).toBeVisible();
}

const valueOf = async (page: Page, id: string, annot: string) =>
  (await objects(page, id)).find((o) => o.id === annot)?.contents ?? null;

/** Three measurements at 1:100: 2.00 m and 1.50 m of Length, 50.00 m² of Area. */
async function measured(page: Page, id: string) {
  await setScale(page);
  const a = await length(page, id, [60, 120], [60 + 20 * MM, 120]);
  const b = await length(page, id, [60, 300], [60 + 15 * MM, 300]);
  const c = await area(page, id, 300, 400, 100, 50);
  await expect.poll(() => valueOf(page, id, a)).toBe('2.00 m');
  await expect.poll(() => valueOf(page, id, b)).toBe('1.50 m');
  await expect.poll(() => valueOf(page, id, c)).toBe('50.00 m²');
  await openPane(page);
  return { a, b, c };
}

const lastExport = async (page: Page) => {
  const f = (await cap(page, 'annotate', 'lastMeasureExport')) as {
    name: string;
    attached: boolean;
    b64: string;
  } | null;
  return f ? { ...f, bytes: Buffer.from(f.b64, 'base64') } : null;
};

async function exportDialog(page: Page) {
  await pane(page).getByRole('button', { name: 'Export…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export measurements' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('Excel: measurements and totals sheets with real numbers and pictures; CSV @smoke', async ({
  page,
}) => {
  const id = await open(page);
  await measured(page, id);
  const dialog = await exportDialog(page);
  await expect(dialog.getByLabel('All pages')).toBeChecked();
  await expect(dialog.getByLabel('Excel workbook (.xlsx)')).toBeChecked();
  await dialog.getByLabel('Include pictures').check();
  await shot(page, '01-export-dialog-light');
  expect(await axe(page)).toEqual([]);
  await dialog.getByRole('button', { name: 'Export' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  expect(await savedFiles(page)).toEqual([
    expect.objectContaining({ name: 'sheet (Measurements).xlsx' }) as unknown,
  ]);
  const file = await lastExport(page);
  if (!file) throw new Error('no file');
  try {
    mkdirSync(SHOTS, { recursive: true });
    writeFileSync(`${SHOTS}/sample-measurements.xlsx`, file.bytes);
  } catch {
    // The sample for the owner is optional outside the project folder.
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(file.bytes).buffer);
  expect(wb.worksheets.map((w) => w.name)).toEqual(['Measurements', 'Totals']);
  const ws = wb.getWorksheet('Measurements');
  if (!ws) throw new Error('no sheet');
  expect(ws.getCell('A1').value).toBe('Measurements: sheet.pdf');
  expect(ws.getRow(3).values).toEqual([
    undefined,
    'No.',
    'Page',
    'Scale area',
    'Tool',
    'Group or label',
    'Value',
    'Unit',
    'Depth',
    'Scale',
    'Author',
    'Date',
    'Picture',
  ]);
  // Length rows first (top to bottom), then the Area: real numbers with their decimals.
  expect(ws.getRow(4).getCell(4).value).toBe('Length');
  expect(ws.getRow(4).getCell(6).value).toBeCloseTo(1.5, 6);
  expect(ws.getRow(4).getCell(6).numFmt).toBe('0.00');
  expect(ws.getRow(4).getCell(7).value).toBe('m');
  expect(ws.getRow(4).getCell(3).value).toBe('Page');
  expect(ws.getRow(4).getCell(9).value).toBe('1 : 100');
  expect(ws.getRow(4).getCell(10).value).toBe('Ana de Vries');
  expect(ws.getRow(6).getCell(4).value).toBe('Area');
  expect(ws.getRow(6).getCell(6).value).toBeCloseTo(50, 6);
  expect(ws.getRow(6).getCell(7).value).toBe('m²');
  expect(ws.getImages()).toHaveLength(3);
  const totals = wb.getWorksheet('Totals');
  expect(totals?.getRow(4).getCell(1).value).toBe('Length');
  expect(totals?.getRow(4).getCell(2).value).toBe(2);
  expect(totals?.getRow(4).getCell(3).value).toBeCloseTo(3.5, 6);
  expect(totals?.getRow(5).getCell(1).value).toBe('Area');

  // CSV: the rows only; pictures stay remembered for the next Excel export.
  const again = await exportDialog(page);
  await expect(again.getByLabel('Include pictures')).toBeChecked();
  await again.getByLabel('CSV, the measurements only (.csv)').check();
  await expect(again.getByLabel('Include pictures')).toBeDisabled();
  await expect(again.getByLabel('Attach to this PDF')).toBeDisabled();
  await again.getByLabel('This page (page 1)').check();
  await again.getByRole('button', { name: 'Export' }).click();
  await expect(again).toBeHidden({ timeout: 30_000 });
  const csv = await lastExport(page);
  const text = csv?.bytes.toString('utf8') ?? '';
  expect(csv?.name).toBe('sheet (Measurements).csv');
  const lines = text
    .replace(/^\uFEFF/u, '')
    .trim()
    .split('\r\n');
  expect(lines[0]).toBe(
    'No.,Page,Scale area,Tool,Group or label,Value,Unit,Depth,Scale,Author,Date',
  );
  expect(lines).toHaveLength(4);
  expect(lines[1]).toMatch(
    /^1,1,Page,Length,,1\.50,m,,1 : 100,Ana de Vries,\d{4}-\d\d-\d\d \d\d:\d\d$/u,
  );
  expect(lines[3]).toContain(',Area,,50.00,m²,');
});

test('Attach to this PDF: replaces, flags out of date, Refresh; listed in Attachments', async ({
  page,
}) => {
  const id = await open(page);
  const { a } = await measured(page, id);
  const dialog = await exportDialog(page);
  await dialog.getByLabel('Save as a file').uncheck();
  await dialog.getByLabel('Attach to this PDF').check();
  await dialog.getByRole('button', { name: 'Export' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  expect(await savedFiles(page)).toEqual([]);
  expect((await lastExport(page))?.attached).toBe(true);
  const note = page.getByTestId('measure-attached');
  await expect(note).toHaveText(/Attached to this PDF as sheet \(Measurements\)\.xlsx\./u);
  await expect
    .poll(async () => ((await cap(page, 'save', 'state', id)) as { untracked: boolean }).untracked)
    .toBe(true);

  // A measurement changes: the attached copy is out of date until Refresh (never by Ctrl+S).
  await cap(page, 'annotate', 'update', id, 0, a, {
    linePoints: { start: { x: 60, y: H - 120 }, end: { x: 60 + 30 * MM, y: H - 120 } },
  });
  await expect.poll(() => valueOf(page, id, a)).toBe('3.00 m');
  await expect(note).toHaveText(
    /The attached export sheet \(Measurements\)\.xlsx is out of date\./u,
  );
  await shot(page, '02-attached-out-of-date-light');
  expect(await axe(page)).toEqual([]);
  await note.getByRole('button', { name: 'Refresh' }).click();
  await expect(note).toHaveText(/Attached to this PDF as sheet \(Measurements\)\.xlsx\./u, {
    timeout: 30_000,
  });

  // Attaching again replaced the copy: one attachment in the Attachments pane.
  await page.locator('[data-rail="rail.attachments"] button').click();
  const list = page.getByRole('list', { name: 'Embedded files' });
  await expect(list).toContainText('sheet (Measurements).xlsx');
  await expect(list.getByText('sheet (Measurements).xlsx')).toHaveCount(1);
});

test('Place summary: one table markup kept up to date in the same undo step', async ({ page }) => {
  const id = await open(page);
  const { b } = await measured(page, id);
  await pane(page).getByRole('button', { name: 'Place summary' }).click();
  let summary: Obj | undefined;
  await expect
    .poll(async () => {
      summary = (await objects(page, id)).find(
        (o) => o.type === T.FREETEXT && (o.contents ?? '').startsWith('Measurements'),
      );
      return summary?.contents ?? null;
    })
    .toBe('Measurements, all pages\tCount\tTotal\nLength\t2\t3.50 m\nArea\t1\t50.00 m²');
  if (!summary) throw new Error('no summary');
  const sid = summary.id;
  await expect.poll(() => cap(page, 'annotate', 'selected', id)).toEqual([sid]);
  // Drawn at once, before the plugin has its appearance image.
  await expect(page.locator('[data-measure-summary] .measure-summary-preview')).toContainText(
    'Measurements, all pages',
  );
  await cap(page, 'view', 'zoom', 1);
  await shot(page, '03-summary-placed-light');

  // A measurement changes: the summary follows, and one Undo takes both back.
  await cap(page, 'annotate', 'update', id, 0, b, {
    linePoints: { start: { x: 60, y: H - 300 }, end: { x: 60 + 25 * MM, y: H - 300 } },
  });
  await expect.poll(() => valueOf(page, id, sid)).toContain('Length\t2\t4.50 m');
  await cap(page, 'annotate', 'undo', id);
  await expect.poll(() => valueOf(page, id, b)).toBe('1.50 m');
  await expect.poll(() => valueOf(page, id, sid)).toContain('Length\t2\t3.50 m');
  await cap(page, 'annotate', 'redo', id);
  await expect.poll(() => valueOf(page, id, sid)).toContain('Length\t2\t4.50 m');

  // Placing again on the same page keeps the one summary.
  await pane(page).getByRole('button', { name: 'Place summary' }).click();
  await expect
    .poll(
      async () =>
        (await objects(page, id)).filter((o) => (o.contents ?? '').startsWith('Measurements'))
          .length,
    )
    .toBe(1);

  // Deleting a measurement drops its row from the summary.
  await cap(page, 'annotate', 'select', id, 0, b);
  await page.getByTestId('document-view').press('Delete');
  await expect.poll(async () => (await objects(page, id)).some((o) => o.id === b)).toBe(false);
  await expect.poll(() => valueOf(page, id, sid)).toContain('Length\t1\t2.00 m');
});

test('dark: the export dialog, the pane and the summary pass axe', async ({ page }) => {
  const id = await open(page, { dark: true });
  await measured(page, id);
  await pane(page).getByRole('button', { name: 'Place summary' }).click();
  await expect
    .poll(async () =>
      (await objects(page, id)).some((o) => (o.contents ?? '').startsWith('Measurements')),
    )
    .toBe(true);
  await page.keyboard.press('Escape');
  // The rail button's tooltip (shown on focus) is not part of the check.
  await pane(page).getByRole('button', { name: 'Export…' }).focus();
  await cap(page, 'view', 'zoom', 1);
  await expect(page.locator('[data-radix-popper-content-wrapper]')).toHaveCount(0);
  await shot(page, '04-pane-summary-dark');
  expect(await axe(page)).toEqual([]);
  const dialog = await exportDialog(page);
  await dialog.getByLabel('Include pictures').check();
  await shot(page, '05-export-dialog-dark');
  expect(await axe(page)).toEqual([]);
});
