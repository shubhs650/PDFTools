import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { corpusBytes, corpusPair } from '../fixtures/comparison-corpus/index.ts';
import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// M12-07 (D-66, rule 1): a running comparison — signatures, positioned text
// and 150 dpi analysis rasters of the two large-format sheets of corpus pair
// 13 (ARCH D and ARCH E), read by the Work worker and folded in by the
// Compare worker — adds no main-thread task over 100 ms (perf guard), and a
// search started meanwhile on a 2,000-page document is not held up behind it.
// Closing the comparison gives the Compare worker's memory back.
// Numbers → test-results/m12-compare-worker.json.

interface SearchRun {
  firstHitMs: number | null;
  totalMs: number;
}

interface Status {
  progress: { done: number; failed: number; total: number; running: number } | null;
  sheets: { sheet: number; ms: number; identical: boolean; rows: number; height: number }[];
  errors: { key: string; code: string }[];
  doneMs: number | null;
}

const compare = (page: Page, method: string, ...args: unknown[]) =>
  cap(page, 'compare', method, ...args);

async function openFile(page: Page, name: string, bytes: Uint8Array | Buffer): Promise<string> {
  await drop(page, [{ name, b64: Buffer.from(bytes).toString('base64') }]);
  await expect(page.getByRole('tab', { name })).toBeVisible();
  return ((await cap(page, 'open', 'state')) as { activeId: string }).activeId;
}

test('a running comparison adds no long task and does not delay search @smoke', async ({
  page,
  pdfs,
  guard,
}) => {
  test.setTimeout(180_000);
  await page.goto('/');
  const pair = corpusPair('overlay', '13');
  const contractId = await openFile(page, 'contract.pdf', pdfs.contract(2000));
  await page.locator('[data-page="0"] img.page-preview').first().waitFor();
  const aId = await openFile(page, 'sheet-a.pdf', corpusBytes(pair, 'old'));
  const bId = await openFile(page, 'sheet-b.pdf', corpusBytes(pair, 'new'));

  await guard.startMeasuring();
  // Cold search builds the text cache; the warm one is the baseline.
  await cap(page, 'search', 'run', contractId, 'contractor');
  const baseline = (await cap(page, 'search', 'run', contractId, 'contractor')) as SearchRun;

  const started = (await compare(page, 'start', aId, pair.oldPages, bId, pair.newPages, {
    focus: 1,
  })) as { sheets: number };
  expect(started.sheets).toBe(2);
  // Search again and again while the comparison reads pages and renders its bands.
  const during: SearchRun[] = [];
  for (;;) {
    const busy = ((await compare(page, 'status')) as Status).doneMs === null;
    if (!busy) break;
    const run = (await cap(page, 'search', 'run', contractId, 'contractor')) as SearchRun;
    if (((await compare(page, 'status')) as Status).doneMs === null) during.push(run);
    else if (during.length === 0) during.push(run); // overlapped at least its start
  }
  const slowest = during.reduce((m, r) => Math.max(m, r.firstHitMs ?? Infinity), 0);

  await expect
    .poll(async () => ((await compare(page, 'status')) as Status).doneMs, { timeout: 120_000 })
    .not.toBeNull();
  const status = (await compare(page, 'status')) as Status;
  const memory = (await compare(page, 'memory')) as { running: boolean; bytes: number };
  const closed = (await compare(page, 'close')) as { running: boolean; open: number };

  const result = {
    baseline,
    during: during.map((r) => r.firstHitMs),
    slowestFirstHitMs: slowest,
    sheets: status.sheets,
    doneMs: status.doneMs,
    progress: status.progress,
    memoryBeforeClose: memory,
    afterClose: closed,
  };
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/m12-compare-worker.json', JSON.stringify(result, null, 2));
  test.info().annotations.push({ type: 'm12-compare-worker', description: JSON.stringify(result) });

  expect(status.errors).toEqual([]);
  expect(status.progress).toMatchObject({ failed: 0, done: status.progress?.total });
  expect(status.sheets).toHaveLength(2);
  // The viewed sheet (1, the ARCH E sheet) came first.
  expect(status.sheets[0]?.sheet).toBe(1);
  for (const s of status.sheets) {
    expect(s.rows).toBe(s.height);
    expect(s.identical).toBe(false);
  }
  // Search is interactive work: it takes over the Work worker at the comparison's next band.
  expect(during.length).toBeGreaterThan(0);
  expect(slowest).toBeLessThan(1000);
  expect(slowest).toBeLessThan((baseline.firstHitMs ?? 0) + 500);
  // The material was held in the Compare worker, and closing gave it back.
  expect(memory.running).toBe(true);
  expect(memory.bytes).toBeGreaterThan(0);
  expect(closed).toMatchObject({ running: false, open: 0 });
});
