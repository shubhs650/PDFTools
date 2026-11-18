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

test('typing never searches; Enter finds the needle far away; F3 and Shift+F3 walk the hits @smoke', async ({
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
  // The total needs the whole uncached search (~5 s here), not just the first hit.
  await expect(status(page)).toHaveText('1 of 3', { timeout: 20_000 });
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
  // Totals only once the search is done ("1 of N" shows while it streams).
  const finished = () => expect.poll(async () => (await findState(page)).status).toBe('done');
  await finished();
  const all = (await findState(page)).total;

  await bar(page).getByRole('button', { name: 'Match Case' }).click();
  await field(page).press('Enter'); // options changed: a new search
  await expect(status(page)).toHaveText('No results');

  await bar(page).getByRole('button', { name: 'Match Case' }).click();
  await bar(page).getByRole('button', { name: 'Whole Words Only' }).click();
  await field(page).fill('contract');
  await field(page).press('Enter');
  await expect(status(page)).toHaveText(/^1 of \d+/);
  await finished();
  expect((await findState(page)).total).toBeLessThan(all); // "contractor" no longer counts

  await field(page).fill('(');
  await field(page).press('Enter'); // not a regex: a literal "("
  await expect(status(page)).toHaveText(/No results|of/);

  const { violations } = await new AxeBuilder({ page }).include('.find-bar').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
});

// Pre-release audit bug 5: the bar belongs to the document shown.
test('another tab starts the bar afresh; with no document left it closes', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await drop(page, [
    { name: 'three.pdf', b64: pdfs.simple(3).toString('base64') },
    { name: 'two.pdf', b64: pdfs.simple(2).toString('base64') },
  ]);
  const docTabs = page.getByRole('tablist', { name: 'Open documents' });
  await expect(docTabs.getByRole('tab')).toHaveCount(2);
  await docTabs.getByRole('tab', { name: /^three\.pdf/ }).click();
  await page.locator('[data-page="0"] img.page-preview').first().waitFor();
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+F');
  await field(page).fill('Page');
  await field(page).press('Enter');
  await expect(status(page)).toHaveText('1 of 3');
  await docTabs.getByRole('tab', { name: /^two\.pdf/ }).click();
  await expect(status(page)).toHaveText('');
  await expect(field(page)).toHaveValue('Page');
  await field(page).press('Enter');
  await expect(status(page)).toHaveText('1 of 2');

  for (const name of ['two.pdf', 'three.pdf'])
    await page.getByRole('button', { name: `Close ${name}` }).click();
  await drop(page, [{ name: 'one.pdf', b64: pdfs.simple(1).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').first().waitFor();
  await expect(bar(page)).toBeHidden();
});

// Pre-release audit bug 12: an Advanced Search result leaves the bar's own query alone; F3 still walks it.
test('an Advanced Search result keeps the bar query; F3 walks its hits; Ctrl+F starts afresh', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await drop(page, [{ name: 'three.pdf', b64: pdfs.simple(3).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').first().waitFor();
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+F');
  await field(page).fill('mine');
  await field(page).press('Escape');
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+Shift+F');
  const pane = page.getByRole('region', { name: 'Search Results' });
  await pane.getByRole('searchbox', { name: 'Search for' }).fill('Page');
  await pane.getByRole('searchbox', { name: 'Search for' }).press('Enter');
  await expect(pane.getByRole('status')).toHaveText('3 results');
  await pane.getByRole('listbox', { name: 'Search results' }).locator('[data-row="1"]').click();
  await expect(page.locator('[data-page="0"] .find-hit--current')).toBeVisible();
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('F3');
  await expect(pageBox(page)).toHaveValue('2');
  await expect(page.locator('[data-page="1"] .find-hit--current')).toBeVisible();
  await page.keyboard.press('Control+F');
  await expect(field(page)).toHaveValue('mine');
  await expect(status(page)).toHaveText('');
});
