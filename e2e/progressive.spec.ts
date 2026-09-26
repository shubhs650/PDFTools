import type { Page } from '@playwright/test';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M1-17: heavy previews go through the Render worker's progressive path, and
// a zoom or scroll cancels them between slices. Long tasks for this scenario
// are gated in e2e/perf/progressive.spec.ts.

interface Progressive {
  requested: number;
  done: number;
  cancelled: number;
  slices: number[];
  maxSliceMs: number[];
}

const view = (page: Page, method: string, ...args: unknown[]) => cap(page, 'view', method, ...args);
const progressive = async (page: Page) =>
  ((await view(page, 'stats')) as { progressive: Progressive }).progressive;

/** Preview width the zoom asks for: min(zoom in half-octave steps, 1024 px cap) × page width. */
function expectedPreviewWidth(zoom: number, width = 3370, height = 2384): number {
  const stepped = 2 ** (Math.floor(Math.log2(zoom) * 2) / 2);
  const s = Math.min(stepped, 1024 / Math.max(width, height));
  return Math.round(width * s);
}

test('the dense A0 sheet previews progressively; zoom thrash cancels stale renders', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await drop(page, [{ name: 'dense.pdf', b64: pdfs.a0(200_000).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  await view(page, 'settle');
  const first = await progressive(page);
  expect(first.requested).toBeGreaterThan(0);
  expect(first.done).toBeGreaterThan(0);
  expect(first.slices.some((n) => n > 1)).toBe(true); // it really ran in slices
  test.info().annotations.push({ type: 'slices', description: JSON.stringify(first) });

  // Below the 1024 px cap every zoom asks for a different preview size.
  await view(page, 'reset');
  const zooms = [0.05, 0.2, 0.08, 0.15, 0.06, 0.25, 0.1];
  for (const z of zooms) {
    await view(page, 'zoom', z);
    await page.waitForTimeout(15);
  }
  await view(page, 'settle');
  const thrash = await progressive(page);
  expect(thrash.cancelled).toBeGreaterThan(0);
  // No stale bitmap: the preview on screen is the one the final zoom asked for.
  const last = zooms.at(-1) ?? 1;
  await expect.poll(() => view(page, 'previewWidth', 0)).toBe(expectedPreviewWidth(last));
  expect(await view(page, 'blankVisiblePages')).toBe(0);
});

test('light pages keep the engine path (no progressive renders for a text page)', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await drop(page, [{ name: 'contract.pdf', b64: pdfs.contract(5).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  await view(page, 'settle');
  expect((await progressive(page)).requested).toBe(0);
});
