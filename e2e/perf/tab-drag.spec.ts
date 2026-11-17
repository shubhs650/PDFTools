import { drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';
import { skipReviewerPrompt } from '../support/shots.ts';

// M11-04 (ADR-028 D-50): dragging file tabs, with motion on and a 200-page document
// open, never blocks the main thread (perf guard: no task > 100 ms, rule 1). Each
// drag only sets transforms; the measures are taken once when a tab lifts.

test('dragging and moving file tabs adds no long task', async ({ page, pdfs, guard }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await skipReviewerPrompt(page);
  await drop(page, [{ name: 'contract.pdf', b64: pdfs.contract(200).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  const tabs = page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
  for (let i = 0; i < 11; i++) {
    await drop(page, [
      { name: `Sheet ${String(i + 1)} - drawing.pdf`, b64: pdfs.simple(i + 1).toString('base64') },
    ]);
    await expect(tabs).toHaveCount(i + 2);
  }
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await guard.startMeasuring();

  const list = page.locator('.tab-list');
  // Motion is on here: wait for the tabs' slides to finish before reading their boxes.
  const settled = () =>
    page.waitForFunction(() =>
      [...document.querySelectorAll('.tab-button, .tab-close')].every(
        (el) => el.getAnimations().length === 0,
      ),
    );
  const rowBox = await list.boundingBox();
  const add = await page.locator('.tab-add').boundingBox();
  for (let round = 0; round < 3; round++) {
    // The first tab dragged to the far end (the row auto-scrolls), then back.
    await list.evaluate((el) => {
      el.scrollLeft = 0;
    });
    await settled();
    const first = await tabs.nth(0).boundingBox();
    const y = (first?.y ?? 0) + (first?.height ?? 0) / 2;
    await page.mouse.move((first?.x ?? 0) + 20, y);
    await page.mouse.down();
    await page.mouse.move((add?.x ?? 0) - 10, y, { steps: 30 });
    // Held until the row has scrolled to its end (a slow runner takes longer).
    await expect
      .poll(
        () => list.evaluate((el) => Math.ceil(el.scrollLeft + el.clientWidth) >= el.scrollWidth),
        { timeout: 15_000 },
      )
      .toBe(true);
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.waitForTimeout(300);
    await expect(tabs.nth(11)).toHaveAccessibleName('contract.pdf');
    await settled();
    const last = await tabs.nth(11).boundingBox();
    await page.mouse.move((last?.x ?? 0) + 20, y);
    await page.mouse.down();
    await page.mouse.move((rowBox?.x ?? 0) + 4, y, { steps: 30 });
    await expect.poll(() => list.evaluate((el) => el.scrollLeft), { timeout: 15_000 }).toBe(0);
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.waitForTimeout(300);
    await expect(tabs.nth(0)).toHaveAccessibleName('contract.pdf');
    // Keys: a tab walked along the row and back.
    await tabs.nth(0).focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press('Control+Shift+ArrowRight');
    for (let i = 0; i < 5; i++) await page.keyboard.press('Control+Shift+ArrowLeft');
  }
  const longTasks = await guard.longTasksOverLimit();
  test.info().annotations.push({
    type: 'm11-04-tab-drag',
    description: JSON.stringify({ rounds: 3, longTasks }),
  });
});
