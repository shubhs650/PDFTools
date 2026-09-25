import type { Page } from '@playwright/test';
import { cap, drop, dropStaged, stage } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M1-14: virtual scroll with a bounded preview under 256 px tiles.

interface Kind {
  requested: number;
  done: number;
  aborted: number;
  cached: number;
}
interface Stats {
  tiles: Kind;
  previews: Kind;
  cache: { bytes: number; entries: number; max: number };
}

const view = (page: Page, method: string, ...args: unknown[]) => cap(page, 'view', method, ...args);
const stats = async (page: Page) => (await view(page, 'stats')) as Stats;
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');

test('a document shows a preview at once, then sharp tiles; no long tasks', async ({
  page,
  pdfs,
  guard,
}) => {
  await page.goto('/');
  await stage(page, [{ name: 'contract.pdf', b64: pdfs.contract(200).toString('base64') }]);
  await guard.startMeasuring();
  await dropStaged(page);
  const viewport = page.getByTestId('document-view');
  await expect(viewport).toBeVisible();
  await expect(viewport).toHaveAccessibleName('contract.pdf');
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  await view(page, 'settle');
  expect(await view(page, 'sharpVisiblePages')).toBeGreaterThan(0);
  expect(await view(page, 'blankVisiblePages')).toBe(0);
  const s = await stats(page);
  expect(s.previews.done).toBeGreaterThan(0);
  expect(s.tiles.done).toBeGreaterThan(0);
  expect(await guard.longTasksOverLimit()).toEqual([]);
});

test('jumping through the document and zoom thrash abort stale tiles', async ({
  page,
  pdfs,
  guard,
}) => {
  await page.goto('/');
  await drop(page, [{ name: 'contract.pdf', b64: pdfs.contract(2000).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  await view(page, 'settle');
  await guard.startMeasuring();
  await view(page, 'reset');
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
  const s = await stats(page);
  expect(s.tiles.requested).toBeGreaterThan(0);
  expect(s.tiles.aborted).toBeGreaterThan(0);
  expect(await view(page, 'blankVisiblePages')).toBe(0);
  expect(await view(page, 'sharpVisiblePages')).toBeGreaterThan(0);
  expect(await guard.longTasksOverLimit()).toEqual([]);
});

test('switching tabs keeps each document’s images cached; coming back renders nothing new', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await drop(page, [
    { name: 'a.pdf', b64: pdfs.contract(20).toString('base64') },
    { name: 'b.pdf', b64: pdfs.simple(3).toString('base64') },
  ]);
  await expect(tabs(page)).toHaveCount(2);
  const preview = page.locator('[data-page="0"] img.page-preview');
  await expect(preview).toBeVisible();
  await view(page, 'settle');
  await tabs(page).nth(0).click();
  await expect(page.getByTestId('document-view')).toHaveAccessibleName('a.pdf');
  await expect(preview).toBeVisible();
  await view(page, 'settle');
  await tabs(page).nth(1).click();
  await expect(page.getByTestId('document-view')).toHaveAccessibleName('b.pdf');
  await expect(preview).toBeVisible();
  await view(page, 'settle');
  await view(page, 'reset');
  await tabs(page).nth(0).click();
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  await view(page, 'settle');
  const s = await stats(page);
  expect(s.previews.cached + s.tiles.cached).toBeGreaterThan(0);
  expect(s.previews.requested).toBe(0);
  expect(s.cache.bytes).toBeLessThanOrEqual(s.cache.max);
});

test('closing a document drops its cached images', async ({ page, pdfs }) => {
  await page.goto('/');
  await drop(page, [{ name: 'a.pdf', b64: pdfs.contract(20).toString('base64') }]);
  // Renders start only once the engine is up; settle measures quiet time after that.
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  await view(page, 'settle');
  const { activeId } = (await cap(page, 'open', 'state')) as { activeId: string };
  expect(await view(page, 'docCacheBytes', activeId)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Close a.pdf' }).click();
  await expect(page.getByTestId('start-screen')).toBeVisible();
  expect(await view(page, 'docCacheBytes', activeId)).toBe(0);
});
