import { cap, drop } from '../support/app.ts';
import { corpusFile } from '../support/compare.ts';
import { expect, test } from '../support/fixtures.ts';
import { skipReviewerPrompt } from '../support/shots.ts';

// M13-02 (D-68, rule 1): the Measure loupe drawn by the Render worker while
// the pointer sweeps over corpus overlay pair 14 (a dense A1 plot plan) with
// Distance and snapping on: at most one loupe request per animation frame,
// pictures keep arriving, and no main-thread task over 100 ms (perf guard).

test('the loupe over the dense A1 plot plan: ≤ 1 request per frame, no long tasks', async ({
  page,
  guard,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await skipReviewerPrompt(page);
  await drop(page, [corpusFile('14', 'new', 'Plot plan RevB.pdf')]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible({ timeout: 30_000 });
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await cap(page, 'view', 'settle', 400);
  await page.getByRole('tab', { name: 'Measure' }).click();
  await page
    .getByRole('toolbar', { name: 'Measure commands' })
    .getByRole('button', { name: 'Distance', exact: true })
    .click();
  // Picking Distance turned snapping on; wait for the page's geometry.
  await expect(page.getByTestId('snap-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(
      async () =>
        ((await cap(page, 'annotate', 'snap')) as { pages: Record<string, string> }).pages[
          `${id}/0`
        ],
      { timeout: 60_000 },
    )
    .toBe('ready');
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  const view = page.viewportSize() ?? { width: 1366, height: 768 };
  const cx = box.x + Math.min(box.width, view.width - box.x) / 2;
  const cy = box.y + Math.min(box.height, view.height - box.y) / 2;
  const before = (await cap(page, 'annotate', 'loupe')) as { requests: number; drawn: number };
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number };
    w.__frames = 0;
    const tick = (): void => {
      w.__frames++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await guard.startMeasuring();
  for (let i = 0; i < 300; i++) {
    const t = i / 10;
    await page.mouse.move(cx + Math.cos(t) * 180, cy + Math.sin(t) * 120);
  }
  await expect(page.getByTestId('measure-loupe')).toBeVisible();
  // The last spot's picture arrives.
  await page.waitForTimeout(500);
  const after = (await cap(page, 'annotate', 'loupe')) as { requests: number; drawn: number };
  const frames = await page.evaluate(() => (window as unknown as { __frames: number }).__frames);
  const requests = after.requests - before.requests;
  const drawn = after.drawn - before.drawn;
  test
    .info()
    .annotations.push(
      { type: 'loupe-requests', description: String(requests) },
      { type: 'loupe-drawn', description: String(drawn) },
      { type: 'frames', description: String(frames) },
    );
  expect(drawn).toBeGreaterThan(5);
  expect(requests).toBeLessThanOrEqual(frames);
});
