import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import type { Download, Page } from '@playwright/test';
import { darkTheme } from './support/app.ts';
import { compareSide, corpusFile, dropOn, overlayOf, textOf } from './support/compare.ts';
import { expect, test } from './support/fixtures.ts';

// M12-21 (D-65, D-58, Q34, Q35): Compare → Export Change Register… writes
// the differences the list shows (with its filters and search) to Excel or
// CSV; Compare → Save as Preset… keeps a result's settings on this device,
// and a new comparison's Options picks them before Compare.

const registerDialog = (page: Page) => page.getByRole('dialog', { name: 'Export Change Register' });

/** The download path (no save picker): the file is read back here. */
async function noSavePicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined });
  });
}

async function openRegister(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Compare', exact: true }).click();
  await page.getByRole('button', { name: 'Export Change Register…' }).click();
  await expect(registerDialog(page)).toBeVisible();
}

async function exportAs(page: Page, format: 'Excel workbook (.xlsx)' | 'CSV (.csv)') {
  const d = registerDialog(page);
  await d.getByRole('radio', { name: format }).check();
  const download = page.waitForEvent('download');
  await d.getByRole('button', { name: 'Export…' }).click();
  const file: Download = await download;
  await expect(registerDialog(page)).toHaveCount(0);
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

/** The CSV's lines (BOM dropped; a quoted cell may hold a line break, so count records by number). */
const csvLines = (bytes: Buffer): string[] =>
  bytes.toString('utf8').replace(/^﻿/u, '').split('\r\n').filter(Boolean);

/** Waits until every sheet is detected; the number of differences the list shows. */
async function listed(page: Page): Promise<number> {
  const count = page.getByTestId('diff-count');
  await expect(count).toHaveAttribute('data-detected', '1', { timeout: 60_000 });
  return Number(await count.getAttribute('data-shown'));
}

test('pair 01: the change register lists what the list shows, in Excel and CSV @smoke', async ({
  page,
}) => {
  await noSavePicker(page);
  await overlayOf(page, '01');
  const all = await listed(page);
  expect(all).toBeGreaterThan(20);

  await openRegister(page);
  const d = registerDialog(page);
  await expect(d.getByTestId('register-count')).toHaveAttribute('data-shown', String(all));
  await expect(d.getByRole('radio', { name: 'Excel workbook (.xlsx)' })).toBeChecked();
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);

  const xlsx = await exportAs(page, 'Excel workbook (.xlsx)');
  expect(xlsx.name).toBe('Pair 01 RevA vs Pair 01 RevB (changes).xlsx');
  // A workbook is a zip.
  expect(xlsx.bytes.subarray(0, 2).toString('latin1')).toBe('PK');

  // The list's search: the register follows it.
  const search = page.getByTestId('diff-search');
  await search.fill('Ø128.0');
  await search.press('Enter');
  await expect(page.getByTestId('diff-count')).toHaveAttribute('data-shown', '1');
  await openRegister(page);
  await expect(registerDialog(page).getByTestId('register-count')).toHaveText(
    /It lists 1 of \d+ differences/,
  );
  const csv = await exportAs(page, 'CSV (.csv)');
  expect(csv.name).toBe('Pair 01 RevA vs Pair 01 RevB (changes).csv');
  const lines = csvLines(csv.bytes);
  expect(lines[0]).toBe('No.,Sheet,Page (old),Page (new),Kind,Type,Old,New,Change (%),Checked');
  expect(lines).toHaveLength(2);
  // Ø120.0 → Ø128.0 is +6.67 %.
  expect(lines[1]).toMatch(/^1,1,1,1,Changed,[^,]+,.*Ø120\.0.*,.*Ø128\.0.*,6\.67,$/u);
});

test('pair 09: a text comparison’s register names the pages and kinds', async ({ page }) => {
  await noSavePicker(page);
  await textOf(page, '09');
  const shown = Number(await page.getByTestId('text-list-count').getAttribute('data-shown'));
  expect(shown).toBeGreaterThan(0);
  await openRegister(page);
  await expect(registerDialog(page).getByTestId('register-count')).toHaveAttribute(
    'data-shown',
    String(shown),
  );
  const csv = await exportAs(page, 'CSV (.csv)');
  const lines = csvLines(csv.bytes);
  expect(lines[0]).toBe('No.,Page (old),Page (new),Kind,Old,New,Change (%),Notes,Checked');
  // Every change has its number; a moved block is named as moved.
  expect(csv.bytes.toString('utf8')).toMatch(/\r\n1,/u);
  expect(csv.bytes.toString('utf8')).toContain(',Moved,');
});

test('a preset saved from a result is picked in a new comparison’s Options and used by Compare', async ({
  page,
}) => {
  await overlayOf(page, '01');
  // The result's settings: high sensitivity and red/blue.
  await page.getByTestId('diff-sensitivity').selectOption('high');
  await page.getByTestId('diff-min-size').selectOption('1');
  await page.getByRole('tab', { name: 'Compare', exact: true }).click();
  await page.getByRole('button', { name: 'Save as Preset…' }).click();
  const save = page.getByRole('dialog', { name: 'Save as Preset' });
  await save.getByLabel('Name').fill('Flanges');
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  await save.getByRole('button', { name: 'Save' }).click();
  await expect(save).toHaveCount(0);

  // A new PDF overlay of the same pair: Options is collapsed; the preset is listed.
  await page.getByRole('button', { name: 'PDF Overlay' }).click();
  await dropOn(compareSide(page, 'a'), [corpusFile('01', 'old', 'Pair 01 RevA.pdf')]);
  await expect(compareSide(page, 'a').getByTestId('compare-file')).toHaveCount(1);
  await dropOn(compareSide(page, 'b'), [corpusFile('01', 'new', 'Pair 01 RevB.pdf')]);
  await expect(page.getByTestId('compare-pairing')).toHaveAttribute('data-status', 'done', {
    timeout: 30_000,
  });
  const toggle = page.getByTestId('compare-options-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await page.getByTestId('compare-preset').selectOption({ label: 'Flanges' });
  await expect(page.getByTestId('compare-preset-summary')).toHaveText(
    /Sensitivity: High · Minimum size: 1 mm · Ignore zones: 0/,
  );
  const input = page.getByTestId('compare-input');
  const axe = await new AxeBuilder({ page }).include('[data-testid="compare-input"]').analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  await input.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(page.getByTestId('diff-sensitivity')).toHaveValue('high');
  await expect(page.getByTestId('diff-min-size')).toHaveValue('1');
});

test('the input window’s Options pass axe in the dark theme', async ({ page }) => {
  await darkTheme(page);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Compare', exact: true }).click();
  await page.getByRole('button', { name: 'PDF Overlay' }).click();
  await page.getByTestId('compare-options-toggle').click();
  await expect(page.getByTestId('compare-preset')).toBeVisible();
  const { violations } = await new AxeBuilder({ page })
    .include('[data-testid="compare-options"]')
    .analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
});
