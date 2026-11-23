import type { Page } from '@playwright/test';
import { dropOn } from '../support/compare.ts';
import { expect, test } from '../support/fixtures.ts';

// M12-24 (ADR-033): the input window of a long set. Every pairing row has two
// page pictures and the page picker is a grid of every page; the pictures are
// drawn in the Render worker only while on screen. Scrolling the pairing table
// to the end, opening the picker and stepping through Preview pair never block
// the main thread (perf guard: no task > 100 ms).

const PAGES = 120;
const input = (page: Page) => page.getByTestId('compare-input');
const rows = (page: Page) => page.getByTestId('compare-pairing-row');

test('a 120-sheet pairing table with page pictures scrolls without long tasks', async ({
  page,
  pdfs,
  guard,
}) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Compare', exact: true }).click();
  await page.getByRole('button', { name: 'PDF Overlay' }).click();
  // Different files (the same bytes twice would be one document): B has a page more.
  const a = pdfs.contract(PAGES).toString('base64');
  const b = pdfs.contract(PAGES + 1).toString('base64');
  await dropOn(input(page).getByTestId('compare-side-a'), [{ name: 'Set A.pdf', b64: a }]);
  await expect(input(page).getByTestId('compare-side-a').getByTestId('compare-file')).toHaveCount(
    1,
  );
  await dropOn(input(page).getByTestId('compare-side-b'), [{ name: 'Set B.pdf', b64: b }]);
  await expect(input(page).getByTestId('compare-pairing')).toHaveAttribute('data-status', 'done', {
    timeout: 120_000,
  });
  const sheets = await rows(page).count();
  expect(sheets).toBeGreaterThanOrEqual(PAGES + 1);
  await expect(rows(page).first().locator('img').first()).toBeVisible({ timeout: 30_000 });
  await guard.startMeasuring();

  // Down the table in steps, then to the end: the last row's pictures arrive.
  for (let i = 1; i <= 10; i++) {
    await input(page).evaluate((el, f) => {
      el.scrollTop = el.scrollHeight * f;
    }, i / 10);
    await page.waitForTimeout(120);
  }
  const last = rows(page).last();
  await last.scrollIntoViewIfNeeded();
  await expect(last.getByTestId('compare-pairing-picture-b').locator('img')).toBeVisible({
    timeout: 30_000,
  });
  await expect(input(page).getByRole('button', { name: 'Compare', exact: true })).toBeInViewport();

  // The page picker: a grid of every page, drawn as it scrolls.
  await last.getByTestId('compare-pairing-picture-b').click();
  const grid = page.getByTestId('compare-picker');
  await expect(grid.getByRole('button')).toHaveCount(PAGES + 2); // None and B's pages
  await expect(grid.locator('img').first()).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Escape');

  // Preview pair, stepping back through a few sheets.
  await page.getByRole('button', { name: `Preview sheet ${String(sheets)}` }).click();
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Previous pair' }).click();
  await expect(page.getByTestId('compare-pairview').locator('img')).toHaveCount(2, {
    timeout: 30_000,
  });
});
