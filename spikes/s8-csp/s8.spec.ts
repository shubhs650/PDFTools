import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// M0-S8 checks (docs/plan/M0.md §S8, ADR-003). The enforced CSP comes from
// spikes/shared/public/_headers verbatim; the server adds a report-only copy
// so violations from workers and the service worker are collected too.

interface Render {
  ink: number;
  pageCount: number;
  text: string;
  blobType: string;
}

function trackRequests(context: BrowserContext, origin: string) {
  const all: string[] = []; // page + workers (engine), not the service worker
  const foreign: string[] = []; // any context, including the service worker
  context.on('request', (req) => {
    const url = req.url();
    if (!req.serviceWorker()) all.push(url);
    if (/^https?:/.test(url) && new URL(url).origin !== origin) foreign.push(url);
  });
  return { all, foreign };
}

async function cspReports(page: Page): Promise<unknown[]> {
  const res = await page.request.get('/__csp-reports');
  return (await res.json()) as unknown[];
}

async function waitDone(page: Page): Promise<Record<string, unknown>> {
  await expect(page.locator('#status')).toHaveText(/done|error/, { timeout: 60_000 });
  const s8 = await page.evaluate(() => window.__s8);
  expect(s8.error, JSON.stringify(s8.error)).toBeUndefined();
  return s8;
}

test.beforeEach(async ({ page }) => {
  await page.request.delete('/__csp-reports');
});

test('local fonts: renders CJK via self-hosted fallback, zero CSP violations, zero third-party requests', async ({
  page,
  context,
  baseURL,
}) => {
  const req = trackRequests(context, new URL(baseURL ?? '').origin);
  await page.goto('/?fonts=local');
  const s8 = await waitDone(page);
  const render = s8.render as Render;

  expect(render.pageCount).toBe(1);
  expect(render.text).toContain('中文测试');
  expect(render.ink).toBeGreaterThan(3000); // CJK glyphs drawn (≈500 without them)
  expect(render.blobType).toMatch(/^image\//);
  expect(req.all.some((u) => u.endsWith('/fonts/sc/NotoSansHans-Regular.otf'))).toBe(true);

  const probe = s8.probe as { cspViolations: unknown[]; longTasks: { duration: number }[] };
  expect(probe.cspViolations).toEqual([]);
  expect(await cspReports(page)).toEqual([]);
  expect(req.foreign).toEqual([]);
  test.info().annotations.push({
    type: 'longtasks (cold boot, exempt)',
    description: JSON.stringify(probe.longTasks.map((t) => Math.round(t.duration))),
  });
});

test('fontFallback null: no font request, CJK glyphs missing, still no violations', async ({
  page,
  context,
  baseURL,
}) => {
  const req = trackRequests(context, new URL(baseURL ?? '').origin);
  await page.goto('/?fonts=off');
  const s8 = await waitDone(page);
  const render = s8.render as Render;
  expect(render.ink).toBeLessThan(1500);
  expect(req.all.some((u) => u.includes('/fonts/'))).toBe(false);
  expect(await cspReports(page)).toEqual([]);
  expect(req.foreign).toEqual([]);
});

test('negative control: EmbedPDF default font config tries jsDelivr and the CSP blocks it', async ({
  page,
}) => {
  await page.goto('/?fonts=default');
  await waitDone(page);
  await expect
    .poll(async () => JSON.stringify(await cspReports(page)), { timeout: 10_000 })
    .toContain('cdn.jsdelivr.net');
  const reports = JSON.stringify(await cspReports(page));
  expect(reports).toContain('connect-src');
});

test('offline reload after first visit works (service worker precache)', async ({
  page,
  context,
}) => {
  await page.goto('/?fonts=local');
  await waitDone(page);
  // Second load is controlled by the service worker.
  await page.reload();
  await waitDone(page);
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  const s8 = await waitDone(page);
  expect((s8.render as Render).ink).toBeGreaterThan(3000);
  expect((s8.sw as { controlled: boolean }).controlled).toBe(true);
  await context.setOffline(false);
  expect(await cspReports(page)).toEqual([]);
});
