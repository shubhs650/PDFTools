import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// M3-09: drawing a 2,000-point pencil stroke on the dense A0 sheet, then its
// commit (PDFium writes the ink and its appearance in the Render worker),
// leaves the main thread free (rule 1).

test('pencil: a 2,000-point stroke on the dense A0 sheet, no long tasks', async ({
  page,
  pdfs,
  guard,
}) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Perf');
  await drop(page, [{ name: 'a0.pdf', b64: pdfs.a0(20_000).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await cap(page, 'view', 'settle', 400);
  await page.getByRole('tab', { name: 'Comment' }).click();
  await page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name: 'Pencil', exact: true })
    .click();
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  await guard.startMeasuring();
  const cx = box.x + box.width / 2;
  const cy = box.y + Math.min(box.height, 600) / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  // A spiral: 20 waypoints, 100 pointer moves each (2,000 points).
  for (let i = 1; i <= 20; i++) {
    const t = i * 2.5;
    await page.mouse.move(cx + Math.cos(t) * t * 12, cy + Math.sin(t) * t * 12, { steps: 100 });
  }
  await page.mouse.up();
  await expect
    .poll(async () => ((await cap(page, 'annotate', 'list', id)) as unknown[] | null)?.length, {
      timeout: 15_000,
    })
    .toBe(1);
  await cap(page, 'view', 'settle', 400);
});
