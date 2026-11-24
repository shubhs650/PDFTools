import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { A, asXlsm, templateA } from './fixtures/crsTemplates.ts';
import { crsCorpusFile } from './fixtures/crs-review/index.ts';
import { cap, darkTheme, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { savedFiles, stubSavePicker } from './support/savePicker.ts';

// M13-08 (D-71, plan M13 §6, C13 – C15): the CRS template screens. A project
// form (made by script, rule 13) is imported from the export dialog, set up
// in the four guided steps beside the live sheet preview (the first
// suggestions checked, a field placed by clicking the sheet, the keyboard
// path through every step), kept in the template manager (rename, duplicate,
// export and import the template file, delete), and Export CRS fills it for
// the CRS review corpus documents. Axe light and dark.

const SPEC = 'crs_02_pump_specification_review.pdf';
const DRAWINGS = 'crs_01_steel_drawing_set_review.pdf';

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

async function start(page: Page): Promise<void> {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await stubSavePicker(page);
}

async function exportDialog(page: Page): Promise<Locator> {
  await page.getByRole('tab', { name: 'Comment' }).click();
  await page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name: 'Export CRS' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Export Comment Review Sheet' });
  await expect(dialog).toBeVisible();
  return dialog;
}

const manager = (page: Page) => page.getByRole('dialog', { name: 'CRS templates' });
const setup = (page: Page) =>
  page.getByRole('dialog', { name: /^(Set up a|Edit the) CRS template$/u });
const grid = (page: Page) => page.getByRole('grid', { name: /^Sheet / });

async function formBytes(): Promise<Buffer> {
  return Buffer.from(await templateA(ExcelJS));
}

/** Manager → Import Excel form… with template A; the set-up opens. */
async function importForm(page: Page, name = 'Project Alpha CRS.xlsx'): Promise<void> {
  await manager(page)
    .getByLabel('Import Excel form…')
    .setInputFiles({
      name,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: await formBytes(),
    });
  await expect(setup(page)).toBeVisible();
  await expect(grid(page)).toBeVisible();
}

const closeManager = (page: Page) =>
  manager(page).locator('.ui-dialog-footer').getByRole('button', { name: 'Close' }).click();

const step = (page: Page, name: string | RegExp) =>
  setup(page).getByRole('navigation', { name: 'Steps' }).getByRole('button', { name });

test('import a project form from Export CRS, check the suggestions, place a field, export @smoke', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await start(page);
  await open(page, SPEC);
  const dialog = await exportDialog(page);
  await expect(dialog.getByLabel('Template')).toHaveValue('');
  await expect(dialog.getByText(/Have your project's own Excel form/u)).toBeVisible();
  await dialog.getByRole('button', { name: 'Templates…' }).click();
  await expect(manager(page)).toBeVisible();
  await expect(
    manager(page).getByText('No project templates yet.', { exact: false }),
  ).toBeVisible();
  await importForm(page);

  // Step 1: the name from the file, the CRS sheet, the start row under the header (suggested),
  // the pre-drawn rows found from the start row's borders.
  const s = setup(page);
  await expect(s.getByLabel('Template name')).toHaveValue('Project Alpha CRS');
  await expect(s.getByLabel('Sheet the export fills')).toHaveValue(A.sheet);
  await expect(s.getByLabel('Start row number')).toHaveValue(String(A.startRow));
  await expect(s.getByTestId('crs-predrawn')).toContainText('Rows 10–24 are ready-drawn');
  await expect(s.getByText('Suggested from the sheet', { exact: false })).toBeVisible();
  // The preview draws the form: the title, the header, the start row marked.
  await expect(
    grid(page).getByRole('gridcell', { name: /^C1, COMMENT RESOLUTION SHEET/u }),
  ).toBeVisible();
  await expect(page.locator('tr.crs-pv-start')).toHaveCount(1);

  // A click on row 12 moves the start row; another back on row 10.
  await grid(page).getByRole('gridcell', { name: /^B12/u }).click();
  await expect(s.getByLabel('Start row number')).toHaveValue('12');
  await grid(page).getByRole('gridcell', { name: /^B10/u }).click();
  await expect(s.getByLabel('Start row number')).toHaveValue('10');

  // Step 2: the detail cells next to their labels.
  await s.getByRole('button', { name: 'Next' }).click();
  await expect(s.getByLabel('Cell for Document number')).toHaveValue(A.details.docNo);
  await expect(s.getByLabel('Cell for Revision')).toHaveValue(A.details.rev);
  await expect(s.getByLabel('Cell for Review date')).toHaveValue(A.details.date);
  await expect(s.getByLabel('Cell for Comment count')).toHaveValue('');
  // Cleared, then placed again by clicking its cell.
  await s.getByRole('button', { name: 'Clear Reviewer' }).click();
  await expect(s.getByLabel('Cell for Reviewer')).toHaveValue('');
  await s.getByLabel('Place Reviewer by clicking the sheet').check();
  await grid(page).getByRole('gridcell', { name: /^C6/u }).click();
  await expect(s.getByLabel('Cell for Reviewer')).toHaveValue(A.details.reviewer);
  await expect(grid(page).getByRole('gridcell', { name: 'C6, Reviewer' })).toBeVisible();

  // Step 3: the fields the header names; Response is placed by clicking its column.
  await s.getByRole('button', { name: 'Next' }).click();
  await expect(s.getByLabel('Column for Sr. No.')).toHaveValue('A');
  await expect(s.getByLabel('Column for Comment text')).toHaveValue('E');
  await expect(s.getByLabel('Column for Snapshot')).toHaveValue('F');
  await expect(s.getByLabel('Column for Status')).toHaveValue('I');
  await s.getByLabel('Place All replies by clicking the sheet').check();
  await expect(s.getByText('Click the column where All replies goes.')).toBeVisible();
  await grid(page).getByRole('gridcell', { name: /^J9,/u }).click();
  await expect(s.getByLabel('Column for All replies')).toHaveValue('J');
  await expect(s.getByLabel('Write All replies')).toBeChecked();
  // The start row's cell in J carries the field's name.
  await expect(grid(page).getByRole('gridcell', { name: 'J10, All replies' })).toBeVisible();
  // Two fields on one column are flagged once the step is checked.
  await s.getByLabel('Column for Comment ID').fill('E');
  await s.getByRole('button', { name: 'Next' }).click();
  await step(page, 'Step 3: Columns').click();
  await expect(s.getByRole('alert')).toContainText('Column 5 (E) has more than one field');
  await s.getByLabel('Column for Comment ID').fill('');
  await expect(s.getByRole('alert')).toHaveCount(0);

  // Step 4: status words in the project's own codes.
  await s.getByRole('button', { name: 'Next' }).click();
  await expect(s.getByLabel('Ignore highlights (comments under 70 % opacity)')).toBeChecked();
  await s.getByLabel('Accepted').fill('Closed');
  await s.getByLabel('No status').fill('Open');
  await s.getByRole('button', { name: 'Save template' }).click();
  await expect(setup(page)).toBeHidden();

  // Back in the manager: the template listed.
  await expect(manager(page).getByTestId('crs-template-item')).toHaveCount(1);
  await expect(manager(page).getByText('Project Alpha CRS', { exact: true })).toBeVisible();
  await closeManager(page);

  // The export dialog chose it: documents, details (prefilled), options.
  await expect(dialog.getByLabel('Template').locator('option:checked')).toHaveText(
    'Project Alpha CRS',
  );
  await expect(dialog.getByTestId('crs-template-summary')).toHaveText(
    `Fills sheet “${A.sheet}” from row ${String(A.startRow)}.`,
  );
  await expect(dialog.getByLabel(SPEC)).toBeChecked();
  await dialog.getByLabel('Document number').fill('PS-1200-ME-SPC-0007');
  await dialog.getByLabel('Revision').fill('B');
  await dialog.getByRole('button', { name: 'Export' }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  expect(await savedFiles(page)).toEqual([
    expect.objectContaining({ name: 'crs_02_pump_specification_review (CRS).xlsx' }) as unknown,
  ]);
  const f = (await cap(page, 'annotate', 'lastTemplateCrs')) as {
    name: string;
    sheets: string[];
    b64: string;
  } | null;
  if (!f) throw new Error('no file');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(Buffer.from(f.b64, 'base64')).buffer);
  const ws = wb.getWorksheet(A.sheet);
  if (!ws) throw new Error('no sheet');
  expect(ws.getCell(A.details.docNo).value).toBe('PS-1200-ME-SPC-0007');
  expect(ws.getCell(A.details.rev).value).toBe('B');
  expect(ws.getCell(A.details.reviewer).value).toBe('Ana de Vries');
  expect(ws.getCell(A.startRow, A.cols.srNo).value).toBe(1);
  expect(ws.getCell(A.startRow, A.cols.text).text).not.toBe('');
  expect(['Open', 'Closed']).toContain(ws.getCell(A.startRow, A.cols.status).value);
  expect(ws.getImages().length).toBeGreaterThan(0);

  // Next time the dialog opens on the template last used.
  const again = await exportDialog(page);
  await expect(again.getByTestId('crs-template-summary')).toBeVisible();
});

test('two open documents: each gets its own copy of the sheet (C15)', async ({ page }) => {
  test.setTimeout(120_000);
  await start(page);
  await open(page, DRAWINGS);
  await open(page, SPEC);
  const dialog = await exportDialog(page);
  await dialog.getByRole('button', { name: 'Templates…' }).click();
  await importForm(page);
  await setup(page).getByRole('button', { name: 'Save template' }).click();
  await expect(setup(page)).toBeHidden();
  await closeManager(page);
  await dialog.getByLabel(DRAWINGS).check();
  await expect(dialog.getByRole('group', { name: `Details of ${DRAWINGS}` })).toBeVisible();
  await expect(dialog.getByRole('group', { name: `Details of ${SPEC}` })).toBeVisible();
  await dialog.getByRole('button', { name: 'Export' }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  const f = (await cap(page, 'annotate', 'lastTemplateCrs')) as { sheets: string[] } | null;
  expect(f?.sheets).toHaveLength(2);
});

test('the keyboard reaches every step: cells picked with arrows and Enter @a11y', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await start(page);
  await open(page, SPEC);
  const dialog = await exportDialog(page);
  await dialog.getByRole('button', { name: 'Templates…' }).click();
  await importForm(page);
  const s = setup(page);

  /** Tabs through the dialog once; the accessible names of what took focus. */
  const tabRound = async (): Promise<string[]> => {
    const names: string[] = [];
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press('Tab');
      const name = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return '';
        const own = el.getAttribute('aria-label');
        const labelled = el instanceof HTMLInputElement ? el.labels?.[0]?.textContent : null;
        const label = own ?? labelled ?? el.textContent;
        return `${el.getAttribute('role') ?? el.tagName.toLowerCase()}:${label.trim()}`;
      });
      if (names.includes(name)) break;
      names.push(name);
    }
    return names;
  };

  // Step 1: the grid is one tab stop; arrows move, Enter sets the start row.
  await s.getByLabel('Start row number').focus();
  let names = await tabRound();
  expect(names.some((n) => n.startsWith('gridcell:'))).toBe(true);
  expect(names).toContain('button:Next');
  expect(names).toContain('button:Save template');
  const cell = grid(page).locator('[role="gridcell"][tabindex="0"]');
  await cell.focus();
  await expect(cell).toHaveAccessibleName(/^A10/u);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(s.getByLabel('Start row number')).toHaveValue('12');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press(' ');
  await expect(s.getByLabel('Start row number')).toHaveValue('10');

  // Each step by Next, pressed with the keyboard.
  const next = s.getByRole('button', { name: 'Next' });
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(s.getByTestId('crs-setup-step-details')).toBeVisible();
  // Step 2: pick Title's radio, then place it with the keyboard in the sheet.
  await s.getByLabel('Place Title by clicking the sheet').focus();
  await page.keyboard.press('Space');
  await s.getByLabel('Cell for Title').fill('');
  await grid(page).locator('[role="gridcell"][tabindex="0"]').focus();
  await page.keyboard.press('Control+Home'); // A1, the logo's merged A1:B3
  await page.keyboard.press('ArrowDown'); // A4 (below the merge)
  await page.keyboard.press('ArrowDown'); // A5
  await page.keyboard.press('ArrowRight'); // C5 (past the A5:B5 merge)
  await page.keyboard.press('Enter');
  await expect(s.getByLabel('Cell for Title')).toHaveValue('C5');
  names = await tabRound();
  expect(names).toContain('input:Cell for Document number');
  expect(names).toContain('input:File-name rule (optional)');

  await next.focus();
  await page.keyboard.press('Enter');
  await expect(s.getByTestId('crs-setup-step-columns')).toBeVisible();
  // Step 3: Comment ID placed on column K with the keyboard.
  await s.getByLabel('Place Comment ID by clicking the sheet').focus();
  await page.keyboard.press('Space');
  await grid(page).locator('[role="gridcell"][tabindex="0"]').focus();
  await page.keyboard.press('Control+End'); // the last cell shown, in column K
  await page.keyboard.press('Enter');
  await expect(s.getByLabel('Column for Comment ID')).toHaveValue('K');
  names = await tabRound();
  expect(names).toContain('input:Write Sr. No.');
  expect(names).toContain('input:Column for Fixed text');

  await next.focus();
  await page.keyboard.press('Enter');
  await expect(s.getByTestId('crs-setup-step-comments')).toBeVisible();
  names = await tabRound();
  expect(names).toContain('button:Tick all');
  expect(names.some((n) => n.includes('Ignore highlights'))).toBe(true);
  const save = s.getByRole('button', { name: 'Save template' });
  await save.focus();
  await page.keyboard.press('Enter');
  await expect(setup(page)).toBeHidden();
  await expect(manager(page).getByTestId('crs-template-item')).toHaveCount(1);
});

test('the template manager: refusals, rename, duplicate, template file out and in, delete; from Settings', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await start(page);
  // From File → Settings.
  await page.getByTestId('file-tab').click();
  const backstage = page.getByTestId('backstage');
  await backstage.getByRole('button', { name: 'Settings', exact: true }).click();
  const section = page.getByTestId('crs-templates-section');
  await expect(section).toContainText('No project templates on this device.');
  await section.getByRole('button', { name: 'Manage CRS templates…' }).click();
  await expect(manager(page)).toBeVisible();

  // A macro workbook and a stray file are refused with what to do.
  const m = manager(page);
  await m.getByLabel('Import Excel form…').setInputFiles({
    name: 'form.xlsm',
    mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    buffer: Buffer.from(asXlsm(new Uint8Array(await formBytes()))),
  });
  await expect(m.getByRole('status')).toHaveText(/has macros \(\.xlsm\)/u);
  await m.getByLabel('Import template file…').setInputFiles({
    name: 'x.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"x"}'),
  });
  await expect(m.getByRole('status')).toHaveText("This isn't a CRS template file.");

  await importForm(page, 'Alpha.xlsx');
  await setup(page).getByRole('button', { name: 'Save template' }).click();
  await expect(m.getByTestId('crs-template-item')).toHaveCount(1);

  // Rename.
  await m.getByRole('button', { name: 'Rename Alpha' }).click();
  await expect(m.getByLabel('New name')).toBeFocused();
  await m.getByLabel('New name').fill('Alpha form');
  await m.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(m.getByText('Alpha form', { exact: true })).toBeVisible();
  // Duplicate.
  await m.getByRole('button', { name: 'Duplicate Alpha form' }).click();
  await expect(m.getByText('Alpha form (2)', { exact: true })).toBeVisible();
  // Export the template file and import it again.
  const download = page.waitForEvent('download');
  await m.getByRole('button', { name: 'Export template file of Alpha form', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Alpha form (CRS template).json');
  const path = await file.path();
  await m.getByLabel('Import template file…').setInputFiles(path);
  await expect(m.getByRole('status')).toHaveText('Imported Alpha form (3).');
  await expect(m.getByTestId('crs-template-item')).toHaveCount(3);
  // Edit opens the set-up with what was saved.
  await m.getByRole('button', { name: 'Edit Alpha form (3)' }).click();
  await expect(setup(page)).toBeVisible();
  await expect(setup(page).getByLabel('Start row number')).toHaveValue(String(A.startRow));
  await setup(page).getByRole('button', { name: 'Cancel' }).click();
  // Delete asks first; Keep has the focus.
  await m.getByRole('button', { name: 'Delete Alpha form (2)' }).click();
  await expect(m.getByRole('button', { name: 'Keep' })).toBeFocused();
  await m.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(m.getByTestId('crs-template-item')).toHaveCount(2);
  await closeManager(page);
  await expect(section).toContainText('2 project templates on this device.');
});

for (const dark of [false, true])
  test(`the export dialog, the manager and every set-up step pass axe (${dark ? 'dark' : 'light'}) @a11y`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    if (dark) await darkTheme(page);
    await start(page);
    await open(page, SPEC);
    const dialog = await exportDialog(page);
    const axe = async (sel: string): Promise<void> => {
      const r = await new AxeBuilder({ page }).include(sel).analyze();
      expect(r.violations).toEqual([]);
    };
    await axe('[role="dialog"]');
    await dialog.getByRole('button', { name: 'Templates…' }).click();
    await axe('[data-testid="crs-manager"]');
    await importForm(page);
    for (const name of [
      'Sheet and start row',
      'Document details',
      'Columns',
      'Comments and options',
    ]) {
      await step(page, new RegExp(name, 'u')).click();
      await axe('[data-testid="crs-setup"]');
    }
    await setup(page).getByRole('button', { name: 'Save template' }).click();
    await closeManager(page);
    await expect(dialog.getByTestId('crs-template-summary')).toBeVisible();
    await axe('[role="dialog"]');
  });
