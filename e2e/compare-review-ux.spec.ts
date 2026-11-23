import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { cap, darkTheme } from './support/app.ts';
import { hideDifferences, overlayOf, textOf } from './support/compare.ts';
import { expect, test } from './support/fixtures.ts';
import { skipReviewerPrompt } from './support/shots.ts';

// M12-27 (ADR-033 decisions 4–6), the owner's hand check of M12: the close-out
// list shows comments with text first and can hide highlights; a click on a
// comment zooms the linked windows to it and flashes it; Close Out As… is one
// menu with a line per outcome; Document A and B and the comparison's tab show
// the unsaved dot; closing a comparison with unsaved overlay comments asks; a
// text comparison shows "Page n of m" on each side and goes to a typed page.

type Role = 'overlay' | 'a' | 'b';

const win = (page: Page, role: Role) => page.getByTestId(`review-window-${role}`);
const viewport = (page: Page, role: Role) => win(page, role).locator('.viewport');
const pane = (page: Page) => page.getByTestId('closeout-pane');
const row = (page: Page, id: string) => pane(page).locator(`.closeout-row[data-id="${id}"]`);
const rowIds = (page: Page) =>
  pane(page)
    .locator('.closeout-row')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));

async function docId(page: Page, role: Role): Promise<string> {
  const id = await viewport(page, role).getAttribute('data-doc-id');
  if (!id) throw new Error(`no document in window ${role}`);
  return id;
}

async function showList(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Close-out', exact: true }).click();
  await expect(pane(page)).toBeVisible();
}

/** The overlay window's zoom as last drawn (its painter writes it on the viewport). */
async function zoomOf(page: Page): Promise<number> {
  return Number(await viewport(page, 'overlay').getAttribute('data-zoom'));
}

/** How far an element's centre is from its window's centre (CSS px). */
async function offCentre(page: Page, role: Role, selector: string): Promise<number> {
  const v = await viewport(page, role).boundingBox();
  const b = await win(page, role).locator(selector).boundingBox();
  if (!v || !b) return Infinity;
  return Math.hypot(
    b.x + b.width / 2 - (v.x + v.width / 2),
    b.y + b.height / 2 - (v.y + v.height / 2),
  );
}

test('close-out: text first, Hide highlights remembered, a click zooms to the comment and flashes it (pair 19) @smoke', async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await overlayOf(page, '19');
  await skipReviewerPrompt(page);
  // Room for Document A's window beside the close-out list.
  await hideDifferences(page);
  await showList(page);

  // Hide highlights is on at first: the reviewer's see-through check marks are left out.
  const hide = pane(page).getByRole('checkbox', { name: 'Hide highlights' });
  await expect(hide).toBeChecked();
  expect(await rowIds(page)).toEqual(['C3-note', 'C2-cloud', 'C1-text', 'C1-cloud', 'C4-note']);
  await expect(pane(page).getByRole('group', { name: /Comments with text/u })).toBeVisible();
  // Off: they are listed too, and the choice is kept on this device.
  await hide.uncheck();
  await expect.poll(async () => (await rowIds(page)).length).toBeGreaterThan(5);
  expect(await page.evaluate(() => localStorage.getItem('pdftools.closeOutHideHighlights'))).toBe(
    'false',
  );
  await hide.check();
  await expect.poll(async () => (await rowIds(page)).length).toBe(5);

  // A click zooms the linked windows to the comment (the overlay leads, A follows),
  // selects it in Document A and flashes it once.
  const before = await zoomOf(page);
  await row(page, 'C3-note').click();
  await expect(win(page, 'a').getByTestId('comment-flash')).toBeVisible();
  await expect(win(page, 'overlay').getByTestId('comment-flash')).toBeVisible();
  await expect.poll(() => zoomOf(page)).toBeGreaterThan(before * 1.5);
  // Never past 400 %.
  expect(await zoomOf(page)).toBeLessThanOrEqual(4.01);
  const body = '.annotation-body[data-annotation-id="C3-note"]';
  await expect(win(page, 'a').locator(body)).toBeVisible();
  await expect.poll(() => offCentre(page, 'a', body)).toBeLessThan(60);
  const a = await docId(page, 'a');
  await expect
    .poll(async () => (await cap(page, 'annotate', 'selected', a)) as string[])
    .toEqual(['C3-note']);
  // The flash goes after a moment.
  await expect(win(page, 'a').getByTestId('comment-flash')).toHaveCount(0, { timeout: 3000 });

  // Another comment, far from the first: the windows move to it.
  await row(page, 'C4-note').click();
  const body4 = '.annotation-body[data-annotation-id="C4-note"]';
  await expect(win(page, 'a').locator(body4)).toBeVisible();
  await expect.poll(() => offCentre(page, 'a', body4)).toBeLessThan(60);
});

test('Close Out As… explains each outcome; the menu and the list pass axe in light and dark @a11y', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await overlayOf(page, '19');
  await skipReviewerPrompt(page);
  await showList(page);
  const menuButton = page
    .getByTestId('closeout-actions')
    .getByRole('button', { name: 'Close Out As…', exact: true });
  // Nothing selected: nothing to close out.
  await expect(menuButton).toBeDisabled();
  await row(page, 'C2-cloud').click();
  await expect(menuButton).toBeEnabled();
  await menuButton.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveCount(3);
  const carried = menu.getByRole('menuitem', { name: 'Carried Over', exact: true });
  await expect(carried).toHaveAccessibleDescription(/copied to the new revision/u);
  await expect(menu.getByRole('menuitem', { name: 'Addressed', exact: true })).toContainText(
    'makes the change',
  );
  // The open menu on its own (Radix hides the rest from assistive tech while it is open),
  // then the list with the menu closed.
  const axe = async (include: string): Promise<void> => {
    const r = await new AxeBuilder({ page }).include(include).analyze();
    expect(r.violations).toEqual([]);
  };
  await axe('[role="menu"]');
  await page.keyboard.press('Escape');
  await axe('[data-testid="closeout-pane"]');
  await darkTheme(page);
  await axe('[data-testid="closeout-pane"]');
  await menuButton.click();
  await expect(menu).toBeVisible();
  await axe('[role="menu"]');
  await menu.getByRole('menuitem', { name: 'Changed Differently', exact: true }).click();
  await expect(row(page, 'C2-cloud')).toHaveAttribute('data-state', 'changed');
});

test('the unsaved dot on the window titles and the tab; closing asks before losing overlay comments (pair 19)', async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await overlayOf(page, '19');
  await skipReviewerPrompt(page);
  const tab = page.locator('[data-tab-kind="comparison"]');
  await expect(page.getByTestId('review-unsaved-b')).toHaveCount(0);
  await expect(tab.locator('.tab-dirty')).toHaveCount(0);

  // A comment on Document B: B's title and the tab get the dot, A's does not.
  const b = await docId(page, 'b');
  await cap(page, 'annotate', 'createSquare', b, 0, 300, 200);
  await expect(page.getByTestId('review-unsaved-b')).toBeVisible();
  await expect(page.getByTestId('review-unsaved-a')).toHaveCount(0);
  await expect(win(page, 'b').locator('.review-window-title')).toContainText('unsaved changes');
  await expect(tab.locator('.tab-dirty')).toBeVisible();
  await expect(tab).toHaveAccessibleName(/unsaved changes/u);

  // A comment drawn on the overlay: only a comparison file keeps it, so closing asks.
  const notes = await docId(page, 'overlay');
  await cap(page, 'annotate', 'createSquare', notes, 0, 200, 200);
  const closeTab = async (): Promise<void> => {
    await tab.click({ button: 'middle' });
  };
  await closeTab();
  const dialog = page.getByRole('dialog', { name: /Save changes to/u });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('drew on the overlay');
  await expect(dialog.getByRole('button', { name: 'Save Comparison…' })).toBeVisible();
  // Cancel: the comparison stays.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(tab).toHaveCount(1);
  // Don't save: it closes; Document B's own comment is then asked about as usual.
  await closeTab();
  await dialog.getByRole('button', { name: "Don't save" }).click();
  await expect(tab).toHaveCount(0);
  const docPrompt = page.getByRole('dialog', { name: /Pair 19 RevB\.pdf/u });
  await expect(docPrompt).toBeVisible();
  await docPrompt.getByRole('button', { name: "Don't save" }).click();
  await expect(docPrompt).toHaveCount(0);
});

test('text comparison: Page n of m on each side, Go to page, the other side follows (text pair 10)', async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await textOf(page, '10');
  const counterA = page.getByTestId('text-page-a');
  const counterB = page.getByTestId('text-page-b');
  await expect(counterA).toHaveText('Page 1 of 17');
  await expect(counterB).toHaveText('Page 1 of 18');
  await expect(counterA).toHaveAccessibleName('Page 1 of 17. Go to a page');

  // Type a page and press Enter: A goes there, B follows to the matching text.
  await counterA.click();
  const input = page.getByTestId('text-page-input-a');
  await expect(input).toBeFocused();
  await expect(input).toHaveAccessibleName('Go to page, 1 to 17');
  await input.fill('12');
  await input.press('Enter');
  await expect(counterA).toHaveText('Page 12 of 17');
  await expect(counterA).toBeFocused();
  await expect
    .poll(async () => Number(await counterB.getAttribute('data-page')))
    .toBeGreaterThanOrEqual(11);
  expect(Number(await counterB.getAttribute('data-page'))).toBeLessThanOrEqual(14);

  // Scrolling updates the number.
  const vb = await page.getByTestId('text-view-b').boundingBox();
  if (!vb) throw new Error('no window');
  await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -1200);
  await expect.poll(async () => Number(await counterB.getAttribute('data-page'))).toBeLessThan(11);

  // A page that is not there: the box stays, marked; Escape leaves it as it was.
  await counterB.click();
  const inputB = page.getByTestId('text-page-input-b');
  await inputB.fill('40');
  await inputB.press('Enter');
  await expect(inputB).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert')).toContainText('from 1 to 18');
  await inputB.press('Escape');
  await expect(counterB).toBeVisible();

  const axe = async (): Promise<void> => {
    const r = await new AxeBuilder({ page }).include('.text-windows').analyze();
    expect(r.violations).toEqual([]);
  };
  await axe();
  await darkTheme(page);
  await axe();
});
