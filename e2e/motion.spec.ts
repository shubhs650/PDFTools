import type { Locator, Page } from '@playwright/test';
import { outlinedPdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { skipReviewerPrompt } from './support/shots.ts';

// M10-07 (ADR-027 D-47): subtle motion. The functional project runs with reduced
// motion (playwright.config.ts); these tests turn it back on to check that menus,
// tooltips, dialogs, the backstage, panes, the ribbon and thumbnails animate in,
// that nothing waits for an animation, that the document view never animates, and
// that prefers-reduced-motion turns it all off.

test.use({ contextOptions: { reducedMotion: 'no-preference' } });

const run = (page: Page, id: string) => cap(page, 'commands', 'run', id);

async function open(page: Page) {
  await page.goto('/');
  await skipReviewerPrompt(page);
  await drop(page, [{ name: 'drawing.pdf', b64: Buffer.from(outlinedPdf()).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
}

/** The element's CSS animation: its name and duration, as computed when it appeared. */
const motion = (l: Locator) =>
  l.evaluate((el) => {
    const s = getComputedStyle(el);
    return { name: s.animationName, duration: s.animationDuration };
  });

async function bookmarkMenu(page: Page) {
  await run(page, 'rail.bookmarks');
  await page.locator('.bookmark').first().click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Bookmark menu' });
  await expect(menu).toBeVisible();
  return menu;
}

test('menus, tooltips, dialogs, the backstage, panes and the ribbon animate in; nothing waits @smoke', async ({
  page,
}) => {
  await open(page);
  // (This file turns motion back on; the rest of the functional suite runs reduced.)
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
    false,
  );

  // Thumbnails fade in as their images arrive; the document view never animates.
  await expect(page.locator('.thumb-img').first()).toBeVisible();
  expect(await motion(page.locator('.thumb-img').first())).toEqual({
    name: 'motion-fade-in',
    duration: '0.18s',
  });
  for (const sel of ['[data-testid="document-view"]', '.page-preview']) {
    const still = await page
      .locator(sel)
      .first()
      .evaluate((el) => [getComputedStyle(el).animationName, el.getAnimations().length]);
    expect(still, sel).toEqual(['none', 0]);
  }

  // A menu grows out of its anchor, and the keyboard works in it at once.
  const menu = await bookmarkMenu(page);
  expect(await motion(menu)).toEqual({ name: 'motion-pop-in', duration: '0.18s' });
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  // It settles fully opaque and then holds no animation.
  await expect.poll(() => menu.evaluate((el) => el.getAnimations().length)).toBe(0);
  expect(await menu.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  // Closing is immediate: the closed state has no animation for Radix to wait for.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // A pane's content fades in when another pane shows.
  await run(page, 'rail.thumbnails');
  expect(await motion(page.locator('.left-pane-body > *').first())).toEqual({
    name: 'motion-fade-in',
    duration: '0.18s',
  });

  // A tooltip pops in after its delay.
  await page
    .getByRole('toolbar', { name: /Home/ })
    .getByRole('button', { name: 'Hand', exact: true })
    .hover();
  const tip = page.locator('.ui-tooltip');
  await expect(tip).toBeVisible();
  expect(await motion(tip)).toEqual({ name: 'motion-pop-in', duration: '0.18s' });
  await page.mouse.move(700, 700);

  // The ribbon's groups fade in on a tab change.
  await page.getByRole('tab', { name: 'Comment', exact: true }).click();
  const group = page.locator('.ribbon-toolbar > .ribbon-group').first();
  expect(await motion(group)).toEqual({ name: 'motion-fade-in', duration: '0.18s' });

  // A dialog fades and rises, with focus inside it straight away.
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+P');
  const print = page.getByRole('dialog', { name: 'Print' });
  await expect(print).toBeVisible();
  expect(await print.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  expect(await motion(print)).toEqual({ name: 'motion-dialog-in', duration: '0.24s' });
  expect(await motion(page.locator('.ui-dialog-backdrop'))).toEqual({
    name: 'motion-fade-in',
    duration: '0.24s',
  });
  // Once settled it is centred exactly as before (the animation only borrows the transform).
  await expect.poll(() => print.evaluate((el) => el.getAnimations().length)).toBe(0);
  const box = await print.boundingBox();
  const vp = page.viewportSize();
  expect(Math.abs((box?.x ?? 0) + (box?.width ?? 0) / 2 - (vp?.width ?? 0) / 2)).toBeLessThan(1);
  await page.keyboard.press('Escape');
  await expect(print).toHaveCount(0);

  // The backstage slides in.
  await page.getByTestId('file-tab').click();
  const backstage = page.getByTestId('backstage');
  await expect(backstage).toBeVisible();
  expect(await motion(backstage)).toEqual({ name: 'motion-slide-in', duration: '0.24s' });
  await page.keyboard.press('Escape');
  await expect(backstage).toHaveCount(0);

  // The Properties pane fades its content in.
  await run(page, 'view.propertiesPane');
  const props = page.locator('.properties-pane > :not(.pane-header)').first();
  await expect(props).toBeVisible();
  expect(await motion(props)).toEqual({ name: 'motion-fade-in', duration: '0.18s' });
});

test('prefers-reduced-motion: every surface opens without animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await expect(page.locator('.thumb-img').first()).toBeVisible();
  expect((await motion(page.locator('.thumb-img').first())).duration).toBe('0s');
  const menu = await bookmarkMenu(page);
  expect((await motion(menu)).duration).toBe('0s');
  await page.keyboard.press('Escape');

  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+P');
  const print = page.getByRole('dialog', { name: 'Print' });
  await expect(print).toBeVisible();
  expect((await motion(print)).duration).toBe('0s');
  await page.keyboard.press('Escape');

  await page.getByTestId('file-tab').click();
  expect((await motion(page.getByTestId('backstage'))).duration).toBe('0s');
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: 'Comment', exact: true }).click();
  expect((await motion(page.locator('.ribbon-toolbar > .ribbon-group').first())).duration).toBe(
    '0s',
  );
  // Hover colours change at once too.
  const row = page.locator('.bookmark').first();
  expect(await row.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
});
