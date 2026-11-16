import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { darkTheme } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M10-01 (ADR-027 D-48): File → About shows the version, build and offline
// state, copies version info for bug reports, lists the main components and
// every open-source package with its license text (searchable, offline too),
// and "Third-party notices" opens the notices, not a second copy of the app,
// once the service worker controls the site.

const backstage = (page: Page) => page.getByTestId('backstage');
const about = (page: Page) => backstage(page).getByTestId('about');

async function openAbout(page: Page): Promise<void> {
  await page.getByTestId('file-tab').click();
  await backstage(page).getByRole('button', { name: 'About', exact: true }).click();
  await expect(backstage(page).getByRole('heading', { name: 'About', exact: true })).toBeVisible();
}

const axe = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id);

const NOTICES_HEAD = 'Triya PDF — third-party notices';

test(
  'About: version, build, Copy version info, Built with, searchable licenses; axe light and dark',
  { tag: '@smoke' },
  async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    await openAbout(page);

    await expect(about(page).getByText('Triya PDF', { exact: true })).toBeVisible();
    await expect(about(page).getByTestId('app-version')).toHaveText(/^\d+\.\d+\.\d+/);
    await expect(about(page).getByTestId('app-commit')).toHaveText(/^[0-9a-f]{7,}$/);
    await expect(about(page).getByTestId('app-built')).not.toHaveText('Unknown');
    // The e2e build registers no service worker without ?sw.
    await expect(about(page).getByTestId('about-offline')).toHaveText(
      "Offline use isn't available in this browser window.",
    );

    // Copy version info: version, commit, build, browser, OS and offline state only (rule 10).
    await about(page).getByRole('button', { name: 'Copy version info' }).click();
    await expect(about(page).getByTestId('about-copied')).toHaveText(/Version info copied/);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    const version = (await about(page).getByTestId('app-version').textContent()) ?? '';
    expect(copied.split('\n').map((l) => l.replace(/:.*$/, ''))).toEqual([
      `Triya PDF ${version}`,
      'Commit',
      'Built',
      'Browser',
      'OS',
      'Offline',
    ]);
    expect(copied).toMatch(/^Browser: (Chrome|Chromium) \d+$/m);

    // Built with: the main components with their licenses.
    const components = about(page).getByTestId('about-components').getByRole('listitem');
    await expect(components).toHaveCount(12);
    await expect(components.filter({ hasText: 'PDFium' })).toContainText(
      'BSD-3-Clause, Apache-2.0',
    );
    await expect(components.filter({ hasText: 'React' }).first()).toContainText(/MIT · version 19/);

    // Open-source licenses: every package, searchable on Enter, each expandable.
    const licenses = about(page).getByTestId('about-licenses');
    const count = licenses.getByTestId('about-licenses-count');
    await expect(count).toHaveText(/^\d+ packages\. Select one to read its license\.$/);
    const total = Number(/^(\d+)/.exec((await count.textContent()) ?? '')?.[1]);
    expect(total).toBeGreaterThan(100);
    await expect(licenses.getByRole('listitem')).toHaveCount(total);

    const search = licenses.getByRole('searchbox', { name: 'Search packages' });
    await search.fill('pdfium');
    // Typing alone does not filter (rule 3).
    await expect(licenses.getByRole('listitem')).toHaveCount(total);
    await search.press('Enter');
    await expect(count).toHaveText(`1 of ${String(total)} packages match.`);
    const pdfium = licenses.getByRole('listitem');
    await expect(pdfium).toHaveCount(1);
    await pdfium.getByText('@embedpdf/pdfium').click();
    await expect(pdfium.getByText('LICENSE.pdfium', { exact: true })).toBeVisible();
    await expect(pdfium.locator('pre').last()).toContainText('PDFium Authors');

    await search.fill('ofl');
    await licenses.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(count).toHaveText(/ of \d+ packages match\./);
    for (const id of await licenses.locator('.about-license-id').allTextContents())
      expect(id).toMatch(/OFL/);
    await licenses.getByRole('button', { name: 'Clear search' }).click();
    await expect(licenses.getByRole('listitem')).toHaveCount(total);
    expect(await axe(page)).toEqual([]);

    // Privacy and your data goes to File → Privacy.
    await about(page).getByRole('button', { name: 'Privacy and your data' }).click();
    await expect(
      backstage(page).getByRole('heading', { name: 'Privacy', exact: true }),
    ).toBeVisible();
    await expect(
      backstage(page).getByRole('button', { name: 'Privacy', exact: true }),
    ).toBeFocused();

    // Report an issue on GitHub: the same prefilled link as the top bar.
    await backstage(page).getByRole('button', { name: 'About', exact: true }).click();
    const issue = about(page).getByRole('link', { name: 'Report an issue on GitHub' });
    await expect(issue).toHaveAttribute(
      'href',
      /^https:\/\/github\.com\/shubhs650\/PDFTools\/issues\/new\?/,
    );
    await expect(issue).toHaveAttribute('target', '_blank');

    // Help opens the Help window.
    const [help] = await Promise.all([
      page.waitForEvent('popup'),
      about(page).getByRole('button', { name: 'Open Help' }).click(),
    ]);
    await expect(help).toHaveURL(/\/help$/);
    await help.close();
  },
);

test('About in the dark theme: axe and the license text', { tag: '@smoke' }, async ({ page }) => {
  await darkTheme(page);
  await page.goto('/');
  await openAbout(page);
  const licenses = about(page).getByTestId('about-licenses');
  await licenses.getByRole('searchbox', { name: 'Search packages' }).fill('zustand');
  await licenses.getByRole('searchbox', { name: 'Search packages' }).press('Enter');
  await licenses.getByText('zustand', { exact: true }).click();
  await expect(licenses.locator('pre')).toContainText('MIT License');
  expect(await axe(page)).toEqual([]);
});

test(
  'Third-party notices opens the notices, not the app, once the service worker is in control; offline too',
  { tag: '@offline' },
  async ({ page, context }) => {
    await page.goto('/?sw');
    const status = page.getByRole('contentinfo', { name: 'Status bar' });
    await expect(status.getByText('✓ Ready offline')).toBeVisible({ timeout: 60_000 });
    await page.reload();
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await openAbout(page);
    await expect(about(page).getByTestId('about-offline')).toHaveText(
      'Ready to work offline on this device',
    );

    const open = async (): Promise<void> => {
      const [tab] = await Promise.all([
        page.waitForEvent('popup'),
        about(page).getByRole('link', { name: 'Third-party notices (opens in a new tab)' }).click(),
      ]);
      await tab.waitForLoadState();
      expect(new URL(tab.url()).pathname).toBe('/third-party-notices.txt');
      const text = await tab.evaluate(() => document.body.innerText);
      expect(text.startsWith(NOTICES_HEAD)).toBe(true);
      // Served as `text/plain` without a charset, as on Cloudflare: the BOM makes it UTF-8.
      expect(await tab.evaluate(() => document.characterSet)).toBe('UTF-8');
      expect(text).toContain('@embedpdf/pdfium');
      // Not the app: no ribbon, no app title.
      expect(await tab.title()).not.toBe('Triya PDF');
      await expect(tab.getByTestId('file-tab')).toHaveCount(0);
      await tab.close();
    };
    await open();

    // The app's own routes still get the app.
    const app = await context.newPage();
    await app.goto('/some/route');
    await expect(app.getByTestId('file-tab')).toBeVisible();
    await app.close();

    await context.setOffline(true);
    try {
      await open();
      // The license list comes from the offline cache too.
      await expect(about(page).getByTestId('about-licenses-count')).toHaveText(/^\d+ packages/);
      // Download all notices (.txt).
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        about(page).getByRole('link', { name: 'Download all notices (.txt)' }).click(),
      ]);
      expect(download.suggestedFilename()).toBe('third-party-notices.txt');
    } finally {
      await context.setOffline(false);
    }
  },
);
