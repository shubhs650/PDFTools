import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { compareSide, dropOn, textFile } from '../support/compare.ts';
import { expect, test } from '../support/fixtures.ts';

// M12-19 (D-64, D-66, rule 1): the text comparison of the 500-page contract
// (text pair 17). The comparison runs in the workers and its result arrives
// on the main thread progressively; scrolling either document with the sync
// on (the other follows by content, the bands redraw) and stepping through
// the list add no main-thread task over 100 ms (perf guard). Frame times are
// reported to test-results/m12-compare-text.json.

const viewport = (page: Page, side: 'a' | 'b') => page.getByTestId(`text-view-${side}`);

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

test('scrolling the 500-page text comparison in step adds no long task @smoke', async ({
  page,
  guard,
}) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Compare', exact: true }).click();
  await page.getByRole('button', { name: 'Text Comparison' }).click();
  await dropOn(compareSide(page, 'a'), [textFile('17', 'old', 'Contract RevA.pdf')]);
  await expect(compareSide(page, 'a').getByTestId('compare-file')).toHaveCount(1, {
    timeout: 60_000,
  });
  await dropOn(compareSide(page, 'b'), [textFile('17', 'new', 'Contract RevB.pdf')]);
  await expect(compareSide(page, 'b').getByTestId('compare-file')).toHaveCount(1, {
    timeout: 60_000,
  });
  await guard.startMeasuring();
  const t0 = await page.evaluate(() => performance.now());
  await page
    .getByTestId('compare-input')
    .getByRole('button', { name: 'Compare', exact: true })
    .click();
  // The first changes show while the rest is compared.
  await expect(page.getByTestId('text-list-rows').getByRole('option').first()).toBeAttached({
    timeout: 120_000,
  });
  const firstMs = Math.round((await page.evaluate(() => performance.now())) - t0);
  await expect(page.getByTestId('compare-result')).toHaveAttribute('data-status', 'done', {
    timeout: 240_000,
  });
  const doneMs = Math.round((await page.evaluate(() => performance.now())) - t0);
  const changes = Number(await page.getByTestId('text-list-count').getAttribute('data-count'));
  expect(changes).toBeGreaterThan(0);
  await expect(viewport(page, 'b').locator('.page').first()).toBeVisible();

  // Scroll B down and up with the wheel: A follows by content.
  await viewport(page, 'b').hover();
  const scrollFrames = await frames(page, async () => {
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(30);
    }
    for (let i = 0; i < 20; i++) {
      await page.mouse.wheel(0, -900);
      await page.waitForTimeout(30);
    }
  });
  const a = await viewport(page, 'a').evaluate((vp) => vp.scrollTop);
  expect(a).toBeGreaterThan(0);

  // Step through the list (each step centres both sides).
  const stepFrames = await frames(page, async () => {
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('F8');
      await page.waitForTimeout(40);
    }
  });
  // A jump far down the documents: the last change.
  await page.keyboard.press('Shift+F8');
  await page.getByTestId('text-list-rows').focus();
  await page.keyboard.press('End');

  const pctl = (xs: number[], p: number): number =>
    Math.round([...xs].sort((x, y) => x - y)[Math.floor(xs.length * p)] ?? 0);
  const result = {
    changes,
    firstResultMs: firstMs,
    completeMs: doneMs,
    scroll: {
      frames: scrollFrames.length,
      p95: pctl(scrollFrames, 0.95),
      max: pctl(scrollFrames, 1 - 1e-9),
      over50: scrollFrames.filter((f) => f > 50).length,
    },
    step: {
      frames: stepFrames.length,
      p95: pctl(stepFrames, 0.95),
      max: pctl(stepFrames, 1 - 1e-9),
      over50: stepFrames.filter((f) => f > 50).length,
    },
  };
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/m12-compare-text.json', JSON.stringify(result, null, 2));
  test.info().annotations.push({ type: 'text', description: JSON.stringify(result) });
});
