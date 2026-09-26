import type { Page } from '@playwright/test';
import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// M2-08: the Thumbnails pane loading while the 2,000-page stand-in scrolls
// and jumps, and while its own list is flung to the end, never blocks the
// main thread (perf guard: no task > 100 ms). Thumbnails wait for the
// document to be quiet (ADR-012 decision 2).

const view = (page: Page, method: string, ...args: unknown[]) => cap(page, 'view', method, ...args);

test('thumbnails load while the document scrolls: no long tasks', async ({ page, pdfs, guard }) => {
  await page.goto('/');
  await drop(page, [{ name: 'contract.pdf', b64: pdfs.contract(2000).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  const list = page.getByRole('listbox', { name: 'Page thumbnails' });
  await expect(list.getByRole('option', { name: '1', exact: true }).locator('img')).toBeVisible();
  await guard.startMeasuring();

  await view(page, 'autoScroll', 900, 3000);
  await view(page, 'settle');
  for (let i = 0; i < 10; i++) {
    await list.evaluate((el, f) => {
      el.scrollTop = el.scrollHeight * f;
    }, i / 10);
    await page.waitForTimeout(150);
  }
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(list.getByRole('option', { name: '2,000', exact: true }).locator('img')).toBeVisible(
    { timeout: 10_000 },
  );
});
