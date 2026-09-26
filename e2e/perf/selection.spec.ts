import type { Page } from '@playwright/test';
import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// M2-04: selecting and copying text never blocks the main thread (rule 1). The
// perf guard fails the test on any task > 100 ms after startMeasuring().

const view = (page: Page, method: string, ...args: unknown[]) => cap(page, 'view', method, ...args);

test('2,000-page stand-in: drag-select a page, Ctrl+A, Ctrl+C while scrolling', async ({
  page,
  context,
  pdfs,
  guard,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');
  await drop(page, [{ name: 'contract.pdf', b64: pdfs.contract(2000).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await view(page, 'settle');
  await guard.startMeasuring();

  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('no page');
  await page.mouse.move(box.x + box.width * 0.08, box.y + box.height * 0.06);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, box.y + Math.min(box.height, 850) * 0.95, {
    steps: 30,
  });
  await page.mouse.up();
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+C');
  // Most of the page's ~50 lines of text.
  await expect
    .poll(
      async () => (await page.evaluate(() => navigator.clipboard.readText())).split('\n').length,
    )
    .toBeGreaterThan(20);

  const scroll = view(page, 'autoScroll', 900, 3000);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+C');
  await scroll;
  await view(page, 'settle');
  expect(((await view(page, 'selection')) as { selection: unknown }).selection).not.toBeNull();
});

test('dense A0 sheet: Ctrl+A on a page without text, no long tasks', async ({
  page,
  pdfs,
  guard,
}) => {
  await page.goto('/');
  await drop(page, [{ name: 'a0.pdf', b64: pdfs.a0(200_000).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await view(page, 'settle');
  await guard.startMeasuring();
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+A');
  await view(page, 'zoom', 4);
  await view(page, 'settle');
  expect(((await view(page, 'selection')) as { selection: unknown }).selection).toBeNull();
});
