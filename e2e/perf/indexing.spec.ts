import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { NEEDLE } from '../fixtures/generate.ts';
import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// M2-06 (ADR-006 decision 3): background indexing starts after open, pauses
// while the user scrolls, never blocks the main thread (perf guard), costs
// the visible tiles nothing noticeable, and afterwards a rare term far from
// the viewport is found in < 1 s. Numbers → test-results/m2-indexing.json.

const view = (page: Page, method: string, ...args: unknown[]) => cap(page, 'view', method, ...args);
interface Status {
  state: string;
  done: number;
  total: number;
}
interface Tiles {
  tiles: { p50: number; p95: number };
}

test('2,000-page stand-in: indexing while scrolling, then a rare term far away', async ({
  page,
  pdfs,
  guard,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');
  await drop(page, [{ name: 'contract.pdf', b64: pdfs.contract(2000).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  const docId = ((await cap(page, 'open', 'state')) as { activeId: string }).activeId;
  await guard.startMeasuring();
  const status = async () => (await cap(page, 'search', 'indexStatus', docId)) as Status | null;
  await expect.poll(async () => (await status())?.state).toBe('indexing');

  // Scroll while indexing runs: it pauses meanwhile, so it barely moves.
  const before = (await status())?.done ?? 0;
  await view(page, 'reset');
  const scroll = (await view(page, 'autoScroll', 900, 3000)) as { blankFrames: number };
  const during = (await view(page, 'stats')) as Tiles;
  const afterScroll = (await status())?.done ?? 0;

  // Then it finishes on its own.
  await expect.poll(async () => (await status())?.state, { timeout: 60_000 }).toBe('done');

  // A baseline scroll with the index complete (nothing in the background).
  await view(page, 'settle');
  await view(page, 'reset');
  await view(page, 'autoScroll', 900, 3000);
  const idle = (await view(page, 'stats')) as Tiles;

  const rare = (await cap(page, 'search', 'run', docId, NEEDLE, {}, [0])) as {
    firstHitMs: number;
    summary: { totalHits: number };
  };

  const result = { before, afterScroll, during, idle, scroll, rare };
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/m2-indexing.json', JSON.stringify(result, null, 2));
  test.info().annotations.push({ type: 'm2-indexing', description: JSON.stringify(result) });

  expect(scroll.blankFrames).toBe(0);
  // Paused while scrolling: unpaused it indexes 1,000+ pages in these 3 s; only
  // the edges slip through (status is sampled via 100 ms-throttled progress).
  expect(afterScroll - before).toBeLessThan(200);
  // ADR-006: rare term anywhere < 1 s once indexed (warm).
  expect(rare.summary.totalHits).toBe(3);
  expect(rare.firstHitMs).toBeLessThan(1000);
  // Tiles while indexing is paused vs idle. Medians, as the ADR-012 pane-load
  // gate: a p95 of ~55 tiles in a 3 s window is one or two outliers, and CI
  // runners showed 160 ms p95 with nothing in the background at all. The p95
  // keeps a hard ceiling for a real regression.
  expect(during.tiles.p50).toBeLessThan(idle.tiles.p50 * 1.5 + 20);
  expect(during.tiles.p95).toBeLessThan(400);
});
