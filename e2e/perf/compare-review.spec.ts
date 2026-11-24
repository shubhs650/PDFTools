import type { Page } from '@playwright/test';
import { cap } from '../support/app.ts';
import { compareSide, dropOn, overlayOf, textFile } from '../support/compare.ts';
import { expect, test } from '../support/fixtures.ts';
import { skipReviewerPrompt } from '../support/shots.ts';

// M12-27 (ADR-033, rule 1): reviewing a comparison. Clicking through the
// close-out list zooms the linked windows to each comment (the overlay leads,
// A and B follow, one window's zoom per task); in the 500-page contract,
// Go to page jumps far down one side and the other follows by content, and a
// comment far down is zoomed to on both sides. None of it may add a
// main-thread task over 100 ms (perf guard).

const pane = (page: Page) => page.getByTestId('closeout-pane');

test('clicking through the close-out list zooms to each comment without long tasks (pair 19) @smoke', async ({
  page,
  guard,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await overlayOf(page, '19');
  await skipReviewerPrompt(page);
  await page.getByRole('button', { name: 'Close-out', exact: true }).click();
  await expect(pane(page)).toBeVisible();
  const rows = pane(page).locator('.closeout-row');
  await expect(rows).toHaveCount(5);
  await guard.startMeasuring();
  for (let round = 0; round < 2; round++)
    for (let i = 0; i < 5; i++) {
      await rows.nth(i).click();
      await expect(page.getByTestId('review-window-a').getByTestId('comment-flash')).toBeVisible();
      await page.waitForTimeout(250);
    }
  // The keyboard too.
  await pane(page).getByTestId('closeout-list').focus();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);
  }
});

test('Go to page and a comment far down the 500-page text comparison add no long task', async ({
  page,
  guard,
}) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Compare', exact: true }).click();
  await page.getByRole('button', { name: 'Text Comparison' }).click();
  await dropOn(compareSide(page, 'a'), [textFile('17', 'old', 'Contract RevA.pdf')]);
  await expect(compareSide(page, 'a').getByTestId('compare-file')).toHaveCount(1, {
    timeout: 60_000,
  });
  await dropOn(compareSide(page, 'b'), [textFile('17', 'new', 'Contract RevB.pdf')]);
  await expect(compareSide(page, 'b').getByTestId('compare-file')).toHaveCount(1, {
    timeout: 60_000,
  });
  await page
    .getByTestId('compare-input')
    .getByRole('button', { name: 'Compare', exact: true })
    .click();
  await expect(page.getByTestId('compare-result')).toHaveAttribute('data-status', 'done', {
    timeout: 240_000,
  });
  await expect(page.getByTestId('text-view-a').locator('.page').first()).toBeVisible();
  await skipReviewerPrompt(page);
  const a = (await page.getByTestId('text-view-a').getAttribute('data-doc-id')) ?? '';
  // A small comment far down Document A (small: the windows zoom in to it).
  const id = (await cap(page, 'annotate', 'create', a, 420, {
    type: 5, // Square
    rect: { origin: { x: 100, y: 300 }, size: { width: 16, height: 16 } },
    color: 'transparent',
    strokeColor: '#e00000',
    strokeWidth: 1,
    contents: 'Check this clause',
  })) as string;
  await page.getByRole('button', { name: 'Close-out', exact: true }).click();
  await expect(pane(page).locator(`.closeout-row[data-id="${id}"]`)).toBeVisible();
  await guard.startMeasuring();

  const counterA = page.getByTestId('text-page-a');
  const counterB = page.getByTestId('text-page-b');
  for (const to of ['400', '20', '250']) {
    await counterA.click();
    await page.getByTestId('text-page-input-a').fill(to);
    await page.getByTestId('text-page-input-a').press('Enter');
    await expect(counterA).toHaveAttribute('data-page', to);
    await expect
      .poll(async () => Math.abs(Number(await counterB.getAttribute('data-page')) - Number(to)))
      .toBeLessThan(15);
    await page.waitForTimeout(300);
  }
  // The comment far down: both sides scroll to it and zoom in.
  await pane(page).locator(`.closeout-row[data-id="${id}"]`).click();
  await expect(page.getByTestId('text-view-a').getByTestId('comment-flash')).toBeVisible({
    timeout: 10_000,
  });
  await expect(counterA).toHaveAttribute('data-page', '421');
  await page.waitForTimeout(500);
});
