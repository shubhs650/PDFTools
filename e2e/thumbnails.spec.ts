import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M2-08: the left pane framework and the Thumbnails pane (§5).

const list = (page: Page) => page.getByRole('listbox', { name: 'Page thumbnails' });
const thumb = (page: Page, label: string) =>
  list(page).getByRole('option', { name: label, exact: true });
const railThumbs = (page: Page) =>
  page.getByRole('complementary', { name: 'Navigation panes' }).getByRole('button', {
    name: 'Thumbnails',
  });
const pageBox = (page: Page) =>
  page
    .getByRole('contentinfo', { name: 'Status bar' })
    .getByRole('textbox', { name: 'Page number' });

async function openStandIn(page: Page, pdfs: { contract(n: number): Buffer }) {
  await page.goto('/');
  await drop(page, [{ name: 'contract.pdf', b64: pdfs.contract(2000).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
}

test('thumbnails of the stand-in: images load, click and page jumps keep them in step', async ({
  page,
  pdfs,
}) => {
  await openStandIn(page, pdfs);
  await expect(page.getByRole('region', { name: 'Thumbnails' })).toBeVisible();
  await expect(thumb(page, '1')).toHaveAttribute('aria-selected', 'true');
  await expect(thumb(page, '1').locator('img')).toBeVisible();
  // Virtualized: only the items near the view exist.
  expect(await list(page).getByRole('option').count()).toBeLessThan(30);

  await thumb(page, '3').click();
  await expect(pageBox(page)).toHaveValue('3');
  await expect(thumb(page, '3')).toHaveAttribute('aria-selected', 'true');

  // A jump in the document brings its thumbnail into the list.
  await pageBox(page).fill('1500');
  await pageBox(page).press('Enter');
  await expect(thumb(page, '1,500')).toHaveAttribute('aria-selected', 'true');
  await expect(thumb(page, '1,500')).toBeInViewport();
  await expect(thumb(page, '1,500').locator('img')).toBeVisible();

  // Scrolling the list to the end renders the last items.
  await list(page).evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(thumb(page, '2,000')).toBeInViewport();
  await expect(thumb(page, '2,000').locator('img')).toBeVisible({ timeout: 10_000 });
});

test('thumbnails and the pane are keyboard-only operable', async ({ page, pdfs }) => {
  await openStandIn(page, pdfs);
  const rail = railThumbs(page);
  await expect(rail).toHaveAttribute('aria-pressed', 'true');
  await rail.focus();
  await page.keyboard.press('Enter'); // the pane shown: closes the area
  await expect(page.getByTestId('left-pane')).toBeHidden();
  await expect(rail).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Enter'); // opens it, focus goes into the pane
  await expect(thumb(page, '1')).toBeFocused();
  // The document area just narrowed: let the view re-fit before jumping.
  await cap(page, 'view', 'settle');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(thumb(page, '3')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(pageBox(page)).toHaveValue('3');
  await expect(thumb(page, '3')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(thumb(page, '2,000')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(pageBox(page)).toHaveValue('2,000');
  await page.keyboard.press('Home');
  await expect(thumb(page, '1')).toBeFocused();

  await page.keyboard.press('Escape'); // back to the rail button
  await expect(rail).toBeFocused();

  // The resizer: a focusable separator with a value.
  const resizer = page.getByRole('separator', { name: 'Resize the navigation pane' });
  await resizer.focus();
  const before = Number(await resizer.getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowRight');
  await expect(resizer).toHaveAttribute('aria-valuenow', String(before + 16));
  await page.keyboard.press('End');
  await expect(resizer).toHaveAttribute('aria-valuenow', '480');
  expect(Math.round((await page.getByTestId('left-pane').boundingBox())?.width ?? 0)).toBe(480);

  // The close button closes the area and returns to the rail.
  await page.getByRole('button', { name: 'Close the navigation pane' }).click();
  await expect(page.getByTestId('left-pane')).toBeHidden();
  await expect(rail).toBeFocused();
});

test('the pane can be resized with the pointer', async ({ page, pdfs }) => {
  await openStandIn(page, pdfs);
  const resizer = page.getByTestId('pane-resizer');
  const box = await resizer.boundingBox();
  if (!box) throw new Error('no resizer');
  const width = Number(await resizer.getAttribute('aria-valuenow'));
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + 100, { steps: 5 });
  await page.mouse.up();
  await expect(resizer).toHaveAttribute('aria-valuenow', String(width + 60));
});

test('axe finds no violations with the Thumbnails pane open', async ({ page, pdfs }) => {
  await openStandIn(page, pdfs);
  await expect(thumb(page, '1').locator('img')).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
});
