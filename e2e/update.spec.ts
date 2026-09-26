import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { startServer } from '../scripts/serve.ts';
import { cap } from './support/app.ts';
import { test as base, expect } from './support/fixtures.ts';
import { E2E_DIST } from './support/paths.ts';

// M1-25 (§9, D-18): a new service worker installs in the background and shows
// "Update ready"; it activates only on the user's click, never while a
// document is open. v1 is the e2e build; v2 is a copy with a changed
// index.html (and so a changed precache manifest in sw.js). The server serves
// a symlink that the test switches from v1 to v2: same origin, new version.

const V2_MARK = '<meta name="pdftools-build" content="v2">';

interface Deploy {
  url: string;
  toV2(): void;
}

const test = base.extend<
  { deploy: Deploy },
  { appServer: string; dirs: { v1: string; v2: string; live: string } }
>({
  dirs: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires the destructuring form
    async ({}, use) => {
      const root = mkdtempSync(join(tmpdir(), 'pdftools-update-'));
      const v1 = join(root, 'v1');
      const v2 = join(root, 'v2');
      cpSync(E2E_DIST, v1, { recursive: true });
      cpSync(E2E_DIST, v2, { recursive: true });
      const index = readFileSync(join(v2, 'index.html'), 'utf8');
      writeFileSync(join(v2, 'index.html'), index.replace('</head>', `${V2_MARK}</head>`));
      // The injected manifest lists index.html with a revision: change it, so
      // the browser sees a new service worker and it caches the new page.
      const sw = readFileSync(join(v2, 'sw.js'), 'utf8');
      const patched = sw.replace(/("revision":")([0-9a-f]+)(","url":"index\.html")/, '$1v2$3');
      if (patched === sw) throw new Error('index.html revision not found in sw.js');
      writeFileSync(join(v2, 'sw.js'), patched);
      const live = join(root, 'live');
      symlinkSync(v1, live);
      await use({ v1, v2, live });
      rmSync(root, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],
  appServer: [
    async ({ dirs }, use) => {
      const server: Server = await startServer({ root: dirs.live, port: 0, report: true });
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('server has no port');
      await use(`http://localhost:${String(addr.port)}`);
      await new Promise((done) => server.close(done));
    },
    { scope: 'worker' },
  ],
  deploy: async ({ dirs, appServer }, use) => {
    await use({
      url: appServer,
      toV2: () => {
        rmSync(dirs.live);
        symlinkSync(dirs.v2, dirs.live);
      },
    });
  },
});

const status = (page: Page) => page.getByRole('contentinfo', { name: 'Status bar' });
const build = (page: Page) =>
  page.evaluate(
    () => document.querySelector('meta[name="pdftools-build"]')?.getAttribute('content') ?? 'v1',
  );

test('v2 deployed while v1 has a document open: "Update ready", no reload; applies after the last document closes', async ({
  page,
  pdfs,
  deploy,
}) => {
  await page.goto('/?sw');
  await expect(status(page).getByText('✓ Ready offline')).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => {
    (window as unknown as { __sameLoad: boolean }).__sameLoad = true;
  });
  await cap(page, 'open', 'openHandles', [
    { name: 'open.pdf', b64: pdfs.simple(1).toString('base64') },
  ]);
  await expect(page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab')).toHaveCount(
    1,
  );

  deploy.toV2();
  // The hourly / on-focus update check, now.
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())?.update();
  });
  const updateButton = status(page).getByRole('button', { name: 'Update ready' });
  await expect(updateButton).toBeVisible({ timeout: 60_000 });
  expect(
    await page.evaluate(() => (window as unknown as { __sameLoad?: boolean }).__sameLoad),
  ).toBe(true);
  expect(await build(page)).toBe('v1');

  await updateButton.click();
  const dialog = page.getByRole('dialog', { name: 'Close your documents to update' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  expect(await build(page)).toBe('v1');
  expect(
    await page.evaluate(() => (window as unknown as { __sameLoad?: boolean }).__sameLoad),
  ).toBe(true);

  await page.getByRole('button', { name: 'Close open.pdf' }).click();
  await expect.poll(() => build(page), { timeout: 30_000 }).toBe('v2');
  expect(
    await page.evaluate(() => (window as unknown as { __sameLoad?: boolean }).__sameLoad),
  ).toBeUndefined();
});
