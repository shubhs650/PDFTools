import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { BOOKMARK_WORD, COMMENT_WORD } from './fixtures/generate.ts';
import { drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M2-09: the Advanced Search pane (Ctrl+Shift+F, §6). Enter-only (rule 3).

const pane = (page: Page) => page.getByRole('region', { name: 'Search Results' });
const field = (page: Page) => pane(page).getByRole('searchbox', { name: 'Search for' });
const status = (page: Page) => pane(page).getByRole('status');
const results = (page: Page) => pane(page).getByRole('listbox', { name: 'Search results' });
const row = (page: Page, i: number) => results(page).locator(`[data-row="${String(i)}"]`);
const pageBox = (page: Page) =>
  page
    .getByRole('contentinfo', { name: 'Status bar' })
    .getByRole('textbox', { name: 'Page number' });
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');

async function openSearch(page: Page) {
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+Shift+F');
  await expect(field(page)).toBeFocused();
}

test('regex over the stand-in: exact total, rows far past the context cap get their context', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await drop(page, [{ name: 'contract.pdf', b64: pdfs.contract(300).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await openSearch(page);

  await field(page).pressSequentially('e[a-z]');
  await page.waitForTimeout(300);
  await expect(status(page)).toHaveText(''); // typing never searches
  await pane(page).getByRole('checkbox', { name: 'Regular Expressions' }).check();
  await field(page).press('Enter');
  await expect(status(page)).toHaveText(/^[\d,]+ results$/, { timeout: 30_000 });
  const total = Number((await status(page).textContent())?.replace(/\D/g, ''));
  expect(total).toBeGreaterThan(50_000);

  // Row 50,000 (past the 5,000 hits sent with context): scrolled to, it loads.
  await results(page).evaluate((el) => {
    el.scrollTop = 50_000 * 28 - 100;
  });
  await expect(row(page, 50_000)).toBeVisible();
  await expect(row(page, 50_000).locator('mark')).toHaveText(/^e[a-z]$/i, { timeout: 10_000 });

  // Keyboard: End goes to the last row; Enter on a hit scrolls to it and highlights it.
  await results(page).focus();
  await page.keyboard.press('End');
  await expect(row(page, total + 300 - 1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(pageBox(page)).toHaveValue('300');
  await expect(page.locator('[data-page="299"] .find-hit--current')).toBeVisible();
});

test('all open documents: grouped by document, a result in another tab opens it', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await drop(page, [
    { name: 'first.pdf', b64: pdfs.simple(2).toString('base64') },
    { name: 'second.pdf', b64: pdfs.annotated().toString('base64') },
  ]);
  await expect(tabs(page)).toHaveCount(2);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await openSearch(page);
  await field(page).fill('page');
  await pane(page).getByRole('radio', { name: 'All open documents' }).check();
  await field(page).press('Enter');
  await expect(status(page)).toHaveText('5 results');
  // The active document first; each has a header row.
  const rows = results(page).getByRole('option');
  await expect(rows.first()).toHaveText(/^second\.pdf \(3\)$/);
  await expect(results(page).getByRole('option', { name: 'first.pdf (2)' })).toBeVisible();
  await results(page)
    .getByRole('option', { name: /^Page 2 \(1\)/ })
    .last()
    .click();
  await expect(tabs(page).filter({ hasText: 'first.pdf' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(pageBox(page)).toHaveValue('2');

  // Closing a document drops its results.
  await page.keyboard.press('Control+Alt+W');
  await expect(tabs(page)).toHaveCount(1);
  await expect(results(page).getByRole('option', { name: 'first.pdf (2)' })).toHaveCount(0);
});

test('comment text and bookmark titles (read-only) are searched when asked', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await drop(page, [{ name: 'notes.pdf', b64: pdfs.annotated().toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await openSearch(page);
  await field(page).fill(COMMENT_WORD);
  await field(page).press('Enter');
  await expect(status(page)).toHaveText('No results'); // page text only by default

  await pane(page).getByRole('checkbox', { name: 'Comment Text' }).check();
  await field(page).press('Enter');
  await expect(status(page)).toHaveText('1 result');
  const comment = results(page).getByRole('option', { name: /^Comment, page 2:/ });
  await expect(comment).toContainText(`Please check the ${COMMENT_WORD} note`);
  await comment.click();
  await expect(pageBox(page)).toHaveValue('2');

  await pane(page).getByRole('checkbox', { name: 'Bookmark Titles' }).check();
  await field(page).fill(BOOKMARK_WORD);
  await field(page).press('Enter');
  await expect(status(page)).toHaveText('1 result');
  await results(page).focus();
  await page.keyboard.press('Enter');
  await expect(pageBox(page)).toHaveValue('3');
});

test('a new search cancels the running one; results survive switching panes; axe', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await drop(page, [{ name: 'contract.pdf', b64: pdfs.contract(2000).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await openSearch(page);
  await field(page).fill('e');
  await field(page).press('Enter');
  await expect(status(page)).toHaveText(/^Searching/);
  await field(page).fill('PDFTOOLS-NEEDLE');
  await field(page).press('Enter');
  await expect(status(page)).toHaveText('3 results', { timeout: 20_000 });

  const rail = page.getByRole('complementary', { name: 'Navigation panes' });
  await rail.getByRole('button', { name: 'Thumbnails' }).click();
  await expect(pane(page)).toBeHidden();
  await rail.getByRole('button', { name: 'Search Results' }).click();
  await expect(status(page)).toHaveText('3 results');
  await expect(results(page).getByRole('option')).toHaveCount(6);

  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
});
