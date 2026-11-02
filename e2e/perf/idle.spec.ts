import { expect, test } from '../support/fixtures.ts';

// Perf gate smoke (M1-02): after boot, an idle app has no long tasks. Real
// §12 scenarios (open, scroll, zoom, save) are added by M1-14, M1-15, M1-22.
test('idle app shell has no main-thread long tasks after boot @smoke', async ({ page, guard }) => {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await guard.startMeasuring();
  await page.waitForTimeout(1000);
});

// Negative control: a deliberate 150 ms busy loop must trip the perf gate.
test('a 150 ms main-thread task trips the perf gate @smoke', async ({ page, guard }) => {
  await page.goto('/');
  await guard.startMeasuring();
  // Run the loop as a real page task: work done inside Playwright's own
  // evaluate call is not reported by the longtask observer.
  await page.evaluate(() => {
    setTimeout(() => {
      const end = performance.now() + 150;
      while (performance.now() < end) {
        // busy
      }
    }, 0);
  });
  await expect
    .poll(async () => Object.keys(await guard.problems(true)))
    .toEqual(['main-thread tasks > 100 ms after boot (rule 1)']);
  await guard.acknowledge();
});
