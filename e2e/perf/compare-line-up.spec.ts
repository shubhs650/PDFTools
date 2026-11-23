import type { Page } from '@playwright/test';
import { corpusFile, compareSide, dropOn } from '../support/compare.ts';
import { expect, test } from '../support/fixtures.ts';

// M12-26 (ADR-033, rule 1): lining up a sheet of the dense A1 pair (14, 85,000
// segments) by hand — Line up on the floating bar, two point pairs picked in
// Document A's and Document B's windows with snapping and the magnifier, the
// overlay redrawn live through each placement, Undo last point, Apply — adds
// no main-thread task over 100 ms (perf guard).

const view = (page: Page) => page.getByTestId('overlay-view');

async function drawn(page: Page): Promise<void> {
  await expect(view(page)).toHaveAttribute('data-complete', 'true', { timeout: 60_000 });
}

/** Moves over a side's window, then clicks there (snapping on, so the snap work is measured). */
async function pick(page: Page, side: 'a' | 'b', fx: number, fy: number): Promise<void> {
  const layer = page.getByTestId(`align-pick-${side}`);
  await expect(layer).toBeVisible();
  const box = await page.getByTestId(`review-window-${side}`).locator('.viewport').boundingBox();
  if (!box) throw new Error('no window');
  const x = box.x + box.width * fx;
  const y = box.y + box.height * fy;
  await page.mouse.move(x - 20, y - 10);
  await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.click(x, y);
}

test('lining up a dense A1 sheet by hand adds no long task', async ({ page, guard }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Compare', exact: true }).click();
  await page.getByRole('button', { name: 'PDF Overlay' }).click();
  await dropOn(compareSide(page, 'a'), [corpusFile('14', 'old', 'plot-a.pdf')]);
  await expect(compareSide(page, 'a').getByTestId('compare-file')).toHaveCount(1);
  await dropOn(compareSide(page, 'b'), [corpusFile('14', 'new', 'plot-b.pdf')]);
  await expect(page.getByTestId('compare-pairing')).toHaveAttribute('data-status', 'done', {
    timeout: 60_000,
  });
  await page
    .getByTestId('compare-input')
    .getByRole('button', { name: 'Compare', exact: true })
    .click();
  await drawn(page);
  await expect(page.getByTestId('review-window-b').locator('.page')).not.toHaveCount(0);

  await guard.startMeasuring();
  await page
    .getByRole('toolbar', { name: 'Overlay controls' })
    .getByRole('button', { name: 'Line up' })
    .click();
  const bar = page.getByTestId('line-up-bar');
  await expect(bar).toHaveAttribute('data-step', '1');
  await pick(page, 'a', 0.3, 0.35);
  await pick(page, 'b', 0.3, 0.35);
  await expect(bar).toHaveAttribute('data-step', '3');
  await drawn(page);
  await pick(page, 'a', 0.7, 0.65);
  await pick(page, 'b', 0.7, 0.65);
  await expect(bar).toHaveAttribute('data-step', '4');
  await drawn(page);
  await bar.getByRole('button', { name: 'Undo last point' }).click();
  await pick(page, 'b', 0.7, 0.65);
  await drawn(page);
  await bar.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(bar).toHaveCount(0);
  await expect(
    page.locator('.overlay-sheet[aria-selected="true"] .overlay-sheet-align'),
  ).toHaveAttribute('data-status', 'manual');
  await drawn(page);
});
