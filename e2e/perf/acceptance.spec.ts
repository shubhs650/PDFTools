import type { Page } from '@playwright/test';
import { cap, dropStaged, stage } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// M1-28: the §12 targets the other perf scenarios do not measure (D-27).
// - App start, offline, from the service worker's cache (the installed-app
//   equivalent): usable UI < 2 s. Cold boot is exempt from the long-task
//   gate (ADR-001 B4), so measuring starts once the UI is usable.
// - Dense A0 drawing (self-made, typical density): first view < 2 s.
// Numbers are annotations, collected by scripts/acceptance.ts.

const status = (page: Page) => page.getByRole('contentinfo', { name: 'Status bar' });
const RUNS = 3;
const median = (xs: number[]): number =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

test('app start offline from the service worker cache: usable UI < 2 s', async ({
  page,
  context,
  guard,
}) => {
  test.setTimeout(120_000);
  await page.goto('/?sw');
  await expect(status(page).getByText('✓ Ready offline')).toBeVisible({ timeout: 60_000 });
  await context.setOffline(true);
  const runs: number[] = [];
  try {
    for (let i = 0; i < RUNS; i++) {
      await page.reload();
      // Usable: the start screen and the ribbon are there and File responds.
      await expect(page.getByTestId('start-screen')).toBeVisible();
      await page.getByTestId('file-tab').click();
      await expect(page.getByTestId('backstage')).toBeVisible();
      runs.push(Math.round(await page.evaluate(() => performance.now())));
      await page.keyboard.press('Escape');
      expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    }
    await guard.startMeasuring();
  } finally {
    await context.setOffline(false);
  }
  const ms = median(runs);
  test.info().annotations.push({ type: 'app-start-offline-ms', description: String(ms) });
  expect(ms).toBeLessThan(2000);
});

test('dense A0 sheet: first view < 2 s, then sharp tiles', async ({ page, pdfs, guard }) => {
  await page.goto('/');
  await expect(page.getByTestId('start-screen')).toBeVisible();
  // Warm the engine with a small file, so the number is the drawing, not PDFium's start.
  await stage(page, [{ name: 'warm.pdf', b64: pdfs.simple(1).toString('base64') }]);
  await dropStaged(page);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  await page.getByRole('button', { name: 'Close warm.pdf' }).click();
  await expect(page.getByTestId('start-screen')).toBeVisible();

  await stage(page, [{ name: 'a0.pdf', b64: pdfs.a0(20_000).toString('base64') }]);
  await guard.startMeasuring();
  const t0 = await page.evaluate(() => performance.now());
  await dropStaged(page);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const firstView = Math.round((await page.evaluate(() => performance.now())) - t0);
  await cap(page, 'view', 'settle', 400);
  const sharp = Math.round((await page.evaluate(() => performance.now())) - t0 - 400);
  expect(await cap(page, 'view', 'sharpVisiblePages')).toBeGreaterThan(0);
  test
    .info()
    .annotations.push(
      { type: 'a0-first-view-ms', description: String(firstView) },
      { type: 'a0-sharp-ms', description: String(sharp) },
    );
  expect(firstView).toBeLessThan(2000);
});
