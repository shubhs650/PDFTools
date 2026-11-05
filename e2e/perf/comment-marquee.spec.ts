import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// M7-04 (B7, rule 1): a marquee drag over the A0 sheet with 1,000 comments on
// its one page, with Select Comments: the rectangle follows the pointer and the
// pick (every comment it touches) and the group's selection boxes leave the
// main thread free (the guard: no task over 100 ms). The selection is set in a
// React transition, so the plugin's 1,000 comment boxes re-render in slices.
//
// No trace here: Playwright's trace snapshots walk the whole DOM (1,000
// comment boxes) on the page's main thread at every action, which the guard
// would count against the app (seen in a CPU profile: ~110 ms per snapshot).
test.use({ trace: 'off' });

test('marquee over 1,000 comments on a page: no long tasks', async ({ page, pdfs, guard }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await drop(page, [
    { name: 'marked-a0.pdf', b64: pdfs.markedSheet(200, 1000).toString('base64') },
  ]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect
    .poll(async () => ((await cap(page, 'annotate', 'list', id)) as unknown[] | null)?.length)
    .toBe(1000);
  // Select Comments and Select Text left Home in M7-09 (Comment tab).
  await page.getByRole('tab', { name: 'Comment', exact: true }).click();
  await page.getByRole('button', { name: 'Select Comments', exact: true }).click();
  await cap(page, 'view', 'settle', 400);
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  const vp = await page.getByTestId('document-view').boundingBox();
  if (!box || !vp) throw new Error('page not laid out');
  await guard.startMeasuring();

  // From the page's top-left corner to the bottom-right of what is on screen.
  const from = { x: box.x + 4, y: box.y + 4 };
  const to = {
    x: Math.min(box.x + box.width, vp.x + vp.width) - 20,
    y: Math.min(box.y + box.height, vp.y + vp.height) - 20,
  };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 30 });
  await page.mouse.up();
  await expect
    .poll(async () => ((await cap(page, 'annotate', 'selected', id)) as string[]).length)
    .toBeGreaterThan(300);
  await cap(page, 'view', 'settle', 400);
  // And Esc drops them all again.
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => ((await cap(page, 'annotate', 'selected', id)) as string[]).length)
    .toBe(0);
  await cap(page, 'view', 'settle', 400);
});
