import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { darkTheme } from './support/app.ts';
import { overlayDrawn, overlayOf } from './support/compare.ts';
import { expect, test } from './support/fixtures.ts';
import { skipReviewerPrompt } from './support/shots.ts';

// O1 compare an area (ADR-031 D-60, D-61): in a PDF Overlay result, a
// rectangle drawn on Document A's window and one on Document B's — on the
// same sheet or another, or typed in millimetres — open as a comparison tab
// of their own: an overlay of the two pages, aligned on what is inside the
// rectangles, with everything outside the region veiled, and a differences
// list that reports only inside it.

const panel = (page: Page) => page.getByTestId('area-panel');
const count = (page: Page) => page.getByTestId('diff-count');

/** Drags a rectangle across a window's draw layer, between two fractions of its page. */
async function drawOn(page: Page, side: 'a' | 'b', from: number, to: number): Promise<void> {
  const layer = page.getByTestId(`area-draw-${side}`);
  await expect(layer).toBeVisible();
  const box = await layer.boundingBox();
  if (!box) throw new Error('no draw layer');
  await page.mouse.move(box.x + box.width * from, box.y + box.height * from);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to, box.y + box.height * to, { steps: 4 });
  await page.mouse.up();
}

/** Types a rectangle (mm) and sets it on a side, the keyboard path. */
async function typeArea(
  page: Page,
  side: 'a' | 'b',
  [left, top, width, height]: [number, number, number, number],
): Promise<void> {
  await page.getByTestId('area-left').fill(String(left));
  await page.getByTestId('area-top').fill(String(top));
  await page.getByTestId('area-width').fill(String(width));
  await page.getByTestId('area-height').fill(String(height));
  await panel(page)
    .getByRole('button', { name: side === 'a' ? 'Set on Document A' : 'Set on Document B' })
    .click();
}

/** Waits until every sheet is detected; the number of differences in scope. */
async function detected(page: Page): Promise<number> {
  await expect(count(page)).toHaveAttribute('data-detected', '1', { timeout: 60_000 });
  return Number(await count(page).getAttribute('data-count'));
}

test.describe('compare an area', () => {
  test('pair 01: drawn on A and B, it opens a tab of its own with the area alone compared @smoke', async ({
    page,
  }) => {
    await overlayOf(page, '01');
    await skipReviewerPrompt(page);
    const whole = await detected(page);
    expect(whole).toBeGreaterThan(20);

    // Draw on Document A: B is next.
    await panel(page).getByRole('button', { name: 'Draw on Document A' }).click();
    await drawOn(page, 'a', 0.25, 0.6);
    await expect(page.getByTestId('area-a')).toHaveText(/Pair 01 RevA\.pdf, page 1: \d+ × \d+ mm/);
    await expect(page.getByTestId('area-mark-a')).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Draw on Document B' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Escape stops; the button draws again.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('area-draw-b')).toHaveCount(0);
    await panel(page).getByRole('button', { name: 'Draw on Document B' }).click();
    await drawOn(page, 'b', 0.27, 0.62);
    await expect(page.getByTestId('area-mark-b')).toBeVisible();

    const tabs = page.locator('[data-tab-kind="comparison"]');
    await expect(tabs).toHaveCount(1);
    await panel(page).getByRole('button', { name: 'Compare the areas' }).click();
    await expect(tabs).toHaveCount(2);
    await expect(
      page.getByRole('tab', { name: /Pair 01 RevA 1 ↔ Pair 01 RevB 1 \(area\)/ }),
    ).toHaveAttribute('aria-selected', 'true');

    // The area comparison: its own result, the area outlined, the rest veiled.
    const result = page.getByTestId('compare-result');
    await expect(result.getByRole('heading', { name: /PDF Overlay of an area/ })).toBeVisible();
    await expect(page.getByTestId('area-info')).toBeVisible();
    await expect(page.getByTestId('area-panel')).toHaveCount(0);
    await expect(result.getByRole('button', { name: 'New comparison' })).toHaveCount(0);
    await overlayDrawn(page);
    await expect(page.getByTestId('area-veil')).toBeVisible();
    await expect(page.getByTestId('area-region')).toHaveCount(1);
    await expect(page.getByTestId('area-mark-a')).toBeVisible();
    await expect(page.getByTestId('area-mark-b')).toBeVisible();
    // Aligned automatically from the two rectangles and the drawing inside them.
    await expect(page.locator('.overlay-sheet-align')).toHaveAttribute('data-status', 'auto');
    // Fewer differences than the whole sheet, all inside the area.
    const inArea = await detected(page);
    expect(inArea).toBeLessThan(whole);
    await expect(page.getByTestId('area-info').getByRole('alert')).toHaveCount(0);
  });

  test('pair 10: typed on one sheet of A and another sheet of B (the keyboard path)', async ({
    page,
  }) => {
    await overlayOf(page, '10');
    await typeArea(page, 'a', [20, 20, 120, 80]);
    await expect(page.getByTestId('area-a')).toHaveText(
      'Pair 10 RevA.pdf, page 1: 120 × 80 mm at 20, 20 mm',
    );
    // Another sheet for B: the sheet list moves, the rectangle on A stays.
    await page.getByTestId('overlay-sheets').focus();
    await page.keyboard.press('ArrowDown');
    await overlayDrawn(page);
    await typeArea(page, 'b', [22, 18, 118, 84]);
    await expect(page.getByTestId('area-b')).toHaveText(
      'Pair 10 RevB.pdf, page 2: 118 × 84 mm at 22, 18 mm',
    );
    // A rectangle off the page is refused.
    await typeArea(page, 'b', [20, 20, 5000, 20]);
    await expect(panel(page).getByRole('alert')).toHaveText(/fit on the page/);
    await expect(page.getByTestId('area-b')).toHaveText(/page 2: 118 × 84 mm/);

    await panel(page).getByRole('button', { name: 'Compare the areas' }).focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('tab', { name: /Pair 10 RevA 1 ↔ Pair 10 RevB 2 \(area\)/ }),
    ).toHaveAttribute('aria-selected', 'true');
    await overlayDrawn(page);
    await expect(page.getByTestId('area-info').getByTestId('area-b')).toHaveText(
      /Pair 10 RevB\.pdf, page 2/,
    );
    await detected(page);
  });

  test('axe: the area panel and an area comparison in light and dark @a11y', async ({ page }) => {
    const check = async (include: string): Promise<void> => {
      const r = await new AxeBuilder({ page }).include(include).analyze();
      expect(r.violations).toEqual([]);
    };
    for (const dark of [false, true]) {
      if (dark) await darkTheme(page);
      await overlayOf(page, '01');
      await typeArea(page, 'a', [40, 40, 100, 60]);
      await typeArea(page, 'b', [40, 40, 100, 60]);
      await check('[data-testid="area-panel"]');
      await panel(page).getByRole('button', { name: 'Compare the areas' }).click();
      await overlayDrawn(page);
      await check('[data-testid="area-info"]');
      await check('[data-testid="overlay-sheets"]');
    }
  });

  test('the ribbon command starts drawing on Document A', async ({ page }) => {
    await overlayOf(page, '01');
    await page.getByRole('button', { name: 'Overlay only', exact: false }).first().click();
    await page.getByRole('tab', { name: 'Compare', exact: true }).click();
    await page.getByRole('button', { name: 'Compare an Area' }).click();
    // Drawing happens in the Review layout: it comes back.
    await expect(page.getByTestId('area-draw-a')).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Draw on Document A' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
