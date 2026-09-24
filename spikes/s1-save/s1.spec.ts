import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// M0-S1 browser checks (docs/plan/M0.md §S1, ADR-005): Ctrl+S path in a worker
// (PDFium incremental → narrow tail → OPFS append) and its timing. Correctness
// of the saved files is covered by spikes/s1-save/run-node.ts.

interface Scenario {
  endToEndMs: number;
  saveMs: number;
  writableAppendMs: number;
  syncTailMs: number;
  narrowTailBytes: number;
  fullTailBytes: number;
  appendedFileCorrect: boolean;
  syncFileCorrect: boolean;
  mainThreadLongTasks: number[];
}

const results: Record<string, unknown> = {};
test.afterAll(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/s1-results.json', JSON.stringify(results, null, 2));
});

async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#status')).toHaveText('ready', { timeout: 60_000 });
}

const run = (page: Page, name: string, markups: number, url?: string): Promise<Scenario> =>
  page.evaluate(
    ([n, m, u]) =>
      (window.__s1.scenario as (a: string, b: number, c?: string) => Promise<Scenario>)(n, m, u),
    [name, markups, url] as const,
  );

test('small file: 100 markups, incremental save + OPFS append under 1 s, bytes verified', async ({
  page,
}) => {
  await ready(page);
  const runs: Scenario[] = [];
  for (let i = 0; i < 5; i++) runs.push(await run(page, 'plain.pdf', 100));
  results.small = runs;
  for (const r of runs) {
    expect(r.appendedFileCorrect).toBe(true);
    expect(r.syncFileCorrect).toBe(true);
    expect(r.endToEndMs).toBeLessThan(1000);
    expect(r.mainThreadLongTasks.filter((d) => d > 100)).toEqual([]);
  }
});

test('signed and encrypted inputs take the same path', async ({ page }) => {
  await ready(page);
  for (const f of ['signed.pdf', 'encrypted-aes256.pdf', 'objstm.pdf']) {
    const r = await run(page, f, 100);
    results[f] = r;
    expect(r.appendedFileCorrect).toBe(true);
    expect(r.endToEndMs).toBeLessThan(1000);
  }
});

test('large public file (23 MB): timings reported (ADR-002 measure-and-report)', async ({
  page,
}) => {
  test.skip(!existsSync('corpus/bearing catalogue.pdf'), 'corpus/bearing catalogue.pdf missing');
  await ready(page);
  const r = await run(
    page,
    'catalogue',
    1,
    `/corpus/${encodeURIComponent('bearing catalogue.pdf')}`,
  );
  results.large = r;
  expect(r.appendedFileCorrect).toBe(true);
  expect(r.narrowTailBytes).toBeLessThan(10_000);
  expect(r.mainThreadLongTasks.filter((d) => d > 100)).toEqual([]);
});
