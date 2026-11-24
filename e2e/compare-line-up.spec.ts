import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { darkTheme } from './support/app.ts';
import { overlayOf, showCompareTips, uncertainOverlay } from './support/compare.ts';
import { expect, test } from './support/fixtures.ts';

// M12-26 (ADR-033, D-60): alignment made easy to find. On a sheet whose
// automatic alignment is uncertain, the sheet says "Check alignment", a banner
// across the overlay asks for a look, and Line up on the floating bar is
// marked; "Line up by hand" starts the guided steps, "It looks right" makes
// the sheet "Checked by you". The first comparison shows three tips once;
// Help shows them again.

const banner = (page: Page) => page.getByTestId('align-banner');
const status = (page: Page) =>
  page.locator('.overlay-sheet[aria-selected="true"] .overlay-sheet-align');
const tip = (page: Page) => page.getByTestId('compare-tip');

test.describe('a sheet that needs checking', () => {
  test('says Check alignment with a banner; It looks right makes it Checked by you', async ({
    page,
  }) => {
    await uncertainOverlay(page);
    await expect(status(page)).toHaveText('Check alignment');
    await expect(banner(page)).toContainText('This sheet may not be lined up correctly.');
    // Line up on the floating bar is marked while the sheet needs checking.
    await expect(page.getByTestId('line-up-button')).toHaveAttribute('data-attention', 'true');
    await expect(page.getByTestId('fold-summary-align')).toHaveText('Check alignment');

    await banner(page).getByRole('button', { name: 'It looks right' }).click();
    await expect(banner(page)).toHaveCount(0);
    await expect(status(page)).toHaveText('Checked by you');
    await expect(page.getByTestId('line-up-button')).not.toHaveAttribute('data-attention', 'true');
    await expect(page.getByTestId('fold-summary-align')).toHaveText('Checked by you');
  });

  test('Line up by hand in the banner starts the steps; Cancel brings the banner back', async ({
    page,
  }) => {
    await uncertainOverlay(page);
    await page.getByRole('button', { name: 'Overlay only', exact: true }).click();
    await banner(page).getByRole('button', { name: 'Line up by hand' }).click();
    // The steps show above the windows, in Side by side, with the old drawing outlined.
    const bar = page.getByTestId('line-up-bar');
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute('data-step', '1');
    await expect(bar.getByRole('listitem').first()).toHaveAttribute('aria-current', 'step');
    await expect(banner(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Side by side', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('review-window-a')).toHaveAttribute('data-line-up', 'true');
    await expect(page.getByTestId('review-window-a')).toContainText(
      'Click the point here, on the old drawing',
    );
    await bar.getByRole('button', { name: 'Cancel' }).click();
    await expect(bar).toHaveCount(0);
    await expect(banner(page)).toBeVisible();
    await expect(page.getByTestId('review-window-a')).not.toHaveAttribute('data-line-up', 'true');
  });

  test('Line up on the floating bar starts and leaves the steps', async ({ page }) => {
    await uncertainOverlay(page);
    const lineUp = page
      .getByRole('toolbar', { name: 'Overlay controls' })
      .getByRole('button', { name: 'Line up' });
    await lineUp.click();
    await expect(page.getByTestId('line-up-bar')).toBeVisible();
    await expect(lineUp).toHaveAttribute('aria-pressed', 'true');
    await lineUp.click();
    await expect(page.getByTestId('line-up-bar')).toHaveCount(0);
    await expect(banner(page)).toBeVisible();
  });

  for (const theme of ['light', 'dark'] as const)
    test(`the banner and the Alignment section pass axe (${theme}) @a11y`, async ({ page }) => {
      if (theme === 'dark') await darkTheme(page);
      await uncertainOverlay(page);
      await page.getByTestId('fold-align').click();
      const results = await new AxeBuilder({ page })
        .include('[data-testid="align-banner"]')
        .include('[data-testid="align-panel"]')
        .include('.overlay-sheets')
        .analyze();
      expect(results.violations).toEqual([]);
    });
});

test.describe('first-time tips', () => {
  test('three tips on the first comparison, once; Help shows them again', async ({
    page,
    context,
  }) => {
    await showCompareTips(page);
    await overlayOf(page, '01');
    // 1: the colours, beside the colour key, with the focus on Next.
    await expect(tip(page)).toHaveAttribute('data-tip', 'colours');
    await expect(tip(page)).toContainText('Tip 1 of 3');
    await expect(page.getByTestId('overlay-key')).toHaveAttribute('data-tip-target', 'true');
    await expect(tip(page).getByRole('button', { name: 'Next' })).toBeFocused();
    await page.keyboard.press('Enter');
    // 2: the differences list.
    await expect(tip(page)).toHaveAttribute('data-tip', 'differences');
    await expect(page.getByTestId('diff-pane')).toHaveAttribute('data-tip-target', 'true');
    await tip(page).getByRole('button', { name: 'Next' }).click();
    // 3: Line up, the last: Got it.
    await expect(tip(page)).toHaveAttribute('data-tip', 'lineUp');
    await expect(tip(page)).toContainText('Tip 3 of 3');
    await tip(page).getByRole('button', { name: 'Got it' }).click();
    await expect(tip(page)).toHaveCount(0);
    await expect(page.locator('[data-tip-target]')).toHaveCount(0);

    // Never again: another comparison after a reload shows none.
    await overlayOf(page, '01');
    await page.waitForTimeout(500);
    await expect(tip(page)).toHaveCount(0);

    // Help → "Show the Compare tips again": the comparison on screen shows them at once.
    const help = await context.newPage();
    await help.goto('/help#compare-alignment');
    await help.getByRole('button', { name: 'Show the Compare tips again' }).click();
    await expect(help.getByRole('status').filter({ hasText: 'Done.' })).toBeVisible();
    await help.close();
    await expect(tip(page)).toHaveAttribute('data-tip', 'colours');
    // Escape skips them.
    await page.keyboard.press('Escape');
    await expect(tip(page)).toHaveCount(0);
  });

  for (const theme of ['light', 'dark'] as const)
    test(`a tip passes axe (${theme}) @a11y`, async ({ page }) => {
      if (theme === 'dark') await darkTheme(page);
      await showCompareTips(page);
      await overlayOf(page, '01');
      await expect(tip(page)).toBeVisible();
      const results = await new AxeBuilder({ page })
        .include('[data-testid="compare-tip"]')
        .analyze();
      expect(results.violations).toEqual([]);
    });
});
