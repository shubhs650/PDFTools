import type { Page } from '@playwright/test';
import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// §5 / §12 (M1-15): zooming the A0 sheet to 100 %, 800 % and 6400 % causes no
// main-thread long task (perf guard) and shows sharp tiles soon after the zoom
// settles (target < 0.5 s on typical files; measured and reported).

const zoomBox = (page: Page) =>
  page.getByRole('contentinfo', { name: 'Status bar' }).getByRole('textbox', { name: 'Zoom' });
const QUIET_MS = 400;

test('A0 sheet at 800 %, 6400 % and 100 %: no long tasks; sharp tiles after each zoom', async ({
  page,
  pdfs,
  guard,
}) => {
  await page.goto('/');
  await drop(page, [{ name: 'a0.pdf', b64: pdfs.a0(20_000).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  await cap(page, 'view', 'settle', QUIET_MS);
  await guard.startMeasuring();
  const sharpMs: Record<string, number> = {};
  for (const z of ['800', '6400', '100']) {
    const t0 = await page.evaluate(() => performance.now());
    await zoomBox(page).fill(z);
    await zoomBox(page).press('Enter');
    await expect(zoomBox(page)).toHaveValue(z === '6400' ? '6,400%' : `${z}%`);
    await cap(page, 'view', 'settle', QUIET_MS);
    sharpMs[z] = Math.round((await page.evaluate(() => performance.now())) - t0 - QUIET_MS);
    expect(await cap(page, 'view', 'sharpVisiblePages')).toBeGreaterThan(0);
    expect(await cap(page, 'view', 'blankVisiblePages')).toBe(0);
  }
  test
    .info()
    .annotations.push({ type: 'sharp-after-zoom-ms', description: JSON.stringify(sharpMs) });
});
