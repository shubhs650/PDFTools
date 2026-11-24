import type { Page } from '@playwright/test';
import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// M13-05 (D-69, ADR-034 Amendment 2, rule 1): Thin Lines on the A0 sheet. Turning it
// on and off, and zooming with it on, causes no main-thread long task (perf guard): the
// thin copy opens and its page is walked in the Render worker. Sharp tiles follow each
// step; the time until they do is measured and reported.

const bar = (page: Page) => page.getByRole('contentinfo', { name: 'Status bar' });
const zoomBox = (page: Page) => bar(page).getByRole('textbox', { name: 'Zoom' });
const toggle = (page: Page) => bar(page).getByRole('button', { name: 'Thin Lines' });
const QUIET_MS = 400;

test('Thin Lines on the A0 sheet: on, 800 %, 100 %, off; no long tasks, sharp tiles @smoke', async ({
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
  const step = async (name: string, act: () => Promise<void>) => {
    const t0 = await page.evaluate(() => performance.now());
    await act();
    await cap(page, 'view', 'settle', QUIET_MS);
    sharpMs[name] = Math.round((await page.evaluate(() => performance.now())) - t0 - QUIET_MS);
    expect(await cap(page, 'view', 'sharpVisiblePages')).toBeGreaterThan(0);
    expect(await cap(page, 'view', 'blankVisiblePages')).toBe(0);
  };
  await step('on', async () => {
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  });
  for (const z of ['800', '100']) {
    await step(z, async () => {
      await zoomBox(page).fill(z);
      await zoomBox(page).press('Enter');
      await expect(zoomBox(page)).toHaveValue(`${z}%`);
    });
  }
  // The tiles came from the thin copy: one copy, its one page walked.
  expect(await cap(page, 'view', 'thinLines')).toMatchObject({ copies: 1, opened: 1 });
  await step('off', async () => {
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  });
  // Off closes the copy (its parsed page and caches go with it).
  await expect.poll(() => cap(page, 'view', 'thinLines')).toMatchObject({ copies: 0 });
  test
    .info()
    .annotations.push({ type: 'thin-lines-sharp-ms', description: JSON.stringify(sharpMs) });
});
