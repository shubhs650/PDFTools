import type { Page } from '@playwright/test';
import { drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M11-04 (ADR-028 D-50): file tabs reorder by dragging (Chrome-like: lift, the others
// slide, auto-scroll near the row's ends, Esc puts it back), by Ctrl+Shift+Left/Right on
// a focused tab, and each move is announced. A middle-click closes a tab.

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
const names = (page: Page) =>
  tabs(page).evaluateAll((els) => els.map((el) => el.querySelector('.tab-name')?.textContent));
const announced = (page: Page) => page.locator('.tab-strip .tab-moved[aria-live="polite"]');

async function openTabs(page: Page, pdfs: { simple(n: number): Buffer }, list: string[]) {
  // One at a time, so the tabs are in this order (opens finish in any order); each a
  // different file (the same file twice only selects its tab).
  for (const [i, name] of list.entries()) {
    await drop(page, [{ name, b64: pdfs.simple(i + 1).toString('base64') }]);
    await expect(tabs(page)).toHaveCount(i + 1);
  }
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
}

const box = async (page: Page, i: number) => {
  const b = await tabs(page).nth(i).boundingBox();
  if (!b) throw new Error(`tab ${String(i)} has no box`);
  return b;
};

/** Presses tab `i`, moves to x (in steps, as a hand does), and leaves the button down. */
async function lift(page: Page, i: number, x: number): Promise<void> {
  const b = await box(page, i);
  const y = b.y + b.height / 2;
  await page.mouse.move(b.x + 20, y);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 12 });
}

async function dragTo(page: Page, i: number, x: number): Promise<void> {
  await lift(page, i, x);
  await page.mouse.up();
}

const FOUR = ['alpha.pdf', 'bravo.pdf', 'charlie.pdf', 'delta.pdf'];

test('dragging the first tab to the end, the middle and back again reorders the tabs @smoke', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await openTabs(page, pdfs, FOUR);
  // To the end: the dragged tab is dropped there and selected.
  const last = await box(page, 3);
  await dragTo(page, 0, last.x + last.width - 10);
  await expect
    .poll(() => names(page))
    .toEqual(['bravo.pdf', 'charlie.pdf', 'delta.pdf', 'alpha.pdf']);
  await expect(tabs(page).nth(3)).toHaveAttribute('aria-selected', 'true');
  await expect(announced(page)).toHaveText('Moved to position 4 of 4');
  // The last tab into the middle (past bravo's centre, not charlie's).
  const charlie = await box(page, 1);
  await dragTo(page, 3, charlie.x + 4);
  await expect
    .poll(() => names(page))
    .toEqual(['bravo.pdf', 'alpha.pdf', 'charlie.pdf', 'delta.pdf']);
  await expect(announced(page)).toHaveText('Moved to position 2 of 4');
  // And to the start.
  const first = await box(page, 0);
  await dragTo(page, 1, first.x - 30);
  await expect
    .poll(() => names(page))
    .toEqual(['alpha.pdf', 'bravo.pdf', 'charlie.pdf', 'delta.pdf']);
  // The document shown is the dragged one.
  await expect(tabs(page).nth(0)).toHaveAttribute('aria-selected', 'true');
  // Settled: nothing is left translated or lifted.
  expect(
    await page
      .locator('.tab-button, .tab-close')
      .evaluateAll((els) => els.filter((el) => (el as HTMLElement).style.transform).length),
  ).toBe(0);
  await expect(page.locator('.tab--dragging')).toHaveCount(0);
});

test('a lifted tab follows the pointer, the others make room, Esc puts it back', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await openTabs(page, pdfs, FOUR);
  await tabs(page).nth(1).click();
  const start = await box(page, 0);
  const third = await box(page, 2);
  await lift(page, 0, third.x + third.width / 2 + 30);
  // Lifted: raised, under the pointer, no hover card.
  await expect(tabs(page).nth(0)).toHaveClass(/tab--dragging/);
  await expect(page.locator('.tab-list')).toHaveClass(/tab-list--dragging/);
  const lifted = await box(page, 0);
  expect(lifted.x).toBeGreaterThan(start.x + 100);
  await expect(page.getByTestId('tab-card')).toHaveCount(0);
  // Bravo and charlie slid left to make room; delta stayed.
  const shift = (i: number) =>
    page
      .locator('.tab-button')
      .nth(i)
      .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
  await expect.poll(() => shift(1)).toBeLessThan(-50);
  await expect.poll(() => shift(2)).toBeLessThan(-50);
  expect(await shift(3)).toBe(0);
  // Esc: back where it was, nothing reordered, the selection unchanged.
  await page.keyboard.press('Escape');
  await expect(tabs(page).nth(0)).not.toHaveClass(/tab--dragging/);
  await page.mouse.up();
  expect(await names(page)).toEqual(FOUR);
  await expect.poll(() => shift(1)).toBe(0);
  await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
});

test('a short press is still a click; a 3 px wobble does not lift the tab', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await openTabs(page, pdfs, FOUR);
  const b = await box(page, 1);
  await page.mouse.move(b.x + 20, b.y + 10);
  await page.mouse.down();
  await page.mouse.move(b.x + 23, b.y + 10);
  await expect(page.locator('.tab--dragging')).toHaveCount(0);
  await page.mouse.up();
  await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  expect(await names(page)).toEqual(FOUR);
});

test('in an overflowed row the strip scrolls while a tab is held near its end', async ({
  page,
  pdfs,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const many = Array.from(
    { length: 9 },
    (_, i) => `Sheet ${String(i + 1)} - long drawing title.pdf`,
  );
  await openTabs(page, pdfs, many);
  const list = page.locator('.tab-list');
  await list.evaluate((el) => {
    el.scrollLeft = 0;
  });
  expect(await list.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  const add = await page.locator('.tab-add').boundingBox();
  // Hold the first tab just inside the row's right end, by the +.
  await lift(page, 0, (add?.x ?? 0) - 12);
  await expect
    .poll(() => list.evaluate((el) => el.scrollLeft), { timeout: 5000 })
    .toBeGreaterThan(300);
  // Wait for the end of the row, then drop: the tab goes last.
  await expect
    .poll(
      () => list.evaluate((el) => Math.ceil(el.scrollLeft + el.clientWidth) >= el.scrollWidth),
      {
        timeout: 10_000,
      },
    )
    .toBe(true);
  await page.mouse.up();
  await expect.poll(async () => (await names(page)).at(-1)).toBe(many[0]);
  await expect(tabs(page).last()).toHaveAttribute('aria-selected', 'true');
  await expect(tabs(page).last()).toBeInViewport();
  // And back towards the start: hold it by the row's left end.
  const rowLeft = (await list.boundingBox())?.x ?? 0;
  await lift(page, 8, rowLeft + 6);
  await expect.poll(() => list.evaluate((el) => el.scrollLeft), { timeout: 10_000 }).toBe(0);
  await page.mouse.up();
  await expect.poll(async () => (await names(page))[0]).toBe(many[0]);
});

test('Ctrl+Shift+Left/Right move the focused tab, keep focus and announce it', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await openTabs(page, pdfs, FOUR);
  await tabs(page).nth(1).click();
  await tabs(page).nth(1).focus();
  await page.keyboard.press('Control+Shift+ArrowRight');
  expect(await names(page)).toEqual(['alpha.pdf', 'charlie.pdf', 'bravo.pdf', 'delta.pdf']);
  await expect(tabs(page).nth(2)).toBeFocused();
  await expect(announced(page)).toHaveText('Moved to position 3 of 4');
  await page.keyboard.press('Control+Shift+ArrowRight');
  await page.keyboard.press('Control+Shift+ArrowRight'); // already last: nothing
  expect(await names(page)).toEqual(['alpha.pdf', 'charlie.pdf', 'delta.pdf', 'bravo.pdf']);
  await expect(tabs(page).nth(3)).toBeFocused();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+Shift+ArrowLeft');
  expect(await names(page)).toEqual(['bravo.pdf', 'alpha.pdf', 'charlie.pdf', 'delta.pdf']);
  await expect(tabs(page).nth(0)).toBeFocused();
  await expect(announced(page)).toHaveText('Moved to position 1 of 4');
  // The installed app's Ctrl+Shift+PageDown does the same (Chrome keeps it in a tab).
  await page.keyboard.press('Control+Shift+PageDown');
  expect(await names(page)).toEqual(['alpha.pdf', 'bravo.pdf', 'charlie.pdf', 'delta.pdf']);
  // Plain arrows still walk the tabs.
  await page.keyboard.press('ArrowRight');
  await expect(tabs(page).nth(2)).toBeFocused();
  // Not from the document: the keys belong to the tab strip only.
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+Shift+ArrowLeft');
  expect(await names(page)).toEqual(['alpha.pdf', 'bravo.pdf', 'charlie.pdf', 'delta.pdf']);
});

test('a middle-click closes a tab, as in Chrome', async ({ page, pdfs }) => {
  await page.goto('/');
  await openTabs(page, pdfs, FOUR);
  await tabs(page).nth(1).click({ button: 'middle' });
  expect(await names(page)).toEqual(['alpha.pdf', 'charlie.pdf', 'delta.pdf']);
  // On the ×'s part of a tab too.
  await page
    .locator('.tab-close')
    .nth(0)
    .click({ button: 'middle', position: { x: 2, y: 4 } });
  expect(await names(page)).toEqual(['charlie.pdf', 'delta.pdf']);
});

test('on touch, holding a tab lifts it for a drag; a swipe scrolls the row instead', async ({
  page,
  pdfs,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const many = Array.from(
    { length: 9 },
    (_, i) => `Sheet ${String(i + 1)} - long drawing title.pdf`,
  );
  await openTabs(page, pdfs, many);
  const list = page.locator('.tab-list');
  await list.evaluate((el) => {
    el.scrollLeft = 0;
  });
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    });
  const b0 = await box(page, 0);
  const b1 = await box(page, 1);
  const y = b0.y + b0.height / 2;

  // A swipe left at once: the row scrolls, nothing moves.
  await touch('touchStart', b1.x + b1.width / 2, y);
  for (let i = 1; i <= 10; i++) await touch('touchMove', b1.x + b1.width / 2 - i * 20, y);
  await touch('touchEnd', 0, 0);
  expect(await list.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
  expect(await names(page)).toEqual(many);

  // Hold, then drag the first tab one place right.
  await list.evaluate((el) => {
    el.scrollLeft = 0;
  });
  await touch('touchStart', b0.x + 20, y);
  await page.waitForTimeout(450);
  await expect(tabs(page).nth(0)).toHaveClass(/tab--dragging/);
  for (let i = 1; i <= 10; i++) await touch('touchMove', b0.x + 20 + (i * (b1.width + 10)) / 10, y);
  await touch('touchEnd', 0, 0);
  await expect.poll(async () => (await names(page)).slice(0, 2)).toEqual([many[1], many[0]]);
});

test('a thin divider separates tabs, except beside the selected or hovered tab', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await openTabs(page, pdfs, FOUR);
  await tabs(page).nth(1).click();
  await page.mouse.move(600, 500);
  const divider = (i: number) =>
    tabs(page)
      .nth(i)
      .evaluate((el) => {
        const s = getComputedStyle(el, '::before');
        return s.content !== 'none' && Number(s.opacity) > 0 && s.width !== '0px';
      });
  // Not before the first tab, nor on either side of the selected one (bravo).
  expect([await divider(0), await divider(1), await divider(2), await divider(3)]).toEqual([
    false,
    false,
    false,
    true,
  ]);
  // Hovering charlie hides the one before delta.
  await tabs(page).nth(2).hover();
  await expect.poll(() => divider(3)).toBe(false);
});
