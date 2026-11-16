import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { cap, darkTheme } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { openSample } from './support/shots.ts';

// M10-06 (ADR-027 D-47; review R5, R11): panes, the File backstage, dialogs, menus and the
// status bar polished in place. No pane, dialog or command moves.

const backstage = (page: Page) => page.getByTestId('backstage');
const statusBar = (page: Page) => page.getByRole('contentinfo', { name: 'Status bar' });

const css = (page: Page, selector: string, prop: string, pseudo?: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el, [p, ps]) => getComputedStyle(el, ps === '' ? null : ps).getPropertyValue(p), [
      prop,
      pseudo ?? '',
    ] as const);

for (const theme of ['light', 'dark'] as const)
  test(`backstage column, Settings cards, a dialog's title row and sticky footer, status groups (${theme}) @smoke`, async ({
    page,
  }) => {
    if (theme === 'dark') await darkTheme(page);
    await page.goto('/');
    await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
    await openSample(page, 3);

    // Status bar (R11): page navigation and zoom are framed groups.
    const pageNav = statusBar(page).getByRole('group', { name: 'Page navigation' });
    await expect(pageNav).toBeVisible();
    for (const g of [pageNav, statusBar(page).getByRole('group', { name: 'Zoom' }).first()]) {
      expect(await g.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('1px');
      expect(await g.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('8px');
    }

    // Print (a long dialog at 800 px): 12 px corners, its buttons in view without scrolling.
    await page.getByTestId('document-view').focus();
    await page.keyboard.press('Control+P');
    const print = page.getByRole('dialog', { name: 'Print' });
    await expect(print).toBeVisible();
    expect(await css(page, '.ui-dialog', 'border-top-left-radius')).toBe('12px');
    await expect(print.getByRole('button', { name: 'Print', exact: true })).toBeInViewport({
      ratio: 1,
    });
    expect(await css(page, '.ui-dialog-footer', 'position')).toBe('sticky');
    // The title bar's Close (×) sits on the title's row.
    const title = await print.getByRole('heading', { name: 'Print' }).boundingBox();
    const close = await print.locator('.ui-dialog-close').boundingBox();
    if (!title || !close) throw new Error('the title row is not laid out');
    expect(Math.abs(title.y + title.height / 2 - (close.y + close.height / 2))).toBeLessThan(4);
    await page.keyboard.press('Escape');
    await expect(print).toBeHidden();

    // Backstage (Q2): a surface column, not the brand; the current section is marked by an
    // accent bar as well as its tint; the product mark at the top is decorative.
    await page.getByTestId('file-tab').click();
    await expect(backstage(page)).toBeVisible();
    const nav = backstage(page).getByRole('navigation');
    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(await nav.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(bodyBg);
    await expect(nav.locator('.backstage-brand')).toHaveAttribute('aria-hidden', 'true');
    const current = nav.locator('[aria-current="page"]');
    await expect(current).toHaveText('New');
    expect(
      await css(page, '.backstage-item[aria-current="page"]', 'border-left-width', '::before'),
    ).toBe('3px');

    // New, Open … : the command as a card.
    const tile = backstage(page).locator('.backstage-action').getByRole('button', { name: 'New' });
    await expect(tile).toBeVisible();
    expect(await tile.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('8px');

    // Settings (R5): each group a card.
    await nav.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(current).toHaveText('Settings');
    const cards = backstage(page).locator('.settings-sections > *');
    await expect(cards).toHaveCount(3);
    for (const radius of await cards.evaluateAll((els) =>
      els.map((el) => getComputedStyle(el).borderTopLeftRadius),
    ))
      expect(radius).toBe('8px');
    const axe = await new AxeBuilder({ page }).include('[data-testid="backstage"]').analyze();
    expect(axe.violations).toEqual([]);
  });
