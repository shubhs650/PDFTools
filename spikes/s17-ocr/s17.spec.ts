import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { expectedWords } from './fixtures.ts';

// S17 browser checks (ADR-020): tesseract.js-core in a module worker under the
// §10.1 CSP. Zero CSP violations, zero third-party requests, the WASM and the
// language data from this origin, a page recognized with progress, cancel by
// terminating the worker, no main-thread long tasks.

const results: Record<string, unknown> = {};
test.afterAll(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/s17-results.json', JSON.stringify(results, null, 2));
});

const ev = <T>(page: Page, expr: string): Promise<T> => page.evaluate(expr);

test('OCR core in a worker: init, recognize, cancel, CSP clean, no network', async ({
  page,
  context,
  baseURL,
}) => {
  await page.request.delete('/__csp-reports');
  const origin = new URL(baseURL ?? '').origin;
  const foreign: string[] = [];
  const fetched: string[] = [];
  context.on('request', (req) => {
    const url = req.url();
    if (/^https?:/.test(url) && new URL(url).origin !== origin) foreign.push(url);
    if (/\.(wasm|gz|pgm)$/.test(url)) fetched.push(new URL(url).pathname);
  });

  await page.goto('/');
  await expect(page.locator('#status')).toHaveText('ready');
  const init = await ev<{ version: string; wasmFrom: string }>(page, 'window.__s17.init()');
  results.init = init;
  expect(init.wasmFrom).toMatch(/^\/assets\/tesseract-core-simd-lstm[\w.-]*\.wasm$/);

  const r = await ev<{ ms: number; words: string[]; conf: number; progressMessages: number }>(
    page,
    `window.__s17.recognize('/fixtures/page1.pgm', 300)`,
  );
  const norm = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, '');
  const got = new Set(r.words.map(norm));
  const expected = expectedWords();
  const found = expected.filter((w) => got.has(w)).length;
  results.recognize = {
    ms: r.ms,
    conf: r.conf,
    words: r.words.length,
    found,
    expected: expected.length,
    progressMessages: r.progressMessages,
  };
  expect(found / expected.length).toBeGreaterThan(0.95);
  expect(r.progressMessages).toBeGreaterThan(0);

  // A second page on the same worker (warm numbers).
  const r2 = await ev<{ ms: number }>(page, `window.__s17.recognize('/fixtures/page1.pgm', 300)`);
  results.recognizeWarmMs = r2.ms;
  results.memory = await ev(page, 'window.__s17.memory()');

  const cancel = await ev<{ terminateMs: number; settled: string }>(
    page,
    `window.__s17.cancelAfter('/fixtures/page1.pgm', 300, 200)`,
  );
  results.cancel = cancel;
  expect(cancel.terminateMs).toBeLessThan(100);

  const probe = await ev<{ cspViolations: unknown[]; longTasks: { duration: number }[] }>(
    page,
    'window.__s17.probe',
  );
  results.longTasks = probe.longTasks.map((l) => Math.round(l.duration));
  results.fetched = fetched;
  expect(probe.cspViolations).toEqual([]);
  expect((await (await page.request.get('/__csp-reports')).json()) as unknown[]).toEqual([]);
  expect(foreign).toEqual([]);
  // The data is fetched once per worker (twice here: the fresh worker after the cancel).
  expect(new Set(fetched.filter((f) => f.endsWith('.gz')))).toEqual(
    new Set(['/ocr/eng.traineddata.gz']),
  );
  expect(probe.longTasks.filter((l) => l.duration > 100)).toEqual([]);
});
