import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { annotatedPdf } from './fixtures/generate.ts';
import { drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { skipReviewerPrompt, startShots } from './support/shots.ts';

// M10-08·O9 (ADR-027 D-47): Density, Comfortable (default) or Compact, from View →
// Window → Compact Density and File → Settings → Appearance. Stored on this device next
// to the theme, applied before the first paint, listed on the Privacy page, reset by
// Clear all local data. Compact only changes spacing: rows and paddings in panes, lists,
// menus and dialogs, and the ribbon's group spacing. Nothing moves, the header and the
// ribbon keep their heights, and no target is smaller than 24 × 24 px (WCAG 2.2 SC 2.5.8).

const DENSITY_KEY = 'pdftools.density';
const TABS = ['Home', 'View', 'Comment', 'Measure', 'Organize', 'Convert', 'Protect', 'Help'];

const html = (page: Page) => page.locator('html');
const backstage = (page: Page) => page.getByTestId('backstage');
const stored = (page: Page) => page.evaluate((k) => localStorage.getItem(k), DENSITY_KEY);
const viewToggle = (page: Page) =>
  page.getByRole('toolbar', { name: 'View commands' }).getByRole('button', {
    name: 'Compact Density',
  });
const height = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => el.getBoundingClientRect().height);
const box = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, height: r.height };
    });

async function densityChoice(page: Page) {
  if (!(await backstage(page).isVisible())) await page.getByTestId('file-tab').click();
  await backstage(page).getByRole('button', { name: 'Settings', exact: true }).click();
  const group = backstage(page).getByRole('group', { name: 'Density' });
  await expect(group).toBeVisible();
  return group;
}

async function openAnnotated(page: Page) {
  await drop(page, [{ name: 'drawing.pdf', b64: Buffer.from(annotatedPdf()).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
}

/** Opens the Bookmarks pane and the context menu of its first bookmark. */
async function bookmarkMenu(page: Page) {
  const rail = page.locator('.left-rail-icons');
  if (
    (await rail.getByRole('button', { name: 'Bookmarks' }).getAttribute('aria-pressed')) !== 'true'
  )
    await rail.getByRole('button', { name: 'Bookmarks' }).click();
  await page.locator('.bookmark').first().click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  return menu;
}

/** What Compact changes, measured: menu rows, the pane header, a dialog's padding. */
async function spacing(page: Page) {
  const menu = await bookmarkMenu(page);
  const menuRow = await menu
    .getByRole('menuitem')
    .first()
    .evaluate((el) => el.getBoundingClientRect().height);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  const paneHeader = await height(page, '.left-pane .pane-header');
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+P');
  const print = page.getByRole('dialog', { name: 'Print' });
  await expect(print).toBeVisible();
  const dialogPad = await print.evaluate((el) => getComputedStyle(el).paddingTop);
  await page.keyboard.press('Escape');
  await expect(print).toBeHidden();
  return { menuRow, paneHeader, dialogPad };
}

test('View → Compact Density and Settings → Appearance switch the density at once; it survives a reload @smoke', async ({
  page,
}) => {
  await startShots(page, 'light', 1366);
  await openAnnotated(page);
  const header = await box(page, '.app-banner');
  const ribbon = await box(page, '.ribbon-panel');
  const document = await box(page, '.document-area');

  // Comfortable by default: nothing stored, no attribute, 32 px menu rows.
  await expect(html(page)).not.toHaveAttribute('data-density', /.*/);
  expect(await stored(page)).toBeNull();
  expect(await spacing(page)).toEqual({ menuRow: 32, paneHeader: 36, dialogPad: '24px' });

  // View → Window → Compact Density: a toggle.
  await page.getByRole('tab', { name: 'View', exact: true }).click();
  await expect(viewToggle(page)).toHaveAttribute('aria-pressed', 'false');
  await viewToggle(page).click();
  await expect(html(page)).toHaveAttribute('data-density', 'compact');
  await expect(viewToggle(page)).toHaveAttribute('aria-pressed', 'true');
  expect(await stored(page)).toBe('compact');
  expect(await spacing(page)).toEqual({ menuRow: 24, paneHeader: 28, dialogPad: '16px' });

  // Nothing moves: the header, the ribbon and the document start where they did.
  expect(await box(page, '.app-banner')).toEqual(header);
  expect(await box(page, '.ribbon-panel')).toEqual(ribbon);
  expect((await box(page, '.document-area')).top).toBe(document.top);

  // Applied before the first paint after a reload (the boot script), then the module agrees.
  await page.reload();
  await skipReviewerPrompt(page);
  await expect(html(page)).toHaveAttribute('data-density', 'compact');
  const group = await densityChoice(page);
  await expect(group.getByRole('radio', { name: 'Compact' })).toBeChecked();
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);

  // Settings → Comfortable: back to the default, nothing stored, the View toggle follows.
  await group.getByRole('radio', { name: 'Comfortable' }).check();
  await expect(html(page)).not.toHaveAttribute('data-density', /.*/);
  expect(await stored(page)).toBeNull();
  await backstage(page).getByRole('button', { name: 'Back to the document' }).click();
  await page.getByRole('tab', { name: 'View', exact: true }).click();
  await expect(viewToggle(page)).toHaveAttribute('aria-pressed', 'false');
  // Switched live at 1280 px, the ribbon measures its groups again for the new spacing:
  // the View tab never scrolls sideways, in either direction.
  await page.setViewportSize({ width: 1280, height: 800 });
  const overflow = () =>
    page.locator('.ribbon-panel').evaluate((el) => el.scrollWidth - el.clientWidth);
  await viewToggle(page).click();
  await expect(html(page)).toHaveAttribute('data-density', 'compact');
  expect(await overflow()).toBeLessThanOrEqual(0);
  await viewToggle(page).click();
  await expect(html(page)).not.toHaveAttribute('data-density', /.*/);
  expect(await overflow()).toBeLessThanOrEqual(0);
});

for (const theme of ['light', 'dark'] as const)
  test(`Compact at 1280 px (${theme}): every tab fits, no target under 24 × 24 px, axe clean`, async ({
    page,
  }) => {
    await page.addInitScript((k) => {
      localStorage.setItem(k, 'compact');
    }, DENSITY_KEY);
    await startShots(page, theme, 1280);
    await openAnnotated(page);
    await expect(html(page)).toHaveAttribute('data-density', 'compact');
    for (const tab of TABS) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await expect(page.getByRole('toolbar', { name: `${tab} commands` })).toBeVisible();
      const f = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>('.ribbon-panel');
        if (!panel) throw new Error('no ribbon panel');
        const edge = panel.getBoundingClientRect().right;
        const small = [
          ...panel.querySelectorAll<HTMLElement>(
            // A split button's style arrow (M6-07) is one unit with its tool and the
            // same 10 px wide in Comfortable: density never changes it.
            '.ribbon-toolbar button:not(.ribbon-split-arrow)',
          ),
        ]
          .map((b) => ({
            name: b.getAttribute('aria-label') ?? b.textContent,
            r: b.getBoundingClientRect(),
          }))
          .filter(({ r }) => r.width > 0 && (r.width < 24 || r.height < 24))
          .map(({ name, r }) => `${name} ${String(r.width)}×${String(r.height)}`);
        return {
          overflow: panel.scrollWidth - panel.clientWidth,
          clipped: [...panel.querySelectorAll<HTMLElement>('.ribbon-toolbar > .ribbon-group')]
            .filter((g) => g.getBoundingClientRect().right > edge + 0.5)
            .map((g) => g.dataset.group),
          small,
        };
      });
      expect(f.clipped, tab).toEqual([]);
      expect(f.overflow, tab).toBeLessThanOrEqual(0);
      expect(f.small, tab).toEqual([]);
    }

    // Menus, panes and dialogs keep 24 px targets too.
    const menu = await bookmarkMenu(page);
    for (const h of await menu
      .getByRole('menuitem')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height)))
      expect(h).toBeGreaterThanOrEqual(24);
    await page.keyboard.press('Escape');
    for (const pane of ['Comments', 'Search Results']) {
      await page.locator('.left-rail-icons').getByRole('button', { name: pane }).click();
      const small = await page.locator('.left-pane').evaluate((el) =>
        [...el.querySelectorAll<HTMLElement>('button, input[type="checkbox"], input[type="radio"]')]
          .map((b) => b.closest('label') ?? b)
          .map((b) => b.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height < 24)
          .map((r) => r.height),
      );
      expect(small, pane).toEqual([]);
    }
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => v.id)).toEqual([]);
  });

test('the density is listed on the Privacy page and reset by Clear all local data', async ({
  page,
}) => {
  await page.addInitScript((k) => {
    localStorage.setItem(k, 'compact');
  }, DENSITY_KEY);
  await page.goto('/');
  await expect(html(page)).toHaveAttribute('data-density', 'compact');
  await page.getByTestId('file-tab').click();
  await backstage(page).getByRole('button', { name: 'Privacy', exact: true }).click();
  const row = backstage(page).getByRole('row', { name: /Density/ });
  await expect(row).toContainText('Local storage');
  await expect(row).toContainText(DENSITY_KEY);
  await expect(row).toContainText('Yes');

  await backstage(page).getByRole('button', { name: 'Settings', exact: true }).click();
  await backstage(page).getByRole('button', { name: 'Clear all local data…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Clear all local data?' });
  await expect(confirm).toContainText('density');
  await confirm.getByRole('button', { name: 'Clear data' }).click();
  await expect(confirm).toBeHidden();
  await expect(html(page)).not.toHaveAttribute('data-density', /.*/);
  expect(await stored(page)).toBeNull();
  await expect(
    (await densityChoice(page)).getByRole('radio', { name: 'Comfortable' }),
  ).toBeChecked();
});
