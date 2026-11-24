import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { darkTheme } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M10-08·O6 (ADR-027): File › About lists what's new in each release, newest
// first; after an update a banner says so once, at the bottom right, without
// moving anything or taking focus. "See what's new" opens About at the list.

const KEY = 'pdftools.whatsNewSeen';
const LATEST_ID = 'v1.1.0';
const LATEST_TITLE = 'Version 1.1.0: compare revisions';
const FIRST_TITLE = 'Version 1.0.0, the first public release';
/** How many lines the newest release has (each PR of a release may add one). */
const LATEST_ITEMS = (
  JSON.parse(readFileSync('src/i18n/whatsnew.en.json', 'utf8')) as {
    releases: { items: string[] }[];
  }
).releases[0]?.items.length;

const backstage = (page: Page) => page.getByTestId('backstage');
const banner = (page: Page) => page.getByTestId('whats-new-banner');
const stored = (page: Page) => page.evaluate((k) => localStorage.getItem(k), KEY);

/** As after an update: this device last announced an older release. */
async function seenOlder(page: Page): Promise<void> {
  await page.addInitScript((k) => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem(k, 'beta-m9');
    }
  }, KEY);
}

const axe = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id);

test(
  "About lists what's new: 1.1.0 first, 1.0.0 under earlier versions (ADR-029, M12-22)",
  { tag: '@smoke' },
  async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-tab').click();
    await backstage(page).getByRole('button', { name: 'About', exact: true }).click();
    const section = backstage(page).getByTestId('whats-new');
    await expect(section.getByRole('heading', { name: "What's new" })).toBeVisible();

    const latest = section.getByTestId('whats-new-latest');
    await expect(latest.getByRole('heading', { name: LATEST_TITLE })).toBeVisible();
    await expect(latest).toContainText(/Released \w+ \d+, \d{4}|Released \d+/);
    await expect(latest.getByRole('listitem')).toHaveCount(LATEST_ITEMS ?? 0);
    await expect(latest).toContainText('PDF Overlay');

    // 1.0.0, the first public release, is folded under the earlier versions.
    const earlier = section.getByTestId('whats-new-earlier');
    await expect(earlier).toHaveCount(1);
    await earlier.locator('summary').click();
    await expect(earlier.getByRole('heading', { name: FIRST_TITLE })).toBeVisible();
    await expect(earlier).toContainText('Measure drawings to scale');
    await expect(earlier.getByRole('heading')).toHaveCount(1);

    // It sits between the actions and Built with.
    const headings = await backstage(page).getByTestId('about').locator('h3').allTextContents();
    expect(headings.slice(0, 2)).toEqual(["What's new", 'Built with']);
    expect(await axe(page)).toEqual([]);
  },
);

test(
  'a first visit records the release quietly: no banner',
  { tag: '@smoke' },
  async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible();
    await expect.poll(() => stored(page)).toBe(LATEST_ID);
    await expect(banner(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
  },
);

for (const theme of ['light', 'dark'] as const) {
  test(
    `after an update the banner shows once, moves nothing and opens About (${theme})`,
    {
      tag: '@smoke',
    },
    async ({ page }) => {
      if (theme === 'dark') await darkTheme(page);
      await page.setViewportSize({ width: 1280, height: 800 });
      await seenOlder(page);
      await page.goto('/');
      const card = banner(page);
      await expect(card).toBeVisible();
      await expect(card.getByRole('heading', { name: 'Triya PDF has been updated' })).toBeVisible();
      await expect(card).toContainText(LATEST_TITLE);
      expect(await stored(page)).toBe(LATEST_ID);

      // It takes no focus and no room: over the document area, above the status bar.
      expect(await card.evaluate((el) => el.contains(document.activeElement))).toBe(false);
      const box = await card.boundingBox();
      const status = await page.getByRole('contentinfo', { name: 'Status bar' }).boundingBox();
      const main = await page.locator('#document-panel').boundingBox();
      expect(box && status && main).toBeTruthy();
      if (box && status && main) {
        expect(box.y + box.height).toBeLessThanOrEqual(status.y);
        expect(box.x + box.width).toBeLessThanOrEqual(1280);
        expect(box.y).toBeGreaterThanOrEqual(main.y);
      }
      expect(await axe(page)).toEqual([]);

      // Keyboard: both buttons are reachable and named.
      await card.getByRole('button', { name: "See what's new" }).focus();
      await page.keyboard.press('Tab');
      await expect(card.getByRole('button', { name: "Close What's new" })).toBeFocused();

      // See what's new: About opens at the list, its heading focused and in view.
      await card.getByRole('button', { name: "See what's new" }).click();
      await expect(card).toHaveCount(0);
      const heading = backstage(page).getByRole('heading', { name: "What's new" });
      await expect(heading).toBeFocused();
      await expect(heading).toBeInViewport();
      await expect(backstage(page).getByRole('heading', { name: LATEST_TITLE })).toBeInViewport();

      // Shown once: not again after a reload.
      await page.reload();
      await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible();
      await expect(banner(page)).toHaveCount(0);
    },
  );
}

test('Close dismisses the banner; the Privacy page lists its record', async ({ page }) => {
  await seenOlder(page);
  await page.goto('/');
  await banner(page).getByRole('button', { name: "Close What's new" }).click();
  await expect(banner(page)).toHaveCount(0);

  await page.getByTestId('file-tab').click();
  await backstage(page).getByRole('button', { name: 'Privacy', exact: true }).click();
  const row = backstage(page).getByRole('row', { name: /What's new/ });
  await expect(row).toContainText('Local storage');
  await expect(row).toContainText(KEY);
  await expect(row).toContainText('Yes');
});
