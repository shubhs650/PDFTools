import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { LINK_URL } from './fixtures/generate.ts';
import { drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M2-10: Bookmarks pane (ARIA tree), links and Previous / Next View.

const tree = (page: Page) => page.getByRole('tree', { name: 'Bookmarks' });
const item = (page: Page, name: string) => tree(page).getByRole('treeitem', { name, exact: true });
const pageBox = (page: Page) =>
  page
    .getByRole('contentinfo', { name: 'Status bar' })
    .getByRole('textbox', { name: 'Page number' });
const rail = (page: Page) =>
  page.getByRole('complementary', { name: 'Navigation panes' }).getByRole('button', {
    name: 'Bookmarks',
  });

async function open(page: Page, pdfs: { outlined(): Buffer }) {
  await page.goto('/');
  await drop(page, [{ name: 'outlined.pdf', b64: pdfs.outlined().toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
}

test('500-entry outline, keyboard only: expand, move, jump, collapse', async ({ page, pdfs }) => {
  await open(page, pdfs);
  await rail(page).focus();
  await page.keyboard.press('Enter');
  await expect(item(page, 'Part 1')).toBeFocused();
  await expect(tree(page).getByRole('treeitem')).toHaveCount(5); // lazily: top level only
  await expect(item(page, 'Part 1')).toHaveAttribute('aria-expanded', 'false');

  await page.keyboard.press('ArrowDown');
  await expect(item(page, 'Part 2')).toBeFocused();
  await page.keyboard.press('ArrowRight'); // expand
  await expect(item(page, 'Part 2')).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowRight'); // first child
  await expect(item(page, 'Section 2.1')).toBeFocused();
  await expect(item(page, 'Section 2.1')).toHaveAttribute('aria-level', '2');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(item(page, 'Item 2.3.1')).toBeFocused();
  await expect(item(page, 'Item 2.3.1')).toHaveAttribute('aria-level', '3');
  await expect(item(page, 'Item 2.3.1')).toHaveAttribute('aria-setsize', '10');
  await page.keyboard.press('Enter');
  await expect(pageBox(page)).toHaveValue('12');

  await page.keyboard.press('ArrowLeft'); // to the parent
  await expect(item(page, 'Section 2.3')).toBeFocused();
  await page.keyboard.press('ArrowLeft'); // collapse
  await expect(item(page, 'Section 2.3')).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('End');
  await expect(item(page, 'Part 5')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(item(page, 'Part 1')).toBeFocused();

  await page.getByRole('button', { name: 'Expand All' }).click();
  await expect(tree(page).getByRole('treeitem')).toHaveCount(500);
  await item(page, 'Item 5.9.10').click();
  await expect(pageBox(page)).toHaveValue('45');
  await page.getByRole('button', { name: 'Collapse All' }).click();
  await expect(tree(page).getByRole('treeitem')).toHaveCount(5);

  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
});

test('links jump; Alt+Left / Alt+Right walk the view history', async ({ page, pdfs }) => {
  await open(page, pdfs);
  const prev = page
    .getByRole('toolbar', { name: 'View commands' })
    .getByRole('button', { name: 'Previous View' });
  await page.getByRole('tab', { name: 'View' }).click();
  await expect(prev).toBeDisabled();

  await page.getByRole('button', { name: 'Link to page 30', exact: true }).click();
  await expect(pageBox(page)).toHaveValue('30');
  await expect(prev).toBeEnabled();
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(pageBox(page)).toHaveValue('1');
  await page.keyboard.press('Alt+ArrowRight');
  await expect(pageBox(page)).toHaveValue('30');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(pageBox(page)).toHaveValue('1');

  // A named destination (page 3, /Fit), then the page box: both recorded.
  await page.getByRole('button', { name: 'Link to page 3', exact: true }).click();
  await expect(pageBox(page)).toHaveValue('3');
  await pageBox(page).fill('20');
  await pageBox(page).press('Enter');
  await expect(pageBox(page)).toHaveValue('20');
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(pageBox(page)).toHaveValue('3');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(pageBox(page)).toHaveValue('1');
  // The jump to page 3 dropped the old forward entry (page 30).
  await page.keyboard.press('Alt+ArrowRight');
  await expect(pageBox(page)).toHaveValue('3');
});

test('an external link asks first, shows the full address and makes no request', async ({
  page,
  pdfs,
}) => {
  await open(page, pdfs);
  // Record what would be opened instead of opening it (the guard fails on any request).
  await page.evaluate(() => {
    const w = window as unknown as { opened: unknown[]; open: (...a: unknown[]) => null };
    w.opened = [];
    w.open = (...a: unknown[]) => {
      w.opened.push(a);
      return null;
    };
  });
  const link = page.getByRole('button', { name: `Link to ${LINK_URL}` });
  await link.click();
  const dialog = page.getByRole('dialog', { name: 'Open this link in your browser?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('link-url')).toHaveText(LINK_URL);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { opened: unknown[] }).opened)).toEqual(
    [],
  );

  await link.focus();
  await page.keyboard.press('Enter');
  await dialog.getByRole('button', { name: 'Open in Browser' }).click();
  expect(await page.evaluate(() => (window as unknown as { opened: unknown[] }).opened)).toEqual([
    [LINK_URL, '_blank', 'noopener,noreferrer'],
  ]);
});
