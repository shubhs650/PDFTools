import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { expect, test } from './support/fixtures.ts';

// M3-13 (D-23, §7.3): status schemes — presets, custom schemes, the active
// one, export and strict import of .pdftools-scheme.json, stored on this device.

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Status schemes' });

async function openSchemes(page: Page) {
  await page.getByRole('tab', { name: 'Comment' }).click();
  await page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name: 'Status Schemes' })
    .click();
  await expect(dialog(page)).toBeVisible();
}

test('presets, duplicate → edit → save, active scheme, kept after reload', async ({ page }) => {
  await page.goto('/');
  await openSchemes(page);
  await expect(
    dialog(page)
      .getByRole('list', { name: 'Schemes' })
      .getByRole('listitem')
      .filter({ hasText: 'Preset' }),
  ).toHaveCount(3);
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);

  await dialog(page).getByRole('button', { name: 'Duplicate 1 / 2 / 3 / 4' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit status scheme' });
  await editor.getByLabel('Scheme name').fill('Site review');
  await editor.getByLabel('Label 1').fill('No comments');
  await editor.getByRole('button', { name: 'Add code' }).click();
  await editor.getByLabel('Code 5').fill('2');
  await editor.getByLabel('Label 5').fill('Duplicate code');
  await editor.getByLabel('Colour 5').fill('#ffff00');
  await expect(editor).toContainText('hard to read on a white page');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor.getByRole('alert')).toHaveText('Two codes are the same.');
  await editor.getByRole('button', { name: 'Remove code 5' }).click();
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(dialog(page).getByRole('status')).toHaveText('Saved Site review.');
  await dialog(page).getByLabel('Active scheme').selectOption({ label: 'Site review' });

  await page.reload();
  await openSchemes(page);
  await expect(dialog(page).getByLabel('Active scheme')).toHaveValue(/.+/);
  await expect(dialog(page).getByLabel('Active scheme').locator('option:checked')).toHaveText(
    'Site review',
  );
  await expect(dialog(page).getByRole('list', { name: 'Codes of Site review' })).toContainText(
    'No comments',
  );
});

test('export downloads the scheme; import accepts it and refuses hostile files', async ({
  page,
}, info) => {
  await page.goto('/');
  await openSchemes(page);
  await dialog(page).getByRole('button', { name: 'Duplicate A / B / C / D' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit status scheme' });
  await editor.getByLabel('Scheme name').fill('Shop drawings');
  await editor.getByRole('button', { name: 'Save' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog(page).getByRole('button', { name: 'Export Shop drawings' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('Shop drawings.pdftools-scheme.json');
  const file = info.outputPath('scheme.json');
  await download.saveAs(file);
  const json = JSON.parse(readFileSync(file, 'utf8')) as {
    format: string;
    version: number;
    scheme: { name: string; codes: { code: string }[] };
  };
  expect(json).toMatchObject({
    format: 'pdftools-scheme',
    version: 1,
    scheme: { name: 'Shop drawings' },
  });
  expect(json.scheme.codes.map((c) => c.code)).toEqual(['A', 'B', 'C', 'D']);

  const importer = dialog(page).getByLabel('Import…');
  await importer.setInputFiles({
    name: 'evil.pdftools-scheme.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ ...json, scheme: { ...json.scheme, onload: 'alert(1)' } }),
    ),
  });
  await expect(dialog(page).getByRole('status')).toHaveText(
    "The file has entries a scheme doesn't have.",
  );
  await importer.setInputFiles({
    name: 'x.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{oops'),
  });
  await expect(dialog(page).getByRole('status')).toHaveText("The file isn't a valid scheme file.");
  await importer.setInputFiles({
    name: 'ok.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ ...json, scheme: { ...json.scheme, name: 'Imported one' } }),
    ),
  });
  await expect(dialog(page).getByRole('status')).toHaveText('Imported Imported one.');
  await expect(dialog(page).getByRole('list', { name: 'Codes of Imported one' })).toBeVisible();
});
