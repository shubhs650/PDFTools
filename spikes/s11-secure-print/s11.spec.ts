import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { S11_FRAME_PORT } from '../playwright.config.ts';

// M2-02 print route (ADR-013). Served by spikes/shared/serve.ts with the §10.1
// CSP verbatim plus COOP/COEP (--coi), and a second copy whose CSP adds only
// `frame-src blob:` (the ADR-001 B13 proposal).

type Api = Record<string, (...a: unknown[]) => Promise<unknown>> & {
  probe: { longTasks: { duration: number }[]; cspViolations: unknown[] };
};
const call = (page: Page, m: string, ...a: unknown[]) =>
  page.evaluate(([name, args]) => (window as unknown as { __s11: Api }).__s11[name]?.(...args), [
    m,
    a,
  ] as const);
const longTasks = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __s11: Api }).__s11.probe.longTasks.map((t) => Math.round(t.duration)),
  );

const results: Record<string, unknown> = {};

test.afterAll(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/s11-results.json', JSON.stringify(results, null, 2));
});

test('§10.1 CSP: raster print through an about:blank iframe works; blob: PDF frame is blocked', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveTitle('S11 ready');
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  // 20 A4 pages at 300 DPI (2480 × 3508), made in a worker.
  const urls = (await call(page, 'makePages', 20, 2480, 3508)) as string[];
  const before = (await longTasks(page)).length;
  const raster = (await call(page, 'rasterPrint', urls, false)) as { loaded: number };
  const rasterLong = (await longTasks(page)).slice(before);
  const printed = (await call(page, 'rasterPrint', urls.slice(0, 2), true)) as { loaded: number };
  const blob = (await call(page, 'blobPdfFrame')) as { violations: { directive: string }[] };
  results['csp-10.1'] = { raster, rasterLongTasks: rasterLong, printed, blob };
  expect(raster.loaded).toBe(20);
  expect(rasterLong.filter((d) => d > 100)).toEqual([]);
  expect(blob.violations.map((v) => v.directive)).toContain('frame-src');
});

test('proposed CSP (+ frame-src blob:): the blob: PDF frame loads with no violation', async ({
  page,
}) => {
  await page.goto(`http://localhost:${String(S11_FRAME_PORT)}/`);
  await expect(page).toHaveTitle('S11 ready');
  const blob = (await call(page, 'blobPdfFrame')) as { violations: unknown[]; loadEvent: boolean };
  // Only blob: is added: a data: or cross-origin frame must still be blocked.
  const other = await page.evaluate(async () => {
    const seen: string[] = [];
    document.addEventListener('securitypolicyviolation', (e) => seen.push(e.blockedURI));
    for (const src of ['data:text/html,<p>x</p>', 'https://example.org/']) {
      const f = document.createElement('iframe');
      f.src = src;
      document.body.append(f);
    }
    await new Promise((r) => setTimeout(r, 500));
    return seen;
  });
  results['csp-frame-src-blob'] = { blob, otherFramesBlocked: other };
  expect(blob.violations).toEqual([]);
  expect(new Set(other)).toEqual(new Set(['', 'https://example.org']));
});
