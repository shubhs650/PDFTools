import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// M4-04 (ADR-009 decision 2, rules 1 and 2): PDF Oxide's load and warm-up
// (~0.7 s of WASM compile and first call, in the Work worker) and then a
// 2,000-page text extraction run while the user scrolls the stand-in. The
// guard fails any main-thread task over 100 ms; tiles must keep up.
// Numbers → test-results/m4-oxide.json.

const view = (page: Page, method: string, ...args: unknown[]) => cap(page, 'view', method, ...args);

test('2,000-page stand-in: Oxide warm-up and a full text extraction while scrolling', async ({
  page,
  pdfs,
  guard,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');
  await drop(page, [{ name: 'contract.pdf', b64: pdfs.contract(2000).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  const docId = ((await cap(page, 'open', 'state')) as { activeId: string }).activeId;
  await guard.startMeasuring();

  await view(page, 'reset');
  const warming = cap(page, 'extract', 'warm') as Promise<{ warmUpMs: number; mainMs: number }>;
  const scrollWarm = (await view(page, 'autoScroll', 900, 2000)) as { blankFrames: number };
  const warm = await warming;

  await view(page, 'reset');
  const all = [...Array(2000).keys()];
  const running = cap(page, 'extract', 'run', docId, all) as Promise<{
    ok: boolean;
    ms: number;
    pages: number;
  }>;
  const scrollRun = (await view(page, 'autoScroll', 900, 3000)) as { blankFrames: number };
  const tiles = (await view(page, 'stats')) as { tiles: { p50: number; p95: number } };
  const run = await running;

  const result = { warm, scrollWarm, run: { ms: run.ms, pages: run.pages }, scrollRun, tiles };
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/m4-oxide.json', JSON.stringify(result, null, 2));
  test.info().annotations.push({ type: 'm4-oxide', description: JSON.stringify(result) });

  expect(run.ok).toBe(true);
  expect(run.pages).toBe(2000);
  expect(scrollWarm.blankFrames).toBe(0);
  expect(scrollRun.blankFrames).toBe(0);
  expect(tiles.tiles.p95).toBeLessThan(400);
});
