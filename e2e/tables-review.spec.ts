import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { tablesPdf } from './fixtures/tables.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { stubSavePicker } from './support/savePicker.ts';

// M4-14 (§7.7, M4-Q10): Convert → Review & Extract (Beta) over the self-made
// table fixture — proposed outlines, dividers moved/removed/added by keyboard
// and pointer, a merged header from the cell grid, the mode's own undo, tables
// drawn with the pointer and with the keyboard rectangle, the export read back.

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

async function open(page: Page): Promise<string> {
  await page.goto('/');
  await drop(page, [{ name: 'tables.pdf', b64: b64(tablesPdf()) }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  return (await cap(page, 'view', 'activeDocId')) as string;
}

const list = (page: Page) => page.getByRole('listbox', { name: 'Page thumbnails' });
const thumb = (page: Page, label: string) =>
  list(page).getByRole('option', { name: label, exact: true });
const panel = (page: Page) => page.getByRole('complementary', { name: 'Review & Extract (Beta)' });

async function review(page: Page) {
  await page.getByRole('tab', { name: 'Convert' }).click();
  await page
    .getByRole('toolbar', { name: 'Convert commands' })
    .getByRole('button', { name: 'Review & Extract' })
    .click();
  await expect(panel(page)).toBeVisible();
  return panel(page);
}

async function exported(page: Page): Promise<ExcelJS.Workbook> {
  const out = (await cap(page, 'extract', 'lastExport', 'tables')) as {
    files: { b64: string | null }[];
  };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(Buffer.from(out.files[0]?.b64 ?? '', 'base64')).buffer);
  return wb;
}

const cell = (ws: ExcelJS.Worksheet | undefined, ref: string) => {
  const v = ws?.getCell(ref).value;
  return typeof v === 'number' ? String(v) : typeof v === 'string' ? v : '';
};

test('adjust a detected table by keyboard, merge its header, undo/redo, export', async ({
  page,
}) => {
  const id = await open(page);
  await stubSavePicker(page);
  await thumb(page, '3').click();
  await expect.poll(() => cap(page, 'pages', 'selection', id)).toEqual([2]);
  const p = await review(page);
  await expect(p.getByRole('status')).toHaveText('2 tables found.', { timeout: 20_000 });
  const bolts = p.getByRole('button', { name: 'Page 3, table 1: 6 × 2', exact: true });
  await expect(bolts).toBeVisible();
  await expect(
    p.getByRole('button', { name: 'Page 3, table 2: 6 × 2', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('table-outline')).toHaveCount(2);
  await bolts.click();
  await expect(bolts).toHaveAttribute('aria-pressed', 'true');
  const grid = p.getByRole('grid');
  await expect(grid.getByRole('gridcell', { name: 'M12' })).toBeVisible();

  // Remove the divider between M12 and M16 from the keyboard: one row "M12 / M16".
  await p.getByRole('button', { name: 'Edit Dividers' }).click();
  await expect(page.getByRole('separator', { name: 'Column divider 1 of 3' })).toBeFocused();
  await page.getByRole('separator', { name: 'Row divider 3 of 7' }).focus();
  await page.keyboard.press('Delete');
  await expect(
    p.getByRole('button', { name: 'Page 3, table 1: 5 × 2', exact: true }),
  ).toBeVisible();
  await expect(grid.getByRole('gridcell', { name: 'M12 M16' })).toBeVisible();
  // Arrow keys move a divider; Insert adds one; the mode's own undo/redo.
  const col = page.getByRole('separator', { name: 'Column divider 2 of 3' });
  const before = Number(await col.getAttribute('aria-valuenow'));
  await col.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(col).toHaveAttribute('aria-valuenow', String(before + 10));
  await page.keyboard.press('Insert');
  await expect(
    p.getByRole('button', { name: 'Page 3, table 1: 5 × 3', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(col).toHaveAttribute('aria-valuenow', String(before));
  await page.keyboard.press('ControlOrMeta+y');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(
    p.getByRole('button', { name: 'Page 3, table 1: 5 × 2', exact: true }),
  ).toBeVisible();

  // Merge the two header cells from the cell grid (click, Shift+click, M).
  await grid.getByRole('gridcell', { name: 'Size' }).click();
  await grid.getByRole('gridcell', { name: 'Torque Nm' }).click({ modifiers: ['Shift'] });
  await page.keyboard.press('m');
  await expect(grid.getByRole('gridcell', { name: 'Size Torque Nm' })).toHaveAttribute(
    'colspan',
    '2',
  );

  // Only the edited (so accepted) table is exported.
  await p.getByRole('button', { name: 'Export 1 Table…' }).click();
  await expect(p.getByRole('status')).toHaveText('1 table exported.', { timeout: 20_000 });
  const wb = await exported(page);
  expect(wb.worksheets.map((w) => w.name)).toEqual(['p3-t1']);
  const ws = wb.worksheets[0];
  expect((ws?.model as { merges?: string[] }).merges).toEqual(['A1:B1']);
  expect(cell(ws, 'A2')).toBe('M12\nM16');
  expect(cell(ws, 'B5')).toBe('1400');
  expect(ws?.getRow(1).font.bold).toBe(true);

  // Undo in the mode never touched the document; closing the mode ends it.
  await p.getByRole('button', { name: 'Close Review & Extract' }).click();
  await expect(panel(page)).toBeHidden();
  await expect(page.getByTestId('table-layer')).toHaveCount(0);
});

test('draw tables with the pointer and with the keyboard rectangle; axe', async ({ page }) => {
  const id = await open(page);
  await stubSavePicker(page);
  await thumb(page, '5').click();
  await expect.poll(() => cap(page, 'pages', 'selection', id)).toEqual([4]);
  const p = await review(page);
  await expect(p.getByRole('status')).toHaveText('No new tables found on this page.', {
    timeout: 20_000,
  });
  await expect(p).toContainText('No tables yet.');

  // Pointer: the Draw Table tool, then a drag on the page.
  await p.getByRole('button', { name: 'Draw Table' }).click();
  await expect(p.getByRole('button', { name: 'Draw Table' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const box = await page.locator('[data-page="4"] .page-content').boundingBox();
  if (!box) throw new Error('page 5 not laid out');
  await page.mouse.move(box.x + 40, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 120, { steps: 5 });
  await page.mouse.move(box.x + 300, box.y + 160, { steps: 5 });
  await page.mouse.up();
  await expect(
    p.getByRole('button', { name: 'Page 5, table 1: 1 × 1', exact: true }),
  ).toBeVisible();
  await page.getByRole('separator', { name: 'Column divider 1 of 2' }).focus();
  await page.keyboard.press('Insert');
  await expect(
    p.getByRole('button', { name: 'Page 5, table 1: 1 × 2', exact: true }),
  ).toBeVisible();

  // Keyboard: Draw Table from the keyboard starts the rectangle at the page's centre.
  await p.getByRole('button', { name: 'Draw Table' }).focus();
  await page.keyboard.press('Enter');
  const rect = page.getByRole('application', { name: 'New table outline' });
  await expect(rect).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Enter');
  await expect(
    p.getByRole('button', { name: 'Page 5, table 2: 1 × 1', exact: true }),
  ).toBeVisible();
  await expect(rect).toHaveCount(0);

  const { violations } = await new AxeBuilder({ page })
    .include('.table-review-panel')
    .include('[data-testid="table-layer"]')
    .analyze();
  expect(violations.map((v) => v.id)).toEqual([]);

  await p.getByRole('button', { name: 'Export 2 Tables…' }).click();
  await expect(p.getByRole('status')).toHaveText('2 tables exported.', { timeout: 20_000 });
  expect((await exported(page)).worksheets.map((w) => w.name)).toEqual(['p5-t1', 'p5-t2']);
});
