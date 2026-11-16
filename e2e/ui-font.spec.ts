import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures.ts';

// M10 O8 (ADR-027 D-47): the UI is set in the bundled Inter (variable WOFF2, Latin and
// Latin-extended), served from our own origin and kept in the core precache, so it looks the
// same on Windows, macOS and Linux and also offline. Scripts Inter doesn't cover fall back to
// the system fonts.

const status = (page: Page) => page.getByRole('contentinfo', { name: 'Status bar' });

/**
 * The fonts Chromium actually used to draw a node's text (CSS.getPlatformFontsForNode): the
 * font's own family name, marked when it is a web font (ours) rather than an installed one.
 */
async function usedFonts(page: Page, selector: string): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
  await cdp.detach();
  return fonts.map((f) => (f.isCustomFont ? `${f.familyName} (web font)` : f.familyName));
}

/** The Inter faces the page loaded, with their URLs (only our own origin's /assets/). */
async function interFaces(page: Page): Promise<{ style: string; status: string }[]> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts]
      .filter((f) => f.family.replace(/["']/g, '') === 'Inter Variable')
      .map((f) => ({ style: f.style, status: f.status }));
  });
}

test('the UI is drawn in the bundled Inter, from our own origin, with the system fonts as fallback @smoke', async ({
  page,
}) => {
  const fontRequests: string[] = [];
  page.on('request', (r) => {
    if (r.resourceType() === 'font') fontRequests.push(r.url());
  });
  await page.goto('/');
  await expect(page.getByTestId('start-screen')).toBeVisible();

  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(family).toMatch(/^"Inter Variable", "Segoe UI Variable Text", "Segoe UI", system-ui/);
  // The File tab and the start screen's heading really are drawn in Inter, not a fallback.
  await expect
    .poll(() => usedFonts(page, '[data-testid="file-tab"]'))
    .toEqual(['Inter (web font)']);
  await expect.poll(() => usedFonts(page, '#start-title')).toEqual(['Inter (web font)']);
  expect((await interFaces(page)).some((f) => f.style === 'normal' && f.status === 'loaded')).toBe(
    true,
  );
  // Every font file came from this origin's /assets/ (rule 4), and the preloaded Latin file is
  // the one the stylesheet uses (one request, not two).
  const origin = new URL(page.url()).origin;
  expect(fontRequests.length).toBeGreaterThan(0);
  for (const url of fontRequests)
    expect(url).toMatch(new RegExp(`^${origin}/assets/inter-[\\w-]+\\.woff2$`));
  expect(new Set(fontRequests).size).toBe(fontRequests.length);
});

test('the Help window uses the same Inter', async ({ page }) => {
  await page.goto('/help#welcome');
  await expect(page.locator('article.help-topic h1')).toBeVisible();
  await expect.poll(() => usedFonts(page, 'article.help-topic h1')).toEqual(['Inter (web font)']);
});

test('offline, after a reload from the precache, the UI is still in Inter @offline', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await page.goto('/?sw');
  await expect(status(page).getByText('✓ Ready offline')).toBeVisible({ timeout: 60_000 });
  // The font files are in the core precache (installed before "Ready offline").
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys())
      for (const req of await (await caches.open(name)).keys()) urls.push(req.url);
    return urls.filter((u) => /\/assets\/inter-[\w-]+\.woff2$/.test(u)).length;
  });
  expect(cached).toBe(4);

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByTestId('start-screen')).toBeVisible();
    await expect
      .poll(() => usedFonts(page, '[data-testid="file-tab"]'))
      .toEqual(['Inter (web font)']);
  } finally {
    await context.setOffline(false);
  }
});
