import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// M3-16: drawing a 200-vertex Area measurement on the dense A0 sheet (the live
// value is plain arithmetic per pointer move), then its commit with the value,
// grouped label and staged measure keys, leaves the main thread free (rule 1).

test('area: a 200-vertex polygon on the dense A0 sheet, no long tasks', async ({
  page,
  pdfs,
  guard,
}) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Perf');
  await drop(page, [{ name: 'a0.pdf', b64: pdfs.a0(20_000).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await cap(page, 'view', 'settle', 400);
  await page.getByRole('tab', { name: 'Measure' }).click();
  await page
    .getByRole('toolbar', { name: 'Measure commands' })
    .getByRole('button', { name: 'Area', exact: true })
    .click();
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  await guard.startMeasuring();
  const cx = box.x + box.width / 2;
  const cy = box.y + Math.min(box.height, 600) / 2;
  // A 200-point star-ish ring: clicks with pointer travel between them.
  for (let i = 0; i < 200; i++) {
    const a = (i / 200) * Math.PI * 2;
    const r = i % 2 ? 150 : 220;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 0.9;
    await page.mouse.move(x, y, { steps: 3 });
    await page.mouse.click(x, y);
  }
  await page.keyboard.press('Enter');
  await expect
    .poll(
      async () =>
        ((await cap(page, 'annotate', 'list', id)) as { contents: string | null }[] | null)?.filter(
          (a) => a.contents?.includes('(uncalibrated)'),
        ).length,
      { timeout: 20_000 },
    )
    .toBe(2);
  await cap(page, 'view', 'settle', 400);
});
