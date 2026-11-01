import type { Page } from '@playwright/test';
import { cap, dropStaged, stage, type DropFile } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// Rule 1 / §12 (M1-13): opening files causes no main-thread task > 100 ms
// (the perf project's guard fails the test otherwise). The first open also
// starts PDFium in the Render worker; that engine start is measured too.

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');

async function openMeasured(page: Page, files: DropFile[]): Promise<number> {
  await stage(page, files);
  const t0 = await page.evaluate(() => performance.now());
  await dropStaged(page);
  await expect(tabs(page)).toHaveCount(files.length);
  return Math.round((await page.evaluate(() => performance.now())) - t0);
}

test('dropping three files, switching and closing them: no long tasks @smoke', async ({
  page,
  pdfs,
  guard,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await guard.startMeasuring();
  await openMeasured(page, [
    { name: 'a.pdf', b64: pdfs.simple(1).toString('base64') },
    { name: 'b.pdf', b64: pdfs.simple(2).toString('base64') },
    { name: 'c.pdf', b64: pdfs.simple(3).toString('base64') },
  ]);
  for (const i of [0, 2, 1]) await tabs(page).nth(i).click();
  for (const name of ['a.pdf', 'b.pdf', 'c.pdf'])
    await page.getByRole('button', { name: `Close ${name}` }).click();
  await expect(page.getByTestId('start-screen')).toBeVisible();
});

test('opening the 2,000-page stand-in: no long tasks', async ({ page, pdfs, guard }) => {
  await page.goto('/');
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await guard.startMeasuring();
  const ms = await openMeasured(page, [
    { name: 'contract.pdf', b64: pdfs.contract(2000).toString('base64') },
  ]);
  test.info().annotations.push({ type: 'open-ready-ms', description: String(ms) });
  expect(((await cap(page, 'open', 'state')) as { pageCounts: number[] }).pageCounts).toEqual([
    2000,
  ]);
});
