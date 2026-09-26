import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { NEEDLE } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M2-07: Quick Find (Ctrl+F). Searches only on Enter (D-08, rule 3).

const bar = (page: Page) => page.getByRole('region', { name: 'Find in document' });
const field = (page: Page) => bar(page).getByRole('searchbox', { name: 'Find' });
const status = (page: Page) => bar(page).getByRole('status');
const findState = async (page: Page) =>
  (await cap(page, 'find', 'state')) as {
    ran: unknown;
    status: string;
    total: number;
    cursor: { page: number; index: number } | null;
  };
const pageBox = (page: Page) =>
  page
    .getByRole('contentinfo', { name: 'Status bar' })
    .getByRole('textbox', { name: 'Page number' });

test('typing never searches; Enter finds the needle far away; F3 and Shift+F3 walk the hits', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await drop(page, [{ name: 'contract.pdf', b64: pdfs.contract(2000).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+F');
  await expect(field(page)).toBeFocused();

  await field(page).pressSequentially('abcdefghijklmnopqrstuvwxyz');
  await page.waitForTimeout(300);
  expect((await findState(page)).ran).toBeNull(); // 26 keystrokes, no search

  await field(page).fill(NEEDLE);
  await field(page).press('Enter');
  await expect(status(page)).toHaveText('1 of 3');
  await expect(pageBox(page)).toHaveValue('7'); // the first hit after page 1
  await expect(page.locator('[data-page="6"] .find-hit--current')).toBeVisible();

  await page.keyboard.press('F3');
  await expect(status(page)).toHaveText('2 of 3');
  await expect(pageBox(page)).toHaveValue('1,000');
  await expect(page.locator('[data-page="999"] .find-hit--current')).toBeVisible();

  await field(page).press('Enter'); // Enter again = next
  await expect(status(page)).toHaveText('3 of 3');
  await page.keyboard.press('Shift+F3');
  await expect(status(page)).toHaveText('2 of 3');
  await page.keyboard.press('F3');
  await page.keyboard.press('F3'); // wraps around
  await expect(status(page)).toHaveText('1 of 3');

  await field(page).press('Escape');
  await expect(bar(page)).toBeHidden();
  await expect(page.getByTestId('document-view')).toBeFocused();
  await expect(page.locator('.find-hit')).toHaveCount(0);
});

test('whole word and match case; no results; a bad regex-like query is literal', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await drop(page, [{ name: 'c.pdf', b64: pdfs.contract(20).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await page.keyboard.press('Control+F');
  await field(page).fill('CONTRACTOR');
  await field(page).press('Enter');
  await expect(status(page)).toHaveText(/^1 of \d+/);
  const all = (await findState(page)).total;

  await bar(page).getByRole('button', { name: 'Match Case' }).click();
  await field(page).press('Enter'); // options changed: a new search
  await expect(status(page)).toHaveText('No results');

  await bar(page).getByRole('button', { name: 'Match Case' }).click();
  await bar(page).getByRole('button', { name: 'Whole Words Only' }).click();
  await field(page).fill('contract');
  await field(page).press('Enter');
  await expect(status(page)).toHaveText(/^1 of \d+/);
  expect((await findState(page)).total).toBeLessThan(all); // "contractor" no longer counts

  await field(page).fill('(');
  await field(page).press('Enter'); // not a regex: a literal "("
  await expect(status(page)).toHaveText(/No results|of/);

  const { violations } = await new AxeBuilder({ page }).include('.find-bar').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
});
