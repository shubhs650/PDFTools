import { drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// M2-07: Quick Find on the 2,000-page stand-in — a common term (thousands of
// hits, streamed with highlights), then F3 through the results — never blocks
// the main thread (perf guard: no task > 100 ms).

test('Quick Find: common term, highlights, F3 x 30', async ({ page, pdfs, guard }) => {
  await page.goto('/');
  await drop(page, [{ name: 'contract.pdf', b64: pdfs.contract(2000).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await guard.startMeasuring();
  await page.keyboard.press('Control+F');
  const bar = page.getByRole('region', { name: 'Find in document' });
  const field = bar.getByRole('searchbox', { name: 'Find' });
  await field.fill('contractor');
  await field.press('Enter');
  await expect(bar.getByRole('status')).toHaveText(/^1 of /);
  await expect(page.locator('.find-hit--current').first()).toBeVisible();
  for (let i = 0; i < 30; i++) await field.press('F3');
  await expect(bar.getByRole('status')).toHaveText(/^31 of /);
  await expect(bar.getByRole('status')).toHaveText(/of 18,798$/, { timeout: 20_000 });
});
