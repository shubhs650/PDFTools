import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { savedFiles, stubSavePicker } from './support/savePicker.ts';

// M2-11: the Attachments pane.

const pane = (page: Page) => page.getByRole('region', { name: 'Attachments' });
const list = (page: Page) => pane(page).getByRole('list', { name: 'Embedded files' });
const item = (page: Page, name: string) =>
  list(page)
    .getByRole('listitem')
    .filter({ has: page.getByText(name, { exact: true }) });
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');

async function openPane(page: Page, pdfs: { attachments(): Buffer }) {
  await page.goto('/');
  await drop(page, [{ name: 'with-files.pdf', b64: pdfs.attachments().toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await page
    .getByRole('complementary', { name: 'Navigation panes' })
    .getByRole('button', { name: 'Attachments' })
    .click();
}

test('lists all 20 files with size, date and description; saves the 20 MB one', async ({
  page,
  pdfs,
}) => {
  await openPane(page, pdfs);
  await expect(list(page).getByRole('listitem')).toHaveCount(20);
  await expect(item(page, 'big.bin')).toContainText('21 MB'); // 20 MiB in decimal units
  await expect(item(page, 'big.bin')).toContainText('Large binary');
  await expect(item(page, 'note.txt')).toContainText('On page 1');
  await expect(item(page, 'note.txt')).toContainText('A note');
  await expect(item(page, 'note.txt')).toContainText('2024');

  await stubSavePicker(page);
  await item(page, 'big.bin').getByRole('button', { name: 'Save…' }).click();
  await expect.poll(() => savedFiles(page)).toEqual([{ name: 'big.bin', bytes: 20 * 1024 * 1024 }]);
  await item(page, 'note.txt').getByRole('button', { name: 'Save…' }).click();
  await expect
    .poll(async () => (await savedFiles(page))[1])
    .toEqual({ name: 'note.txt', bytes: 50 });
  expect(await tabs(page).count()).toBe(1); // saving never opens anything

  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
});

test('a PDF attachment opens as a new tab', async ({ page, pdfs }) => {
  await openPane(page, pdfs);
  await item(page, 'inner.pdf').getByRole('button', { name: 'Open as Tab' }).click();
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(1)).toContainText('inner.pdf');
  await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  // Only PDFs offer it.
  await tabs(page).first().click();
  await expect(item(page, 'big.bin').getByRole('button', { name: 'Open as Tab' })).toHaveCount(0);
});
