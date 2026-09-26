import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { NEEDLE } from '../fixtures/generate.ts';
import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// §12 / ADR-006 (M2-05): search the 2,000-page stand-in in the Work worker —
// first hits < 1 s, complete < 15 s, no main-thread task > 100 ms (perf guard),
// a new search cancels the old one with no stale results, and the 5,000-hit
// context cap keeps a huge result cheap. Numbers → test-results/m2-search.json.

const search = (page: Page, method: string, ...args: unknown[]) =>
  cap(page, 'search', method, ...args);

interface Run {
  firstHitMs: number | null;
  totalMs: number;
  hits: number;
  counted: number;
  batches: number;
  summary: { totalHits: number; detailedHits: number; ms: number };
}

test('2,000-page stand-in: cold and warm searches, cap and supersede', async ({
  page,
  pdfs,
  guard,
}) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await drop(page, [{ name: 'contract.pdf', b64: pdfs.contract(2000).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  const docId = ((await cap(page, 'open', 'state')) as { activeId: string }).activeId;
  await guard.startMeasuring();

  const common = (await search(page, 'run', docId, 'contractor')) as Run; // cold: builds the text cache
  const rareFar = (await search(page, 'run', docId, NEEDLE)) as Run; // warm
  const regex = (await search(page, 'run', docId, 'e', { regex: true })) as Run; // huge

  // A second, cold document: its first search is still running when the next starts.
  await drop(page, [{ name: 'contract-b.pdf', b64: pdfs.contract(1999).toString('base64') }]);
  await expect(page.getByRole('tab', { name: 'contract-b.pdf' })).toBeVisible();
  const otherId = ((await cap(page, 'open', 'state')) as { activeId: string }).activeId;
  const supersede = (await search(page, 'supersede', otherId, 'shall', 'offeror', 300)) as {
    outcome: string;
    stopMs: number;
    staleAfterNew: number;
  };

  const result = { common, rareFar, regex, supersede };
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/m2-search.json', JSON.stringify(result, null, 2));
  test.info().annotations.push({ type: 'm2-search', description: JSON.stringify(result) });

  // §12 (typical files; the owner's machine is authoritative, ADR-002).
  expect(common.firstHitMs).not.toBeNull();
  expect(common.firstHitMs ?? Infinity).toBeLessThan(1000);
  expect(common.totalMs).toBeLessThan(15_000);
  expect(common.summary.totalHits).toBeGreaterThan(2000);
  expect(rareFar.summary.totalHits).toBe(3);
  expect(rareFar.firstHitMs ?? Infinity).toBeLessThan(1000);
  // ADR-006 decision 2: 5,000 with context, the rest as counts, the total exact.
  expect(regex.hits).toBe(5000);
  expect(regex.hits + regex.counted).toBe(regex.summary.totalHits);
  expect(supersede.outcome).toBe('cancelled');
  expect(supersede.staleAfterNew).toBe(0);
  expect(supersede.stopMs).toBeLessThan(100);
});
