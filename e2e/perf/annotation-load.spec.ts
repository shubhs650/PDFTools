import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// M3-01 (ADR-014): EmbedPDF's plugin-annotation loads every annotation of a
// document once, on load, with engine.getAllAnnotations — getAnnotationsBatch
// calls of 500 pages each, LOW priority, each one uninterruptible on the Render
// worker's one-call-at-a-time queue. What does that cost the visible tiles while
// scrolling the 2,000-page stand-in with 10,000 markups (5 per page), and the
// main thread when 10,000 annotation objects arrive? Numbers go to
// test-results/m3-annotation-load.json (informative, ADR-002); the gate is the
// perf guard (no main-thread task > 100 ms, rule 1).

const view = (page: Page, method: string, ...args: unknown[]) => cap(page, 'view', method, ...args);

interface TileStats {
  tiles: { p50: number; p95: number; max: number; done: number };
}

async function scrollWith(page: Page, from: number, withLoad: boolean) {
  await view(page, 'scrollTo', Math.round(((await view(page, 'scrollHeight')) as number) * from));
  await view(page, 'settle');
  await view(page, 'reset');
  const scroll = view(page, 'autoScroll', 900, 4000);
  const load = withLoad ? view(page, 'engineLoad', 'allAnnotations', [0], 1) : null;
  const [s, l] = await Promise.all([scroll, load]);
  await view(page, 'settle');
  return { scroll: s, tiles: ((await view(page, 'stats')) as TileStats).tiles, load: l };
}

test('loading every annotation through the Render queue vs visible tiles', async ({
  page,
  pdfs,
  guard,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');
  await drop(page, [{ name: 'marked.pdf', b64: pdfs.markedContract(2000, 5).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await view(page, 'settle');
  await guard.startMeasuring();

  const contract = {
    baseline: await scrollWith(page, 0, false),
    allAnnotations: await scrollWith(page, 0.3, true),
    baselineAgain: await scrollWith(page, 0.6, false),
  };
  const result = { contract, longTasks: await guard.longTasksOverLimit() };
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/m3-annotation-load.json', JSON.stringify(result, null, 2));
  test.info().annotations.push({ type: 'm3-annotation-load', description: JSON.stringify(result) });
  expect((contract.baseline.scroll as { blankFrames: number }).blankFrames).toBe(0);
});
