import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// M2-01 (ADR-012): what the M2 panes and the text layer would cost the visible
// tiles if their engine calls went through the Render worker's queue (EmbedPDF
// PdfEngine, one call at a time). Tiles are measured while scrolling the
// 2,000-page stand-in at 900 px/s, alone and with text-geometry or thumbnail
// load, and while zooming the dense A0 sheet with a thumbnail render queued.
// Numbers go to test-results/m2-pane-load.json (informative, ADR-002); the gate
// here is the perf guard (no main-thread task > 100 ms, rule 1).
//
// Since M2-04 the text geometry goes to the Work worker (RoutedPdfEngine), and
// every scroll run already loads the text layer of the pages it passes. The
// "geometry" run is a synthetic worst case (120 back-to-back calls): through
// the Render queue it tripled tile p50; the gate keeps it well under that.

const view = (page: Page, method: string, ...args: unknown[]) => cap(page, 'view', method, ...args);

interface TileStats {
  tiles: { p50: number; p95: number; max: number; done: number };
}

async function scrollWith(
  page: Page,
  from: number,
  load: null | { method: string; pages: number[] },
): Promise<Record<string, unknown>> {
  // Each run starts at a different place, so no run reuses cached tiles.
  await view(page, 'scrollTo', Math.round(((await view(page, 'scrollHeight')) as number) * from));
  await view(page, 'settle');
  await view(page, 'reset');
  const scroll = view(page, 'autoScroll', 900, 4000);
  const loadResult = load ? view(page, 'engineLoad', load.method, load.pages, 1) : null;
  const [s, l] = await Promise.all([scroll, loadResult]);
  await view(page, 'settle');
  const stats = (await view(page, 'stats')) as TileStats;
  return { scroll: s, tiles: stats.tiles, load: l };
}

test('pane and text-layer load through the Render queue vs visible tiles', async ({
  page,
  pdfs,
  guard,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');
  await drop(page, [{ name: 'contract.pdf', b64: pdfs.contract(2000).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await view(page, 'settle');
  await guard.startMeasuring();

  const pages = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);
  const contract = {
    baseline: await scrollWith(page, 0, null),
    geometry: await scrollWith(page, 0.25, { method: 'geometry', pages: pages(500, 120) }),
    thumbnails: await scrollWith(page, 0.5, { method: 'thumbnail', pages: pages(1000, 400) }),
    baselineAgain: await scrollWith(page, 0.75, null),
  };

  // Dense A0: one thumbnail render of the only page is queued right before a
  // zoom; the zoom's tiles wait behind it.
  await page.goto('/');
  await drop(page, [{ name: 'a0.pdf', b64: pdfs.a0(200_000).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await view(page, 'settle');
  await guard.startMeasuring();
  const a0: Record<string, unknown> = {};
  for (const [name, zoom, withThumb] of [
    ['zoom800', 8, false],
    ['zoom600WithThumbnail', 6, true],
  ] as const) {
    await view(page, 'zoom', 1);
    await view(page, 'settle');
    await view(page, 'reset');
    const thumb = withThumb ? view(page, 'engineLoad', 'thumbnail', [0], 1) : null;
    await view(page, 'zoom', zoom);
    const [t] = await Promise.all([thumb, view(page, 'settle')]);
    a0[name] = { tiles: ((await view(page, 'stats')) as TileStats).tiles, thumbnail: t };
  }

  const result = { contract, a0, longTasks: await guard.longTasksOverLimit() };
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/m2-pane-load.json', JSON.stringify(result, null, 2));
  test.info().annotations.push({ type: 'm2-pane-load', description: JSON.stringify(result) });
  expect((contract.baseline.scroll as { blankFrames: number }).blankFrames).toBe(0);
  const p50 = (run: Record<string, unknown>) => (run.tiles as TileStats['tiles']).p50;
  expect(p50(contract.geometry)).toBeLessThan(2 * p50(contract.baseline) + 5);
});
