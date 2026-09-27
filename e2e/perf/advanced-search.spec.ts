import { drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// M2-09 / §12: Advanced Search for a common term on the 2,000-page stand-in —
// first results under 1 s, complete under 15 s, the list scrolled through —
// with no main-thread task over 100 ms (perf guard).

test('Advanced Search: common term, first rows < 1 s, complete < 15 s', async ({
  page,
  pdfs,
  guard,
}) => {
  await page.goto('/');
  await drop(page, [{ name: 'contract.pdf', b64: pdfs.contract(2000).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+Shift+F');
  const pane = page.getByRole('region', { name: 'Search Results' });
  const field = pane.getByRole('searchbox', { name: 'Search for' });
  await field.fill('contractor');
  await guard.startMeasuring();
  const t0 = Date.now();
  await field.press('Enter');
  const list = pane.getByRole('listbox', { name: 'Search results' });
  await expect(list.getByRole('option').first()).toBeVisible();
  const firstMs = Date.now() - t0;
  await expect(pane.getByRole('status')).toHaveText(/^18,798 results$/, { timeout: 15_000 });
  const completeMs = Date.now() - t0;
  for (let i = 1; i <= 10; i++) {
    await list.evaluate((el, f) => {
      el.scrollTop = el.scrollHeight * f;
    }, i / 10);
    await page.waitForTimeout(100);
  }
  test.info().annotations.push({
    type: 'm2-advanced-search',
    description: JSON.stringify({ firstMs, completeMs }),
  });
  expect(firstMs).toBeLessThan(1000);
  expect(completeMs).toBeLessThan(15_000);
});
