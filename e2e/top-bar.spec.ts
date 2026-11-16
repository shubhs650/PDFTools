import AxeBuilder from '@axe-core/playwright';
import type { Page, Request } from '@playwright/test';
import { drop } from './support/app.ts';
import { isThirdParty } from './support/probes.ts';
import { expect, test, type Guard } from './support/fixtures.ts';

// M6-01 (ADR-021 D-35): brand, the OpenEngTools and GitHub links (new tabs, no
// request by the app, no document content), full screen of the whole app, and
// the magnet snapping toggle in the status bar. M10-08·O3 (ADR-027 D-47): the
// brand, Quick Access, File, the tabs and the top bar share one header row.

const FILE = 'Q3-budget-ZEBRA.pdf';

async function openDoc(page: Page, pdfs: { simple(n?: number): Buffer }) {
  await drop(page, [{ name: FILE, b64: pdfs.simple(2).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
}

/**
 * The two external sites are stubbed so nothing leaves the machine. Their
 * requests come from the new tabs (a top-level navigation the user asked for),
 * not from the app: they are checked here and then taken off the guard's list,
 * which keeps failing the test for anything the app page itself requests.
 */
async function stubExternalSites(page: Page, guard: Guard, origin: string) {
  const fromApp: string[] = [];
  page.on('request', (r: Request) => {
    if (isThirdParty(r.url(), origin)) fromApp.push(r.url());
  });
  for (const host of ['https://www.openengtools.com/**', 'https://github.com/**'])
    await page
      .context()
      .route(host, (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: '<title>stub</title>' }),
      );
  return {
    fromApp,
    /** Drops the new tabs' own requests from the guard (they are not the app's). */
    forgetPopups(): void {
      const external = (u: string) =>
        u.startsWith('https://www.openengtools.com/') || u.startsWith('https://github.com/');
      const keep = guard.thirdPartyRequests.filter((u) => !external(u));
      guard.thirdPartyRequests.length = 0;
      guard.thirdPartyRequests.push(...keep);
    },
  };
}

/** The header row's parts, left to right, as boxes (CSS px). */
const headerParts = (page: Page) =>
  page.evaluate(() => {
    const box = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`missing ${sel}`);
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, mid: r.top + r.height / 2 };
    };
    return [
      box('[data-testid="app-brand"]'),
      box('.quick-access'),
      box('[data-testid="file-tab"]'),
      box('.ribbon-tablist-wrap'),
      box('.top-bar-actions'),
    ];
  });

test('one header row: brand, Quick Access, File, the tabs and the top bar fit at 1280 px @smoke', async ({
  page,
}) => {
  // M10-08·O3 (ADR-027 D-47): one row above the ribbon panel, 28 px more for the document.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.getByTestId('app-brand')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Triya PDF' })).toBeVisible();
  await expect(page.getByRole('toolbar', { name: 'Quick access toolbar' })).toBeVisible();
  const parts = await headerParts(page);
  // Left to right, without overlapping, all centred on the same line.
  for (let i = 1; i < parts.length; i++) {
    const [a, b] = [parts[i - 1], parts[i]];
    expect(a && b && a.right <= b.left).toBe(true);
    expect(Math.abs((a?.mid ?? 0) - (b?.mid ?? 0))).toBeLessThanOrEqual(1);
  }
  // The row is the 34 px header; the ribbon panel starts right under it.
  const row = await page.locator('.ribbon-tabs').boundingBox();
  const panel = await page.locator('.ribbon-panel').boundingBox();
  expect(Math.round(row?.height ?? 0)).toBe(34);
  expect(Math.round((panel?.y ?? 0) - (row?.y ?? 0))).toBe(34);
  // In English every tab fits: the tab list does not scroll and has no faded edge.
  const wrap = page.locator('.ribbon-tablist-wrap');
  expect(await wrap.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
  await expect(wrap).not.toHaveAttribute('data-more-end');
  for (const name of ['OpenEngTools Home', 'Report an Issue on GitHub'])
    await expect(page.getByRole('link', { name })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Full Screen' })).toBeVisible();
});

test('a long language at 1280 px: only the tab list scrolls; the top bar stays on screen @smoke', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?locale=pseudo');
  const wrap = page.locator('.ribbon-tablist-wrap');
  await expect(wrap).toHaveAttribute('data-more-end');
  await expect(wrap).not.toHaveAttribute('data-more-start');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0);
  // Brand, Quick Access, File and every top bar button keep their place, inside the window.
  const parts = await headerParts(page);
  expect(parts.every((p) => p.left >= 0 && p.right <= 1280)).toBe(true);
  const collapse = await page.locator('.ribbon-tabs-end > .ui-button').boundingBox();
  expect((collapse?.x ?? 0) + (collapse?.width ?? 0)).toBeLessThanOrEqual(1280);

  // The keyboard reaches the last tab: it scrolls into view, clear of the faded edge.
  const tabs = page.getByRole('tab');
  await tabs.first().focus();
  await page.keyboard.press('End');
  const last = tabs.last();
  await expect(last).toBeFocused();
  await expect(last).toHaveAttribute('aria-selected', 'true');
  await expect(wrap).toHaveAttribute('data-more-start');
  await expect(wrap).not.toHaveAttribute('data-more-end');
  const [w, t] = await Promise.all([wrap.boundingBox(), last.boundingBox()]);
  expect(w && t && t.x >= w.x && t.x + t.width <= w.x + w.width).toBe(true);
  // The active tab's bar follows it into the scrolled list.
  const bar = await page.locator('.ribbon-tab-indicator').boundingBox();
  const mid = (b: { x: number; width: number } | null) => (b ? b.x + b.width / 2 : 0);
  await expect
    .poll(async () =>
      Math.abs(mid(await page.locator('.ribbon-tab-indicator').boundingBox()) - mid(t)),
    )
    .toBeLessThanOrEqual(1);
  expect(bar).not.toBeNull();
  await page.keyboard.press('Home');
  await expect(wrap).not.toHaveAttribute('data-more-start');
});

test('the two links open new tabs; the issue page has version, browser and OS only', async ({
  page,
  pdfs,
  guard,
  baseURL,
}) => {
  const sites = await stubExternalSites(page, guard, baseURL ?? '');
  await page.goto('/');
  await openDoc(page, pdfs);

  const [home] = await Promise.all([
    page.context().waitForEvent('page'),
    page.getByRole('link', { name: 'OpenEngTools Home' }).click(),
  ]);
  await home.waitForLoadState();
  expect(home.url()).toBe('https://www.openengtools.com/');
  // No opener: the new tab cannot reach the app.
  expect(await home.evaluate(() => window.opener === null)).toBe(true);
  await home.close();

  // Keyboard: the issue link opens with Enter.
  const issueLink = page.getByRole('link', { name: 'Report an Issue on GitHub' });
  await issueLink.focus();
  const [issue] = await Promise.all([
    page.context().waitForEvent('page'),
    page.keyboard.press('Enter'),
  ]);
  await issue.waitForLoadState();
  const url = new URL(issue.url());
  expect(`${url.origin}${url.pathname}`).toBe('https://github.com/shubhs650/PDFTools/issues/new');
  const body = url.searchParams.get('body') ?? '';
  expect(body).toMatch(/Triya PDF version: \S+/);
  expect(body).toMatch(/Browser: Chrom(e|ium) \d+/);
  expect(body).toMatch(/OS: (Linux|Windows|macOS)/);
  expect(decodeURIComponent(issue.url())).not.toMatch(/ZEBRA|budget|\.pdf/i);
  await issue.close();

  // The app page itself requested nothing outside its origin.
  expect(sites.fromApp).toEqual([]);
  sites.forgetPopups();
});

test('full screen: the whole app (ribbon, panes, status bar) fills the screen and leaves again', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await openDoc(page, pdfs);
  const button = page.getByTestId('full-screen');
  await button.click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName)).toBe('HTML');
  await expect(button).toHaveAccessibleName('Exit Full Screen');
  // The ribbon, panes and status bar stay; the frame fills the screen.
  await expect(page.getByRole('region', { name: 'Ribbon' })).toBeVisible();
  await expect(page.getByRole('contentinfo', { name: 'Status bar' })).toBeVisible();
  const fills = await page.evaluate(() => {
    const r = document.querySelector('.app-frame')?.getBoundingClientRect();
    return r ? [Math.round(r.width), Math.round(r.height)] : null;
  });
  expect(fills).toEqual(await page.evaluate(() => [window.innerWidth, window.innerHeight]));
  await button.click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  await expect(button).toHaveAccessibleName('Full Screen');

  // The keymap's shortcut toggles it too.
  await page.getByRole('main', { name: 'Document area' }).focus();
  await page.keyboard.press('Control+Shift+F11');
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName)).toBe('HTML');
  await page.keyboard.press('Control+Shift+F11');
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
});

test('the magnet toggle: pressed and unpressed, keyboard reachable, named, axe clean', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await openDoc(page, pdfs);
  const status = page.getByRole('contentinfo', { name: 'Status bar' });
  const toggle = status.getByRole('button', { name: 'Enable Snapping' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  // An icon, not the old text button.
  await expect(toggle).toHaveText('');
  await expect(toggle.locator('svg')).toHaveCount(1);
  const plain = await toggle.locator('svg').innerHTML();
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(await toggle.locator('svg').innerHTML()).not.toBe(plain); // Filled while pressed
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});
