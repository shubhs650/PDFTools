import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { PARTS, tablesPdf } from './fixtures/tables.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { stubSavePicker } from './support/savePicker.ts';

// M4-15 (§7.7, §10.3, M4-Q9): save a table from Review & Extract as a
// template, apply it to pages 1–5 (page 1 is landscape: skipped and named),
// export, add to the review; rename and delete; listed on the Privacy page;
// "Clear all local data" removes it.

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const backstage = (page: Page) => page.getByTestId('backstage');

async function open(page: Page): Promise<string> {
  await drop(page, [{ name: 'tables.pdf', b64: b64(tablesPdf()) }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  return (await cap(page, 'view', 'activeDocId')) as string;
}

const list = (page: Page) => page.getByRole('listbox', { name: 'Page thumbnails' });
const thumb = (page: Page, label: string) =>
  list(page).getByRole('option', { name: label, exact: true });
const panel = (page: Page) => page.getByRole('complementary', { name: 'Review & Extract (Beta)' });
const convertBar = (page: Page) => page.getByRole('toolbar', { name: 'Convert commands' });

async function section(page: Page, name: string) {
  if (!(await backstage(page).isVisible())) await page.getByTestId('file-tab').click();
  await backstage(page).getByRole('button', { name, exact: true }).click();
  await expect(backstage(page).getByRole('heading', { name, exact: true })).toBeVisible();
}

test('save a template, apply it to pages 1–5, export, add to the review; clear local data', async ({
  page,
}) => {
  page.on('dialog', (d) => {
    void d.accept();
  });
  await page.goto('/');
  const id = await open(page);
  await stubSavePicker(page);

  // Review & Extract on page 2: the parts list, saved as a template.
  await thumb(page, '2').click();
  await expect.poll(() => cap(page, 'pages', 'selection', id)).toEqual([1]);
  await page.getByRole('tab', { name: 'Convert' }).click();
  await convertBar(page).getByRole('button', { name: 'Review & Extract' }).click();
  const p = panel(page);
  await expect(p.getByRole('status')).toHaveText('1 table found.', { timeout: 20_000 });
  await p.getByRole('button', { name: 'Page 2, table 1: 9 × 5', exact: true }).click();
  await p.getByLabel('Template name').fill('Parts list');
  await p.getByRole('button', { name: 'Save as Template' }).click();
  await expect(p.getByRole('status')).toHaveText('Template “Parts list” saved.');
  await p.getByRole('button', { name: 'Close Review & Extract' }).click();

  // Apply to pages 1–5 and export: page 1 (landscape) is skipped.
  await convertBar(page).getByRole('button', { name: 'Table Templates' }).click();
  const dialog = page.getByRole('dialog', { name: 'Table Templates (Beta)' });
  await expect(
    dialog.getByRole('radio', { name: /^Parts list \(9 × 5, page 595 × 842 pt\)/ }),
  ).toBeChecked();
  await dialog.getByRole('radio', { name: 'Pages:' }).check();
  await dialog.getByLabel('Page range').fill('1-5');
  await dialog.getByRole('button', { name: 'Export…' }).click();
  await expect(dialog.getByRole('status')).toHaveText(
    "Page 1 was skipped: its size or rotation differs from the template's page.",
  );
  await expect
    .poll(async () => (await cap(page, 'extract', 'lastExport', 'tables')) !== null)
    .toBe(true);
  const out = (await cap(page, 'extract', 'lastExport', 'tables')) as {
    files: { path: string; b64: string | null }[];
  };
  expect(out.files[0]?.path).toBe('tables tables.xlsx');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(Buffer.from(out.files[0]?.b64 ?? '', 'base64')).buffer);
  expect(wb.worksheets.map((w) => w.name)).toEqual(['p2-t1', 'p3-t1', 'p4-t1', 'p5-t1']);
  const parts = wb.getWorksheet('p2-t1');
  expect(parts?.getCell('C2').value).toBe(PARTS.cells[1]?.[2]);
  expect(parts?.getRow(1).font.bold).toBe(true);

  // Rename, then add to Review & Extract (pages 2–3).
  await dialog.getByLabel('Name', { exact: true }).fill('Parts list A');
  await dialog.getByRole('button', { name: 'Rename' }).click();
  await expect(dialog.getByRole('radio', { name: /^Parts list A / })).toBeVisible();
  await dialog.getByLabel('Page range').fill('2-3');
  await dialog.getByRole('button', { name: 'Add to Review & Extract' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    p.getByRole('button', { name: 'Page 2, table 1: 9 × 5', exact: true }),
  ).toBeVisible();
  await expect(
    p.getByRole('button', { name: 'Page 3, table 1: 9 × 5', exact: true }),
  ).toBeVisible();
  await p.getByRole('button', { name: 'Close Review & Extract' }).click();

  // The Privacy page lists templates; clearing local data removes them.
  await section(page, 'Privacy');
  const table = backstage(page)
    .getByTestId('privacy')
    .getByRole('table', { name: 'Data Triya PDF keeps on this device' });
  await expect(table.getByRole('cell', { name: /pdftools › tableTemplates/ })).toBeVisible();
  await section(page, 'Settings');
  await backstage(page).getByRole('button', { name: 'Clear all local data…' }).click();
  await page
    .getByRole('dialog', { name: 'Clear all local data?' })
    .getByRole('button', { name: 'Clear data' })
    .click();
  await expect(backstage(page).getByRole('status')).toHaveText('Local data cleared.');
  await page.reload();
  await open(page);
  await page.getByRole('tab', { name: 'Convert' }).click();
  await convertBar(page).getByRole('button', { name: 'Table Templates' }).click();
  await expect(page.getByRole('dialog', { name: 'Table Templates (Beta)' })).toContainText(
    'No templates yet.',
  );
});

test('delete a template', async ({ page }) => {
  await page.goto('/');
  const id = await open(page);
  await thumb(page, '3').click();
  await expect.poll(() => cap(page, 'pages', 'selection', id)).toEqual([2]);
  await page.getByRole('tab', { name: 'Convert' }).click();
  await convertBar(page).getByRole('button', { name: 'Review & Extract' }).click();
  const p = panel(page);
  await expect(p.getByRole('status')).toHaveText('2 tables found.', { timeout: 20_000 });
  await p.getByLabel('Template name').fill('Bolts');
  await p.getByRole('button', { name: 'Save as Template' }).click();
  await expect(p.getByRole('status')).toHaveText('Template “Bolts” saved.');
  await p.getByRole('button', { name: 'Table Templates…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Table Templates (Beta)' });
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  await dialog.getByRole('button', { name: 'Delete “Bolts”' }).click();
  await expect(dialog).toContainText('No templates yet.');
});
