import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// M4-09 (ADR-016 consequences): delete 1,000 of the 2,000-page stand-in's
// pages and undo it — the Render worker deletes, snapshots and reopens; the
// main thread only re-lays the page list out. No main-thread task > 100 ms.

test('delete 1,000 of 2,000 pages and undo: no long tasks', async ({ page, pdfs, guard }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await drop(page, [{ name: 'contract.pdf', b64: pdfs.contract(2000).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await cap(page, 'view', 'settle', 400);
  await guard.startMeasuring();
  const t0 = Date.now();
  const pages = Array.from({ length: 1000 }, (_, i) => i * 2 + 1);
  expect(await cap(page, 'pages', 'run', id, { kind: 'delete', pages })).toBe(true);
  await expect
    .poll(async () => ((await cap(page, 'pages', 'info', id)) as unknown[]).length)
    .toBe(1000);
  const deleteMs = Date.now() - t0;
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  const t1 = Date.now();
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await expect
    .poll(async () => ((await cap(page, 'pages', 'info', id)) as unknown[]).length, {
      timeout: 60_000,
    })
    .toBe(2000);
  await expect.poll(() => cap(page, 'pages', 'busy')).toBe(false);
  test
    .info()
    .annotations.push(
      { type: 'pages-delete-1000-ms', description: String(deleteMs) },
      { type: 'pages-undo-ms', description: String(Date.now() - t1) },
    );
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await cap(page, 'view', 'settle', 400);
});

test('drag a thumbnail through the 2,000-page pane with auto-scroll: no long tasks', async ({
  page,
  pdfs,
  guard,
}) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await drop(page, [{ name: 'contract.pdf', b64: pdfs.contract(2000).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  const list = page.getByRole('listbox', { name: 'Page thumbnails' });
  const first = list.getByRole('option', { name: '1', exact: true });
  await expect(first.locator('img')).toBeVisible();
  await cap(page, 'view', 'settle', 400);
  const from = await first.boundingBox();
  const box = await list.boundingBox();
  if (!from || !box) throw new Error('no thumbnails');
  await guard.startMeasuring();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Held near the bottom edge: the list scrolls down for 3 s.
  await page.mouse.move(from.x + from.width / 2, box.y + box.height - 8, { steps: 10 });
  await page.waitForTimeout(3000);
  expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(1000);
  await page.mouse.up();
  await expect.poll(() => cap(page, 'pages', 'busy'), { timeout: 60_000 }).toBe(false);
  // Page 1 moved down the document.
  const info = (await cap(page, 'pages', 'info', id)) as { obj: number }[];
  expect(info).toHaveLength(2000);
  expect(info[0]?.obj).not.toBe(3);
});
