import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// M0-S7 browser checks (docs/plan/M0.md §S7, ADR-008). Real drawing: the
// public A1 pressure-vessel sheet in corpus/ (page 2: ~174k segments). The
// owner's CAD drawings and dense P&ID run through the same page.

const VESSEL = `/corpus/${encodeURIComponent('PRESSURE-VESSEL-SAMPLE.pdf')}`;
interface Stat {
  n: number;
  p50: number;
  p95: number;
  max: number;
}
interface Report {
  rtt: Record<string, Stat>;
  tiles: Record<string, Stat>;
  coalesced: number;
  hits: number;
  longTasks: number[];
}
const results: Record<string, unknown> = {};
test.afterAll(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/s7-results.json', JSON.stringify(results, null, 2));
});

const ev = <T>(page: Page, expr: string): Promise<T> => page.evaluate(expr);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function open(page: Page, url: string): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#status')).toHaveText('ready', { timeout: 60_000 });
  await ev(page, `window.__s7.load(${JSON.stringify(url)})`);
}

test('known sheet: endpoint and intersection snaps through the worker path', async ({ page }) => {
  await open(page, '/fixtures/test-sheet.pdf');
  await ev(page, 'window.__s7.extract(0)');
  const ep = await ev<{ kind: string; x: number; y: number }>(
    page,
    'window.__s7.snapOnce(0, 102, 98, 6)',
  );
  const ix = await ev<{ kind: string; x: number; y: number }>(
    page,
    'window.__s7.snapOnce(0, 202, 199, 5)',
  );
  expect(ep).toMatchObject({ kind: 'endpoint', x: 100, y: 100 });
  expect(ix.kind).toBe('intersection');
  expect(ix.x).toBeCloseTo(200, 3);
  expect(ix.y).toBeCloseTo(200, 3);
});

test('dense A1 page: snap RTT (steady), and during PDFium extraction per route', async ({
  page,
}) => {
  test.skip(!existsSync('corpus/PRESSURE-VESSEL-SAMPLE.pdf'), 'corpus file missing');
  await open(page, VESSEL);
  const first = await ev<unknown>(page, 'window.__s7.extract(1)');
  const pointer = (route: string): string =>
    `window.__s7.startPointer('${route}', 1, 1190, 842, 500)`;

  for (const route of ['snap', 'work']) {
    await ev(page, `window.__s7.setPhase('steady')`);
    await ev(page, pointer(route));
    await sleep(3000);
    await ev(page, `window.__s7.setPhase('during-extract')`);
    for (let i = 0; i < 3; i++) await ev(page, 'window.__s7.extract(1)'); // dense page: ~0.3–0.6 s in PDFium
    await ev(page, 'window.__s7.stopPointer()');
    await sleep(200);
  }
  const r = await ev<Report>(page, 'window.__s7.report()');
  results.vessel = { firstExtract: first, ...r };

  expect(r.rtt['snap:steady']?.p95 ?? Infinity).toBeLessThanOrEqual(16);
  expect(r.rtt['work:steady']?.p95 ?? Infinity).toBeLessThanOrEqual(16);
  // The snap worker never waits for PDFium.
  expect(r.rtt['snap:during-extract']?.p95 ?? Infinity).toBeLessThanOrEqual(16);
  expect(r.hits).toBeGreaterThan(0);
  expect(r.longTasks.filter((d) => d > 100)).toEqual([]);
});

test('tiles keep rendering while the Work worker extracts geometry', async ({ page }) => {
  test.skip(!existsSync('corpus/PRESSURE-VESSEL-SAMPLE.pdf'), 'corpus file missing');
  await open(page, VESSEL);
  await ev(page, `(window.__s7.setPhase('baseline'), window.__s7.startTiles(1, 2))`);
  await sleep(3000);
  await ev(page, `window.__s7.setPhase('during-extract')`);
  for (let i = 0; i < 4; i++) await ev(page, 'window.__s7.extract(1)');
  await ev(page, 'window.__s7.stopTiles()');
  const r = await ev<Report>(page, 'window.__s7.report()');
  results.tiles = r.tiles;
  expect(r.tiles['during-extract']?.n ?? 0).toBeGreaterThan(0);
});

test('synthetic 1M-segment sheet: sliced extraction, index and snap RTT (reported)', async ({
  page,
}) => {
  test.skip(!existsSync('spikes/s7-snap/out/dense-1m.pdf'), 'run make-fixtures.ts first');
  await open(page, '/fixtures/dense-1m.pdf');
  const ex = await ev<unknown>(page, 'window.__s7.extract(0, 8)');
  await ev(
    page,
    `(window.__s7.setPhase('steady'), window.__s7.startPointer('snap', 0, 1685, 1192, 1200))`,
  );
  await sleep(3000);
  await ev(page, 'window.__s7.stopPointer()');
  const r = await ev<Report>(page, 'window.__s7.report()');
  results.dense1m = { extract: ex, ...r };
  expect(r.rtt['snap:steady']?.p95 ?? Infinity).toBeLessThanOrEqual(16);
});
