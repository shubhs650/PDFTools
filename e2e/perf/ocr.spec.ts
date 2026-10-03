import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// M5-04 (ADR-020, rules 1 and 2): 20 scanned pages recognized while the user
// scrolls them — the Work worker rasters, the OCR worker recognizes, the Work
// worker builds the layer and the Render worker applies it; the main thread
// only passes buffers along. The guard fails any main-thread task over 100 ms.
// Numbers → test-results/m5-ocr.json.

const view = (page: Page, method: string, ...args: unknown[]) => cap(page, 'view', method, ...args);

test('20 scanned pages: OCR while scrolling, no long tasks', async ({ page, pdfs, guard }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');
  await drop(page, [{ name: 'scans.pdf', b64: (await pdfs.scannedPages(20)).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  const docId = ((await cap(page, 'open', 'state')) as { activeId: string }).activeId;
  await cap(page, 'view', 'settle', 400);
  await guard.startMeasuring();
  await view(page, 'reset');
  const t0 = Date.now();
  const running = cap(page, 'ocr', 'run', docId, [...Array(20).keys()]) as Promise<boolean>;
  const scroll = (await view(page, 'autoScroll', 900, 3000)) as { blankFrames: number };
  const ok = await running;
  const ms = Date.now() - t0;
  const last = (await cap(page, 'ocr', 'last')) as { recognized: number; words: number };
  await expect.poll(() => cap(page, 'pages', 'busy')).toBe(false);
  mkdirSync('test-results', { recursive: true });
  writeFileSync(
    'test-results/m5-ocr.json',
    JSON.stringify(
      { ms, pages: 20, perPageMs: Math.round(ms / 20), words: last.words, scroll },
      null,
      2,
    ),
  );
  test.info().annotations.push({ type: 'm5-ocr-20-pages', description: JSON.stringify({ ms }) });
  expect(ok).toBe(true);
  expect(last.recognized).toBe(20);
  expect(scroll.blankFrames).toBe(0);
  expect(await cap(page, 'ocr', 'workerRunning')).toBe(false);
});
