import AxeBuilder from '@axe-core/playwright';
import type { Page, Request } from '@playwright/test';
import { drop } from './support/app.ts';
import { isThirdParty } from './support/probes.ts';
import { expect, test, type Guard } from './support/fixtures.ts';

// M6-01 (ADR-021 D-35): brand, the OpenEngTools and GitHub links (new tabs, no
// request by the app, no document content), full screen of the whole app, and
// the magnet snapping toggle in the status bar.

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

test('brand at the left of the quick access row; the tab row is not pushed at 1280 px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const brand = page.getByTestId('app-brand');
  await expect(brand).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Triya PDF' })).toBeVisible();
  const qat = page.getByRole('toolbar', { name: 'Quick access toolbar' });
  const [b, q] = await Promise.all([brand.boundingBox(), qat.boundingBox()]);
  expect(b && q && b.x + b.width <= q.x).toBe(true);
  // The ribbon's tab row (File … Help, then the top bar buttons) fits without scrolling.
  const overflow = await page
    .locator('.ribbon-tabs')
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBe(0);
  for (const name of ['OpenEngTools Home', 'Report an Issue on GitHub'])
    await expect(page.getByRole('link', { name })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Full Screen' })).toBeVisible();
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
  expect(body).toMatch(/App: \S+/);
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
