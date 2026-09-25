import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// M0-S5 checks (docs/plan/M0.md §S5, ADR-006). Contract profile: a self-made
// 2,000-page stand-in (spikes/s5-search/make-contract.ts); the FAR itself is
// run by the owner with the same harness. Real public text: corpus catalogue.

interface Run {
  id: number;
  query: string;
  hits: number;
  firstHitMs: number | null;
  doneMs: number | null;
  cancelled: boolean;
  cancelLatencyMs: number | null;
  firstPages: number[];
}
interface Counters {
  inputEvents: number;
  searchCalls: number;
  staleArrivals: number;
  staleShown: number;
  listRows: number;
}

const results: Record<string, unknown> = {};
test.afterAll(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/s5-results.json', JSON.stringify(results, null, 2));
});

const ev = <T>(page: Page, expr: string): Promise<T> => page.evaluate(expr);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function open(page: Page, url: string): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#status')).toHaveText('ready', { timeout: 60_000 });
  await ev(page, `window.__s5.load(${JSON.stringify(url)})`);
  await ev(page, `(window.__s5.setPhase('warmup'), window.__s5.startScroll(900))`);
  await sleep(2500);
  await ev(page, `(window.__s5.resetTileStats(), window.__s5.setPhase('baseline'))`);
  await sleep(4000);
}

async function waitDone(page: Page, id: number): Promise<Run> {
  await expect
    .poll(
      async () =>
        (await ev<Run[]>(page, 'window.__s5.runs()')).find((r) => r.id === id)?.doneMs ?? null,
      {
        timeout: 60_000,
      },
    )
    .not.toBeNull();
  const run = (await ev<Run[]>(page, 'window.__s5.runs()')).find((r) => r.id === id);
  if (!run) throw new Error('run missing');
  return run;
}

test('2,000 pages while scrolling: Enter-only, streaming, cancel by new query, no long tasks', async ({
  page,
}) => {
  test.skip(!existsSync('spikes/s5-search/out/contract-2000.pdf'), 'run make-contract.ts first');
  await open(page, '/fixtures/contract-2000.pdf');
  const q = page.getByLabel('Search (press Enter)');

  // Typing alone never searches (D-08).
  await ev(page, `window.__s5.setPhase('search-1')`);
  await q.pressSequentially('PDFTOOLS-NEEDLE', { delay: 20 });
  const typed = await ev<Counters>(page, 'window.__s5.counters()');
  expect(typed.inputEvents).toBeGreaterThanOrEqual(15);
  expect(typed.searchCalls).toBe(0);

  await q.press('Enter');
  await sleep(1200); // search 1 is still extracting (cold index)
  await ev(page, `window.__s5.setPhase('search-2')`);
  await q.fill('');
  await q.pressSequentially('contractor', { delay: 20 });
  await q.press('Enter'); // cancels search 1

  const second = await waitDone(page, 2);
  const runs = await ev<Run[]>(page, 'window.__s5.runs()');
  const first = runs.find((r) => r.id === 1);
  await sleep(500); // let any in-flight stale batch arrive
  const counters = await ev<Counters>(page, 'window.__s5.counters()');
  await ev(page, 'window.__s5.stopScroll()');
  const tiles = await ev<Record<string, unknown>>(page, 'window.__s5.tileStats()');
  const longTasks = await ev<number[]>(
    page,
    'window.__s5.probe.longTasks.map((t) => Math.round(t.duration))',
  );
  results.contract = { first, second, counters, tiles, longTasks };

  expect(counters.searchCalls).toBe(2);
  expect(first?.cancelled).toBe(true);
  expect(first?.cancelLatencyMs ?? Infinity).toBeLessThan(100);
  expect(counters.staleShown).toBe(0);
  expect(second.firstHitMs ?? Infinity).toBeLessThan(1000);
  expect(second.doneMs ?? Infinity).toBeLessThan(15_000);
  expect(second.hits).toBe(18798);
  expect(counters.listRows).toBe(50);
  expect(longTasks.filter((d) => d > 100)).toEqual([]);
});

test('warm index: rare term anywhere in < 1 s; huge result streams stay off the main thread', async ({
  page,
}) => {
  test.skip(!existsSync('spikes/s5-search/out/contract-2000.pdf'), 'run make-contract.ts first');
  await open(page, '/fixtures/contract-2000.pdf');
  const cold = await ev<Run>(page, `window.__s5.search('PDFTOOLS-NEEDLE', { matchCase: true })`);
  await ev(page, `window.__s5.setPhase('warm')`);
  const warm = await ev<Run>(page, `window.__s5.search('PDFTOOLS-NEEDLE', { matchCase: true })`);
  const wild = await ev<Run>(page, `window.__s5.search('52.2?0-*', { wildcards: true })`);
  const heavy = await ev<Run>(page, `window.__s5.search('e', { regex: true })`);
  const native = await ev<unknown>(page, `window.__s5.nativeSearch('contractor')`);
  const cache = await ev<unknown>(page, 'window.__s5.cacheInfo()');
  await ev(page, 'window.__s5.stopScroll()');
  const longTasks = await ev<number[]>(
    page,
    'window.__s5.probe.longTasks.map((t) => Math.round(t.duration))',
  );
  results.warm = {
    cold,
    warm,
    wild,
    heavy,
    native,
    cache,
    tiles: await ev(page, 'window.__s5.tileStats()'),
    longTasks,
  };

  expect(cold.hits).toBe(3);
  expect([...cold.firstPages].sort((a, b) => a - b)).toEqual([6, 999, 1998]);
  expect(warm.doneMs ?? Infinity).toBeLessThan(1000);
  expect(wild.hits).toBeGreaterThan(0);
  expect(heavy.hits).toBeGreaterThan(100_000);
  // Only the first 5,000 hits carry context; the rest arrive as per-page counts.
  expect((heavy as Run & { detailed: number }).detailed).toBe(5000);
  expect(longTasks.filter((d) => d > 100)).toEqual([]);
});

test('comparison: EmbedPDF plugin-search path (Render engine) vs Work-worker search, tile latency', async ({
  page,
}) => {
  test.skip(!existsSync('spikes/s5-search/out/contract-2000.pdf'), 'run make-contract.ts first');
  await open(page, '/fixtures/contract-2000.pdf');
  await ev(page, `window.__s5.setPhase('work-search')`);
  const workRun = await ev<Run>(page, `window.__s5.search('contractor')`);
  await ev(page, `window.__s5.setPhase('render-engine-search')`);
  const renderRun = await ev<unknown>(page, `window.__s5.renderEngineSearch('contractor')`);
  await ev(page, `window.__s5.setPhase('after')`);
  await sleep(2000);
  await ev(page, 'window.__s5.stopScroll()');
  results.comparison = { workRun, renderRun, tiles: await ev(page, 'window.__s5.tileStats()') };
});

test('real public text: 1,152-page catalogue, cold search while scrolling (reported)', async ({
  page,
}) => {
  test.skip(!existsSync('corpus/bearing catalogue.pdf'), 'corpus file missing');
  await open(page, `/corpus/${encodeURIComponent('bearing catalogue.pdf')}`);
  await ev(page, `window.__s5.setPhase('search-cold')`);
  const run = await ev<Run>(page, `window.__s5.search('bearing')`);
  await ev(page, 'window.__s5.stopScroll()');
  const longTasks = await ev<number[]>(
    page,
    'window.__s5.probe.longTasks.map((t) => Math.round(t.duration))',
  );
  results.catalogue = { run, tiles: await ev(page, 'window.__s5.tileStats()'), longTasks };
  expect(run.firstHitMs ?? Infinity).toBeLessThan(1000);
  expect(longTasks.filter((d) => d > 100)).toEqual([]);
});
