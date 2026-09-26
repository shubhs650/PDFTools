import type { Page } from '@playwright/test';
import { cap } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M1-25 (§9, D-17): the service worker precaches the core at install and the
// rest after the first render; offline, a reload opens, renders, saves and
// recovers with zero outbound requests. The e2e build registers the service
// worker only with `?sw`.

const status = (page: Page) => page.getByRole('contentinfo', { name: 'Status bar' });
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');

test(
  'first visit: "Preparing offline… n %" then "✓ Ready offline"; offline: reload, open, render, save and recover with zero outbound requests',
  { tag: '@offline' },
  async ({ page, context, pdfs }) => {
    // Every status-bar text shown, so the short "Preparing offline…" phase is seen too.
    await page.addInitScript(() => {
      const seen: string[] = [];
      (window as unknown as { __statusSeen: string[] }).__statusSeen = seen;
      new MutationObserver(() => {
        const t = document.querySelector('footer.status-bar')?.textContent ?? '';
        if (t && seen.at(-1) !== t) seen.push(t);
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
    await page.goto('/?sw');
    await expect(status(page).getByText('✓ Ready offline')).toBeVisible({ timeout: 60_000 });
    const seen = await page.evaluate(
      () => (window as unknown as { __statusSeen: string[] }).__statusSeen,
    );
    expect(seen.some((t) => /Preparing offline… \d+/.test(t))).toBe(true);
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

    await context.setOffline(true);
    const outbound: string[] = [];
    page.on('requestfailed', (r) => {
      if (/^https?:/.test(r.url())) outbound.push(`failed ${r.url()}`);
    });
    page.on('response', (r) => {
      if (/^https?:/.test(r.url()) && !r.fromServiceWorker()) outbound.push(r.url());
    });
    try {
      await page.reload();
      await expect(page.getByTestId('start-screen')).toBeVisible();
      await expect(status(page).getByText('✓ Ready offline')).toBeVisible();

      const [id] = (await cap(page, 'open', 'openHandles', [
        { name: 'offline.pdf', b64: pdfs.contract(20).toString('base64') },
      ])) as string[];
      if (!id) throw new Error('not opened');
      await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();

      expect(await cap(page, 'save', 'addSquares', id, 2)).toBeNull();
      await page.keyboard.press('Control+S');
      await expect(tabs(page).first()).toHaveAccessibleName('offline.pdf');

      expect(await cap(page, 'save', 'addSquares', id, 1, 2)).toBeNull();
      await expect
        .poll(async () => ((await cap(page, 'storage', 'list')) as unknown[]).length, {
          timeout: 10_000,
        })
        .toBe(1);
      expect(outbound).toEqual([]);
    } finally {
      await context.setOffline(false);
    }
  },
);
