import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { THIN_SHEET, thinLinesSheet } from './fixtures/generate.ts';
import { darkTheme, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { skipReviewerPrompt } from './support/shots.ts';

// M13-05 (D-69, ADR-034 Amendment 2): Thin Lines draws every page line one device pixel
// wide, on screen only. Toggles: the status bar (before Enable Snapping), View › Page
// Display, Ctrl+5 (the installed app) and Ctrl+Alt+5, and Tell me. One setting for
// every document, kept on this device. Comments keep their widths.

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const bar = (page: Page) => page.getByRole('contentinfo', { name: 'Status bar' });
const statusToggle = (page: Page) => bar(page).getByRole('button', { name: 'Thin Lines' });
const ribbonToggle = (page: Page) =>
  page.locator('[data-command="view.thinLines"]').filter({ visible: true });

async function openSheet(page: Page, name = 'thin.pdf'): Promise<void> {
  await drop(page, [{ name, b64: b64(thinLinesSheet(`Thin Lines test sheet - ${name}`)) }]);
  await expect(
    page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab', { name }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const zoom = bar(page).getByRole('textbox', { name: 'Zoom', exact: true });
  await zoom.fill('100%');
  await zoom.press('Enter');
  await expect(zoom).toHaveValue('100%');
}

/**
 * The lines crossed going down a column of the page at `xPt`, as the screen shows it:
 * the ink of each (its darkness summed across it, in device px: a crisp black line
 * 1 px wide is 1.0), rounded to a tenth. The page is screenshotted and read back in
 * the browser.
 */
async function inkAcross(page: Page, xPt: number): Promise<number[]> {
  const shot = await page.locator('[data-page="0"] .page-content').screenshot();
  return page.evaluate(
    async ([png, x, size]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d');
      if (!g) return [];
      g.drawImage(img, 0, 0);
      const col = Math.round((x / size) * c.width);
      const d = g.getImageData(col, 0, 1, c.height).data;
      const lines: number[] = [];
      let ink = 0;
      for (let y = 0; y <= c.height; y++) {
        const dark =
          y < c.height
            ? 1 - ((d[y * 4] ?? 255) + (d[y * 4 + 1] ?? 255) + (d[y * 4 + 2] ?? 255)) / (3 * 255)
            : 0;
        if (dark > 0.05) ink += dark;
        else if (ink > 0) {
          // Text edges the column grazes are not lines.
          if (ink >= 0.3) lines.push(Math.round(ink * 10) / 10);
          ink = 0;
        }
      }
      return lines;
    },
    [shot.toString('base64'), xPt, THIN_SHEET.size] as const,
  );
}

/** Both page lines thin (1 device px) or at their own width; the comment's border never changes. */
async function expectLines(page: Page, thin: boolean): Promise<void> {
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const full = THIN_SHEET.width * dpr;
  // Two lines at the expected ink each (within a third of a pixel per pixel of width).
  const check = async (x: number, want: number) => {
    const got = await inkAcross(page, x);
    const ok =
      got.length === 2 && got.every((v) => Math.abs(v - want) <= 0.35 * Math.max(1, want / 3));
    return ok ? 'ok' : got;
  };
  await expect
    .poll(() => check(THIN_SHEET.linesX, thin ? 1 : full), { timeout: 10_000 })
    .toBe('ok');
  expect(await check(THIN_SHEET.commentX, full)).toBe('ok');
}

test('Thin Lines from the status bar draws page lines 1 device px; comments keep their width @smoke', async ({
  page,
}) => {
  await page.goto('/');
  await skipReviewerPrompt(page);
  await openSheet(page);
  // First, then Same-Size Count Numbers beside it (M14-07), then Enable Snapping; off,
  // with its shortcut in the tooltip and aria-keyshortcuts.
  const toggles = bar(page).locator('.status-toggle');
  await expect(toggles.nth(0)).toHaveAccessibleName('Thin Lines');
  await expect(toggles.nth(1)).toHaveAccessibleName('Same-Size Count Numbers');
  await expect(toggles.nth(2)).toHaveAccessibleName('Enable Snapping');
  await expect(statusToggle(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(statusToggle(page)).toHaveAttribute('aria-keyshortcuts', 'Control+5 Control+Alt+5');
  await expectLines(page, false);

  await statusToggle(page).click();
  await expect(statusToggle(page)).toHaveAttribute('aria-pressed', 'true');
  await expectLines(page, true);
  // Zooming in keeps them 1 device px.
  const zoom = bar(page).getByRole('textbox', { name: 'Zoom', exact: true });
  await zoom.fill('400%');
  await zoom.press('Enter');
  await expect(zoom).toHaveValue('400%');
  await page.evaluate(() => {
    document.querySelector('[data-page="0"] .page-content')?.scrollIntoView({ block: 'start' });
  });
  await zoom.fill('100%');
  await zoom.press('Enter');
  await expectLines(page, true);

  // The file is untouched: nothing to save.
  await expect(page.getByRole('tab', { name: /thin\.pdf/ })).not.toHaveAccessibleName(/modified/i);
  await statusToggle(page).click();
  await expect(statusToggle(page)).toHaveAttribute('aria-pressed', 'false');
  await expectLines(page, false);
});

test('Ctrl+Alt+5, Ctrl+5, the View ribbon and Tell me toggle it; kept on this device for every document', async ({
  page,
}) => {
  await page.goto('/');
  await skipReviewerPrompt(page);
  await openSheet(page);
  await page.getByTestId('document-view').focus();

  await page.keyboard.press('Control+Alt+5');
  await expect(statusToggle(page)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+5');
  await expect(statusToggle(page)).toHaveAttribute('aria-pressed', 'false');

  // View › Page Display, by keyboard (pressed state and the Filled icon follow).
  await page.getByRole('tab', { name: 'View' }).click();
  await expect(ribbonToggle(page)).toHaveAttribute('aria-pressed', 'false');
  await ribbonToggle(page).focus();
  await page.keyboard.press('Enter');
  await expect(ribbonToggle(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(statusToggle(page)).toHaveAttribute('aria-pressed', 'true');
  // (Its tooltip would cover the page in the picture measured.)
  await page.getByTestId('document-view').focus();
  await expectLines(page, true);

  // Tell me finds it in View › Page Display with its shortcut, and runs it.
  await page.keyboard.press('Alt+q');
  const box = page.getByRole('combobox', { name: 'Tell me what you want to do' });
  await box.fill('thin lines');
  await box.press('Enter');
  const first = page.getByTestId('tell-me').getByRole('option').first();
  await expect(first).toContainText('Thin Lines');
  await expect(first).toContainText('View › Page Display');
  await expect(first).toContainText('Ctrl+Alt+5');
  await box.press('Enter');
  await expect(statusToggle(page)).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Control+Alt+5');
  await expect(statusToggle(page)).toHaveAttribute('aria-pressed', 'true');

  // One setting for every document: a second file opens thin.
  await openSheet(page, 'second.pdf');
  await expectLines(page, true);

  // Kept on this device: still on after a reload.
  await page.reload();
  await openSheet(page);
  await expect(statusToggle(page)).toHaveAttribute('aria-pressed', 'true');
  await expectLines(page, true);
});

for (const theme of ['light', 'dark'] as const) {
  test(`Thin Lines toggles pass axe (${theme}) @a11y`, async ({ page }) => {
    if (theme === 'dark') await darkTheme(page);
    await page.goto('/');
    await skipReviewerPrompt(page);
    await openSheet(page);
    await statusToggle(page).click();
    await page.getByRole('tab', { name: 'View' }).click();
    await expect(ribbonToggle(page)).toHaveAttribute('aria-pressed', 'true');
    for (const scope of ['.status-bar', '.ribbon']) {
      const r = await new AxeBuilder({ page }).include(scope).analyze();
      expect(r.violations, scope).toEqual([]);
    }
  });
}
