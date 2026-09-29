import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// M3-18 (ADR-008): snap round trips on the dense A0 sheet stay ≤ 16 ms at p95,
// also while the Work worker is busy with another page's geometry, and the
// main thread has no long tasks.

test('snap RTT p95 ≤ 16 ms on the dense A0 sheet, also during another extraction', async ({
  page,
  pdfs,
  guard,
}) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Perf');
  // Two dense pages: page 2's extraction runs while page 1 is queried.
  await drop(page, [{ name: 'a0.pdf', b64: pdfs.a0(200_000, 2).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await cap(page, 'view', 'settle', 400);
  await page.getByTestId('snap-toggle').click();
  const pages = async () =>
    ((await cap(page, 'annotate', 'snap')) as { pages: Record<string, string> }).pages;
  await expect.poll(async () => (await pages())[`${id}/0`], { timeout: 60_000 }).toBe('ready');
  await page.getByRole('tab', { name: 'Measure' }).click();
  await page
    .getByRole('toolbar', { name: 'Measure commands' })
    .getByRole('button', { name: 'Distance', exact: true })
    .click();
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  await guard.startMeasuring();
  const before = ((await cap(page, 'annotate', 'snap')) as { rtts: number[] }).rtts.length;
  // Page 2's geometry is extracted meanwhile (the Work worker is busy).
  await cap(page, 'annotate', 'snapPrepare', id, 1);
  const cx = box.x + box.width / 2;
  const cy = box.y + Math.min(box.height, 600) / 2;
  for (let i = 0; i < 300; i++) {
    const t = i / 10;
    await page.mouse.move(cx + Math.cos(t) * 200, cy + Math.sin(t) * 150);
  }
  const all = ((await cap(page, 'annotate', 'snap')) as { rtts: number[] }).rtts.slice(before);
  expect(all.length).toBeGreaterThan(50);
  // The extraction was really running while we queried.
  expect(['preparing', 'ready']).toContain((await pages())[`${id}/1`]);
  const sorted = [...all].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  test.info().annotations.push({ type: 'snap-rtt-p95-ms', description: p95.toFixed(2) });
  expect(p95).toBeLessThanOrEqual(16);
});
