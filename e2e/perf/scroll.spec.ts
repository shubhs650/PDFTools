import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { cap, dropStaged, firstPreviewAt, stage, watchFirstPreview } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// §12 / M1-14: scroll the 2,000-page stand-in at 900 px/s (the S5/S9 method)
// with the perf gate on. Numbers go to test-results/m1-scroll.json; the owner's
// machine is authoritative (ADR-002).

const view = (page: Page, method: string, ...args: unknown[]) => cap(page, 'view', method, ...args);

test('2,000-page stand-in: first preview, then 900 px/s with no blank page frames', async ({
  page,
  pdfs,
  guard,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');
  await stage(page, [{ name: 'contract.pdf', b64: pdfs.contract(2000).toString('base64') }]);
  await guard.startMeasuring();
  await watchFirstPreview(page);
  const t0 = await page.evaluate(() => performance.now());
  await dropStaged(page);
  const firstPreviewMs = Math.round((await firstPreviewAt(page)) - t0);
  await view(page, 'settle');
  await view(page, 'reset');

  const scroll900 = await view(page, 'autoScroll', 900, 5000);
  await view(page, 'settle');
  const after900 = await view(page, 'stats');
  await view(page, 'reset');
  const scroll3000 = await view(page, 'autoScroll', 3000, 3000);
  await view(page, 'settle');
  const after3000 = await view(page, 'stats');

  const result = {
    firstPreviewMs,
    scroll900,
    stats900: after900,
    scroll3000,
    stats3000: after3000,
    longTasks: await guard.longTasksOverLimit(),
  };
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/m1-scroll.json', JSON.stringify(result, null, 2));
  test.info().annotations.push({ type: 'm1-scroll', description: JSON.stringify(result) });

  // §12 target is 1.5 s on the owner's machine (authoritative, ADR-002). Shared
  // CI runners measure 1.50–1.54 s for the same build, so CI gets a 2 s margin;
  // the value is still recorded above. Final gating is set in M1-27.
  expect(firstPreviewMs).toBeLessThan(process.env.CI ? 2000 : 1500);
  expect((scroll900 as { blankFrames: number }).blankFrames).toBe(0);
});

test('jumping through the stand-in and zoom thrash: no long tasks', async ({
  page,
  pdfs,
  guard,
}) => {
  await page.goto('/');
  await stage(page, [{ name: 'contract.pdf', b64: pdfs.contract(2000).toString('base64') }]);
  await dropStaged(page);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await view(page, 'settle');
  await guard.startMeasuring();
  const height = (await view(page, 'scrollHeight')) as number;
  for (const f of [0.1, 0.3, 0.5, 0.7, 0.9, 0.2]) {
    await view(page, 'scrollTo', Math.round(height * f));
    await page.waitForTimeout(30);
  }
  for (const z of [0.5, 2, 1, 4, 0.25, 3, 1.5]) {
    await view(page, 'zoom', z);
    await page.waitForTimeout(40);
  }
  await view(page, 'settle');
  expect(await view(page, 'blankVisiblePages')).toBe(0);
});
