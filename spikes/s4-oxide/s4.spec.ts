import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// M0-S4 browser checks (docs/plan/M0.md §S4, ADR-009): PDF Oxide WASM in a
// module worker under the §10.1 CSP. Zero CSP violations, zero third-party
// requests, per-page extraction cancellable, no main-thread long tasks.

const results: Record<string, unknown> = {};
test.afterAll(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/s4-results.json', JSON.stringify(results, null, 2));
});

const ev = <T>(page: Page, expr: string): Promise<T> => page.evaluate(expr);

test.beforeEach(async ({ page }) => {
  await page.request.delete('/__csp-reports');
});

test('Oxide in a worker: init, tables, 2,000-page text + Markdown, cancel, CSP clean, no network', async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? '').origin;
  const foreign: string[] = [];
  const wasmFetches: string[] = [];
  context.on('request', (req) => {
    const url = req.url();
    if (/^https?:/.test(url) && new URL(url).origin !== origin) foreign.push(url);
    if (url.endsWith('.wasm')) wasmFetches.push(new URL(url).pathname);
  });

  await page.goto('/');
  await expect(page.locator('#status')).toHaveText('ready');
  const init = await ev<{ initMs: number; memMB: number }>(page, 'window.__s4.init()');
  results.init = init;

  // Lattice table on the self-made fixture.
  await ev(page, `window.__s4.open('/fixtures/s4-fixture.pdf')`);
  const t = await ev<{ tables: number; firstGrid: string[][] }>(page, 'window.__s4.tables(0)');
  results.fixtureTables = { tables: t.tables, rows: t.firstGrid.length };
  expect(t.tables).toBeGreaterThanOrEqual(1);
  expect(t.firstGrid.flat()).toContain('114.1');

  test.skip(!existsSync('spikes/s5-search/out/contract-2000.pdf'), 'run make-contract.ts first');
  results.open = await ev(page, `window.__s4.open('/fixtures/contract-2000.pdf')`);
  results.text = await ev(page, `window.__s4.extract('text')`);
  results.markdown = await ev(page, `window.__s4.extract('markdown')`);
  const cancel = await ev<{ cancelled: boolean; cancelMs: number }>(
    page,
    `window.__s4.cancelAfter('markdown', 1500)`,
  );
  results.cancel = cancel;
  expect(cancel.cancelled).toBe(true);
  expect(cancel.cancelMs).toBeLessThan(100);

  const probe = await ev<{ cspViolations: unknown[]; longTasks: { duration: number }[] }>(
    page,
    'window.__s4.probe',
  );
  results.longTasks = probe.longTasks.map((l) => Math.round(l.duration));
  results.wasmFetches = wasmFetches;
  expect(probe.cspViolations).toEqual([]);
  expect((await (await page.request.get('/__csp-reports')).json()) as unknown[]).toEqual([]);
  expect(foreign).toEqual([]);
  expect(wasmFetches).toEqual(['/oxide/pdf_oxide_bg.wasm']);
  expect(probe.longTasks.filter((l) => l.duration > 100)).toEqual([]);
});
