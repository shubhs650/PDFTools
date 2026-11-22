import { mkdirSync, writeFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { corpusBytes, corpusPair } from '../fixtures/comparison-corpus/index.ts';
import { expect, test } from '../support/fixtures.ts';

// M12-11 (D-59, rule 1, ADR-032 acceptance "no overlay frame over 50 ms while
// zooming"): zooming and panning the overlay of the dense A1 pair (14, 85,000
// segments) adds no main-thread task over 100 ms (perf guard): the Render
// worker renders, tints and multiplies, the page only places bitmaps.
// Frame times, time to sharp and the worker's grey-tile cache are reported
// to test-results/m12-compare-overlay.json.

const view = (page: Page) => page.getByTestId('overlay-view');

async function dropOn(target: Locator, name: string, bytes: Uint8Array): Promise<void> {
  const b64 = Buffer.from(bytes).toString('base64');
  await target.evaluate(
    (el, f) => {
      const dt = new DataTransfer();
      const data = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
      dt.items.add(new File([data], f.name, { type: 'application/pdf' }));
      for (const type of ['dragenter', 'dragover', 'drop'])
        el.dispatchEvent(
          new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }),
        );
    },
    { name, b64 },
  );
}

async function drawn(page: Page): Promise<number> {
  const t0 = await page.evaluate(() => performance.now());
  await expect(view(page)).toHaveAttribute('data-complete', 'true', { timeout: 60_000 });
  return Math.round((await page.evaluate(() => performance.now())) - t0);
}

/** Frame times (ms) while `run` goes on. */
async function frames(page: Page, run: () => Promise<void>): Promise<number[]> {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __framing: boolean };
    w.__frames = [];
    w.__framing = true;
    let last = performance.now();
    const loop = (t: number): void => {
      if (!w.__framing) return;
      w.__frames.push(t - last);
      last = t;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  await run();
  return page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __framing: boolean };
    w.__framing = false;
    return w.__frames;
  });
}

test('zooming and panning the dense A1 overlay adds no long task @smoke', async ({
  page,
  guard,
}) => {
  test.setTimeout(180_000);
  await page.goto('/');
  const pair = corpusPair('overlay', '14');
  await page.getByRole('tab', { name: 'Compare', exact: true }).click();
  await page.getByRole('button', { name: 'PDF Overlay' }).click();
  await dropOn(page.getByTestId('compare-side-a'), 'plot-a.pdf', corpusBytes(pair, 'old'));
  await expect(page.getByTestId('compare-side-a').getByTestId('compare-file')).toHaveCount(1);
  await dropOn(page.getByTestId('compare-side-b'), 'plot-b.pdf', corpusBytes(pair, 'new'));
  await expect(page.getByTestId('compare-pairing')).toHaveAttribute('data-status', 'done', {
    timeout: 60_000,
  });
  await guard.startMeasuring();
  const t0 = await page.evaluate(() => performance.now());
  await page
    .getByTestId('compare-input')
    .getByRole('button', { name: 'Compare', exact: true })
    .click();
  await expect(view(page)).toHaveAttribute('data-complete', 'true', { timeout: 60_000 });
  const firstMs = Math.round((await page.evaluate(() => performance.now())) - t0);

  // A zoom gesture: Ctrl+wheel steps over the middle of the sheet, then settle.
  const box = await view(page).boundingBox();
  if (!box) throw new Error('no overlay');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const zoomFrames = await frames(page, async () => {
    for (let i = 0; i < 12; i++) {
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -120);
      await page.keyboard.up('Control');
      await page.waitForTimeout(80);
    }
  });
  const zoomSharpMs = await drawn(page);
  const zoom = Number(await view(page).getAttribute('data-zoom'));
  expect(zoom).toBeGreaterThan(4);

  // Pan: drag across the sheet a few times.
  const panFrames = await frames(page, async () => {
    for (let i = 0; i < 6; i++) {
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4, { steps: 8 });
      await page.mouse.up();
    }
  });
  const panSharpMs = await drawn(page);

  // A style change re-composes from the cached grey tiles.
  const t1 = await page.evaluate(() => performance.now());
  await page
    .getByRole('toolbar', { name: 'Overlay controls' })
    .getByRole('button', {
      name: 'Fade unchanged',
    })
    .click();
  await drawn(page);
  const styleMs = Math.round((await page.evaluate(() => performance.now())) - t1);

  const pctl = (xs: number[], p: number): number =>
    Math.round([...xs].sort((a, b) => a - b)[Math.floor(xs.length * p)] ?? 0);
  const result = {
    firstSheetMs: firstMs,
    zoom: {
      frames: zoomFrames.length,
      p95: pctl(zoomFrames, 0.95),
      max: pctl(zoomFrames, 1 - 1e-9),
      over50: zoomFrames.filter((f) => f > 50).length,
      sharpMs: zoomSharpMs,
      zoom,
    },
    pan: {
      frames: panFrames.length,
      p95: pctl(panFrames, 0.95),
      over50: panFrames.filter((f) => f > 50).length,
      sharpMs: panSharpMs,
    },
    styleChangeMs: styleMs,
  };
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/m12-compare-overlay.json', JSON.stringify(result, null, 2));
  test.info().annotations.push({ type: 'overlay', description: JSON.stringify(result) });
});
