import type { Page } from '@playwright/test';
import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// Rule 1 / ADR-004 decision 3 (M1-17): progressive previews of the dense A0
// sheet under zoom thrash cause no main-thread long task; slice lengths are
// reported (owner drawings: measure and report, ADR-002).

const view = (page: Page, method: string, ...args: unknown[]) => cap(page, 'view', method, ...args);

test('dense A0 zoom thrash with progressive previews: no long tasks', async ({
  page,
  pdfs,
  guard,
}) => {
  await page.goto('/');
  await drop(page, [{ name: 'dense.pdf', b64: pdfs.a0(200_000).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  await view(page, 'settle');
  await guard.startMeasuring();
  await view(page, 'reset');
  for (const z of [0.05, 0.2, 0.08, 0.15, 0.06, 0.25, 0.1, 1, 4, 0.3]) {
    await view(page, 'zoom', z);
    await page.waitForTimeout(20);
  }
  await view(page, 'settle');
  const stats = (await view(page, 'stats')) as { progressive: unknown };
  test
    .info()
    .annotations.push({ type: 'progressive', description: JSON.stringify(stats.progressive) });
  expect(await view(page, 'blankVisiblePages')).toBe(0);
});
