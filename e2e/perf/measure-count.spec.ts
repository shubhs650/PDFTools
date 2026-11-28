import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// M14-07 (D-75, plan M14 §7): a sheet with 1,000 counts. Placing them, one
// click each, is set-up: each click is measured and reported, not gated
// (every change of a page makes EmbedPDF draw all of its annotations again,
// about 25–30 ms at 1,000, and a zoom ~200 ms, whatever the annotations).
// Then, gated: Same-size count numbers on and off at a small zoom (1,000
// labels) and the save (one shared caption font) leave the main thread free
// (rule 1).

const STAMP = 13;

test('count: a sheet of 1,000 counts, same-size numbers and the save, no long tasks', async ({
  page,
  pdfs,
  guard,
}) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Perf');
  await drop(page, [{ name: 'a0.pdf', b64: pdfs.a0(2_000).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await cap(page, 'view', 'settle', 400);
  await page.getByRole('tab', { name: 'Measure' }).click();
  await page
    .getByRole('toolbar', { name: 'Measure commands' })
    .getByRole('button', { name: 'Count', exact: true })
    .click();
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  const counts = async () =>
    (((await cap(page, 'annotate', 'objects', id)) as { type: number }[] | null) ?? []).filter(
      (o) => o.type === STAMP,
    ).length;

  // Each click's longest task, reported (not gated).
  await page.evaluate(() => {
    const w = window as unknown as { __countTasks: number[] };
    w.__countTasks = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) w.__countTasks.push(Math.round(e.duration));
    }).observe({ type: 'longtask' });
  });
  const started = Date.now();
  // A 40 × 25 grid of clicks inside the visible part of the sheet.
  const w = Math.min(box.width, 1000) - 40;
  const h = Math.min(box.height, 560) - 40;
  for (let r = 0; r < 25; r++) {
    for (let c = 0; c < 40; c++) {
      const x = box.x + 20 + (c / 39) * w;
      const y = box.y + 20 + (r / 24) * h;
      await page.mouse.move(x, y);
      await page.mouse.click(x, y);
    }
  }
  await expect.poll(counts, { timeout: 120_000 }).toBe(1000);
  test.info().annotations.push({
    type: '1,000 counts placed (s)',
    description: ((Date.now() - started) / 1000).toFixed(1),
  });
  await page.keyboard.press('Escape');
  const tasks = await page.evaluate(
    () => (window as unknown as { __countTasks: number[] }).__countTasks,
  );
  test.info().annotations.push({
    type: 'placing: tasks over 50 ms / over 100 ms / longest (ms)',
    description: `${String(tasks.length)} / ${String(tasks.filter((d) => d > 100).length)} / ${String(Math.max(0, ...tasks))}`,
  });
  // Zoomed out to see the whole grid (set-up too: a zoom makes EmbedPDF draw every
  // annotation of the page again, ~200 ms at 1,000 of any kind, plain squares included).
  const bar = page.getByRole('contentinfo', { name: 'Status bar' });
  const zoom = bar.getByRole('textbox', { name: 'Zoom', exact: true });
  await zoom.fill('25');
  await zoom.press('Enter');
  // The Render worker's last drawings in, then the gated part.
  await cap(page, 'view', 'settle', 2000);
  await page.waitForTimeout(3000);
  await guard.startMeasuring();

  // Same-size count numbers on: a label for each of the 1,000; then off.
  const toggle = bar.getByRole('button', { name: 'Same-Size Count Numbers' });
  await toggle.click();
  await expect(page.getByTestId('count-number-label')).toHaveCount(1000, { timeout: 30_000 });
  await cap(page, 'view', 'settle', 400);
  await toggle.click();
  await expect(page.getByTestId('count-number-label')).toHaveCount(0, { timeout: 30_000 });
  await cap(page, 'view', 'settle', 400);

  // The save: one caption font for all of them.
  const t0 = Date.now();
  const s = (await cap(page, 'save', 'verifiedSave', id)) as { mode: string; tail: string };
  expect(s.mode).toBe('narrow');
  const tail = Buffer.from(s.tail, 'base64').toString('latin1');
  expect(tail.match(/\/FontFile2/g)?.length).toBe(1);
  test.info().annotations.push({
    type: 'save of 1,000 counts (s)',
    description: ((Date.now() - t0) / 1000).toFixed(1),
  });
  await cap(page, 'view', 'settle', 400);
});
