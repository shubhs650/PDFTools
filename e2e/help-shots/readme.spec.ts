// The README's pictures (V1, ADR-029): `npm run readme:screenshots` walks the
// real app (the e2e build, English, 1366 × 800 at 2×) on the self-made sample
// documents (rule 13) and writes docs/images/<id>.webp, whole window, no
// callouts. Not part of CI: re-run it after a visible UI change, with Help's.
import type { Page } from '@playwright/test';
import { darkTheme } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';
import {
  REPORT,
  drag,
  fitPage,
  measuredDrawing,
  open,
  openCommentsPane,
  reviewedDrawing,
  ribbonTab,
  start,
  thumbnailsDrawn,
  toolbar,
} from './scenes.ts';
import { shoot } from './shoot.ts';

const DIR = 'docs/images';

test.describe.configure({ timeout: 120_000 });

async function reviewed(page: Page): Promise<void> {
  await reviewedDrawing(page);
  await openCommentsPane(page);
  await expect(page.getByTestId('comments-list').getByRole('option').first()).toBeVisible();
  await ribbonTab(page, 'Comment').click();
  await page.waitForTimeout(300);
}

test('readme window-light: a marked-up drawing with the Comments pane', async ({ page }) => {
  await reviewed(page);
  await shoot(page, 'window-light', { dir: DIR });
});

test('readme window-dark: the same in the dark theme', async ({ page }) => {
  await darkTheme(page);
  await reviewed(page);
  await shoot(page, 'window-dark', { dir: DIR });
});

test('readme measure: a distance and an area to scale', async ({ page }) => {
  await measuredDrawing(page);
  await ribbonTab(page, 'Measure').click();
  await shoot(page, 'measure', { dir: DIR });
});

test('readme redaction: marks and Pending Redactions', async ({ page }) => {
  await start(page);
  await open(page, REPORT);
  await fitPage(page);
  await ribbonTab(page, 'Protect').click();
  await drag(page, REPORT, [72, 842 - 492 - 4], [300, 842 - 492 - 4]);
  await toolbar(page, 'Protect').getByRole('button', { name: 'Mark for Redaction' }).click();
  const area = toolbar(page, 'Protect').getByRole('button', { name: 'Mark Area for Redaction' });
  await area.click();
  await drag(page, REPORT, [72, 842 - 410], [523, 842 - 360]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('complementary', { name: 'Pending Redactions' })).toContainText(
    '2 marks',
  );
  await shoot(page, 'redaction', { dir: DIR });
});

test('readme tables: Review and Extract finds the tables', async ({ page }) => {
  await start(page);
  await open(page, REPORT);
  await thumbnailsDrawn(page);
  await page.getByRole('listbox', { name: 'Page thumbnails' }).getByRole('option').nth(1).click();
  await ribbonTab(page, 'Convert').click();
  await toolbar(page, 'Convert').getByRole('button', { name: 'Review & Extract' }).click();
  const panel = page.getByRole('complementary', { name: 'Review & Extract (Beta)' });
  await expect(panel.getByRole('status')).toHaveText(/tables? found/, { timeout: 20_000 });
  await page.getByTestId('table-outline').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shoot(page, 'tables', { dir: DIR });
});

test('readme organize: the Organize tab with pages selected', async ({ page }) => {
  await start(page);
  await open(page, REPORT);
  await thumbnailsDrawn(page);
  await ribbonTab(page, 'Organize').click();
  const thumbs = page.getByRole('listbox', { name: 'Page thumbnails' }).getByRole('option');
  await thumbs.nth(1).click();
  await thumbs.nth(2).click({ modifiers: ['Shift'] });
  await page.evaluate(() => getSelection()?.removeAllRanges());
  await shoot(page, 'organize', { dir: DIR });
});
