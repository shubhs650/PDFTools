import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { reviewSourcePdf } from './fixtures/comments.ts';
import { OWNER_PW, USER_PW, hasQpdf, qpdfEncrypt } from './fixtures/encrypted.ts';
import { fullFormPdf, simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M6-02 (ADR-021 D-38 a, b; ADR-018 d5, d8; rules 9, 12): right-click menus on
// a comment and on the page background, cut / copy / paste of comments from
// the page with the mouse and the keyboard. Reproduced on the beta first: the
// copy itself worked, but Ctrl+V after clicking another page pasted onto the
// page the view had scrolled to (often out of sight), and right-click offered
// only the browser's menu, whose Copy and Paste do nothing for comments.

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

interface Obj {
  id: string;
  pageIndex: number;
  inReplyToId?: string;
  contents?: string;
  rect: { origin: { x: number; y: number }; size: { width: number; height: number } };
}

const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];

async function open(page: Page, bytes: Uint8Array, name: string): Promise<string> {
  await drop(page, [{ name, b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  return (await cap(page, 'view', 'activeDocId')) as string;
}

/** The on-screen position of a point given in page points (top-left origin, unrotated). */
async function screenPoint(page: Page, pageIndex: number, x: number, y: number) {
  const box = await page.locator(`[data-page="${String(pageIndex)}"] .page-content`).boundingBox();
  if (!box) throw new Error(`page ${String(pageIndex)} not laid out`);
  const k = box.width / 595;
  return { x: box.x + x * k, y: box.y + y * k };
}

async function clickAt(page: Page, pageIndex: number, x: number, y: number, right = false) {
  const p = await screenPoint(page, pageIndex, x, y);
  await page.mouse.click(p.x, p.y, right ? { button: 'right' } : {});
}

async function fitPage(page: Page): Promise<void> {
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('ControlOrMeta+0');
  await expect(page.getByRole('textbox', { name: 'Zoom', exact: true })).not.toHaveValue('100%');
}

/** Scrolls so page 1's bottom and page 2's top are both in view (at Fit Page). */
async function showPagesOneAndTwo(page: Page): Promise<void> {
  await page.getByTestId('document-view').evaluate((el) => {
    el.scrollTop += el.clientHeight * 0.4;
  });
  await expect(page.locator('[data-page="1"] .page-content')).toBeInViewport();
}

const pageNumber = (page: Page) => page.getByRole('textbox', { name: 'Page number' });
const menu = (page: Page) => page.getByRole('menu');
const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

// The square on page 1: /Rect [100 600 250 680] → x 100–250, y 162–242 from the top.
const SQUARE_EDGE = { x: 175, y: 163 };

test('repro: Ctrl+C on a clicked comment, click on another page, Ctrl+V pastes onto that page', async ({
  page,
}) => {
  await page.goto('/');
  const id = await open(page, reviewSourcePdf(), 'rev.pdf');
  await expect.poll(async () => (await objects(page, id)).length).toBe(5);
  await fitPage(page);
  await clickAt(page, 0, SQUARE_EDGE.x, SQUARE_EDGE.y);
  await expect.poll(() => cap(page, 'annotate', 'selected', id)).toEqual(['src-square']);
  await page.keyboard.press('ControlOrMeta+c');
  await expect(status(page, '1 comment copied.')).toBeVisible();

  await showPagesOneAndTwo(page);
  // The view's current page is still page 1 (most of it is in view).
  await expect(pageNumber(page)).toHaveValue('1');

  // Click on page 2, away from anything, and paste.
  await clickAt(page, 1, 450, 60);
  await page.keyboard.press('ControlOrMeta+v');
  await expect(status(page, '1 comment pasted.')).toBeVisible();
  const all = await objects(page, id);
  const copy = all.find((o) => o.contents === 'Check weld size' && o.id !== 'src-square');
  // Onto the clicked page, at the same place (it came from another page: no offset).
  expect(copy?.pageIndex).toBe(1);
  expect(copy?.rect.origin.x).toBeCloseTo(100, 0);
  expect(copy?.rect.origin.y).toBeCloseTo(162, 0);
});

test('the comment menu: right click selects the comment; Copy, then Paste from the page menu lands at the pointer; one undo step', async ({
  page,
}) => {
  await page.goto('/');
  const id = await open(page, reviewSourcePdf(), 'rev.pdf');
  await expect.poll(async () => (await objects(page, id)).length).toBe(5);
  await fitPage(page);

  await clickAt(page, 0, SQUARE_EDGE.x, SQUARE_EDGE.y, true);
  await expect.poll(() => cap(page, 'annotate', 'selected', id)).toEqual(['src-square']);
  const m = menu(page);
  await expect(m).toHaveAccessibleName('Comment');
  await expect(m.getByRole('menuitem')).toHaveText([
    /^Cut\s*Ctrl\+X$/,
    /^Copy\s*Ctrl\+C$/,
    /^Paste\s*Ctrl\+V$/,
    /^Paste to Original Pages\s*Ctrl\+Shift\+V$/, // M6-08: out of the ribbon
    /^Delete Selected Comments\s*Delete$/,
    /^Reply$/,
    /^Set Status$/,
    /^Copy Style$/,
    /^Apply Style$/,
    /^Make Current Properties Default$/,
    /^Flatten Selected Comments$/, // M6-09
    /^Properties$/,
  ]);
  // Nothing copied yet, but Paste stays available: the system clipboard may
  // hold an image (M7-08, D-45), which only the click may read.
  const paste = m.getByRole('menuitem', { name: 'Paste', exact: true });
  await expect(paste).not.toHaveAttribute('aria-disabled', 'true');
  const { violations } = await new AxeBuilder({ page }).include('[role="menu"]').analyze();
  expect(violations).toEqual([]);
  await m.getByRole('menuitem', { name: 'Copy', exact: true }).click();
  await expect(m).toBeHidden();
  await expect(status(page, '1 comment copied.')).toBeVisible();
  // Focus is back on the document.
  await expect(page.getByTestId('document-view')).toBeFocused();

  // Right click on page 2's background: the page menu; Paste puts it there.
  await showPagesOneAndTwo(page);
  await clickAt(page, 1, 300, 120, true);
  await expect(menu(page)).toHaveAccessibleName('Page');
  await menu(page).getByRole('menuitem', { name: 'Paste', exact: true }).click();
  await expect(status(page, '1 comment pasted.')).toBeVisible();
  const copy = (await objects(page, id)).find(
    (o) => o.contents === 'Check weld size' && o.id !== 'src-square',
  );
  expect(copy?.pageIndex).toBe(1);
  // Its top-left corner at the pointer (within a screen pixel at this zoom).
  expect(Math.abs((copy?.rect.origin.x ?? 0) - 300)).toBeLessThan(2.5);
  expect(Math.abs((copy?.rect.origin.y ?? 0) - 120)).toBeLessThan(2.5);
  expect(copy?.rect.size.width).toBeCloseTo(150, 0);

  // One undo step; the reply and the state came with it (5 + 3).
  expect(await objects(page, id)).toHaveLength(8);
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await expect.poll(async () => (await objects(page, id)).length).toBe(5);
});

test('Ctrl+X removes the comment with its replies (one undo step) and Ctrl+V pastes it back in place', async ({
  page,
}) => {
  await page.goto('/');
  const id = await open(page, reviewSourcePdf(), 'rev.pdf');
  await expect.poll(async () => (await objects(page, id)).length).toBe(5);
  await fitPage(page);
  await clickAt(page, 0, SQUARE_EDGE.x, SQUARE_EDGE.y);
  await expect.poll(() => cap(page, 'annotate', 'selected', id)).toEqual(['src-square']);

  await page.keyboard.press('ControlOrMeta+x');
  await expect(status(page, '1 comment cut.')).toBeVisible();
  // The square, its reply and its state: no question asked (they travel with the copy).
  await expect
    .poll(async () => (await objects(page, id)).map((o) => o.id).sort())
    .toEqual(['src-note', 'src-oval']);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await objects(page, id)).length).toBe(5);
  await page.keyboard.press('ControlOrMeta+y');
  await expect.poll(async () => (await objects(page, id)).length).toBe(2);

  // Pasted back where it was (cut: no offset), with the reply following the copy.
  await page.keyboard.press('ControlOrMeta+v');
  await expect(status(page, '1 comment pasted.')).toBeVisible();
  const all = await objects(page, id);
  expect(all).toHaveLength(5);
  const square = all.find((o) => o.contents === 'Check weld size');
  expect(square?.id).not.toBe('src-square');
  expect(square?.pageIndex).toBe(0);
  expect(square?.rect.origin.x).toBeCloseTo(100, 0);
  expect(square?.rect.origin.y).toBeCloseTo(162, 0);
  expect(all.find((o) => o.contents === 'Upgraded to 6 mm')?.inReplyToId).toBe(square?.id);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await objects(page, id)).length).toBe(2);
});

test('from the keyboard: Shift+F10 and the Menu key open the menus; Esc closes them and focus returns to the document', async ({
  page,
}) => {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana');
  const id = await open(page, reviewSourcePdf(), 'rev.pdf');
  await expect.poll(async () => (await objects(page, id)).length).toBe(5);
  const view = page.getByTestId('document-view');
  await view.focus();

  // Nothing selected: the page menu, its first item focused.
  await page.keyboard.press('Shift+F10');
  await expect(menu(page)).toHaveAccessibleName('Page');
  await expect(menu(page).getByRole('menuitem', { name: 'Paste', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();
  await expect(view).toBeFocused();

  // Tab selects the page's first comment; the Menu key opens the comment menu on it.
  await page.keyboard.press('Tab');
  await expect.poll(() => cap(page, 'annotate', 'selected', id)).toEqual(['src-square']);
  await page.keyboard.press('ContextMenu');
  await expect(menu(page)).toHaveAccessibleName('Comment');
  await expect(menu(page)).toHaveCount(1);
  // Set Status ▸ Accepted, by keyboard.
  const setStatus = menu(page).getByRole('menuitem', { name: 'Set Status' });
  // The menu focuses its first item once it is open; arrows pressed before
  // that are lost (the flake seen on main, M6-15).
  await expect(menu(page).getByRole('menuitem', { name: 'Cut', exact: true })).toBeFocused();
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
  await expect(setStatus).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menuitem', { name: 'No status' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Accepted' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect
    .poll(async () =>
      (await objects(page, id)).some(
        (o) => o.inReplyToId === 'src-square' && o.contents === 'Accepted set by Ana',
      ),
    )
    .toBe(true);

  // Copy by the menu, then Shift+F10 → Paste: the thread (square, reply, two
  // states) onto the comment's page, its corner at the menu's anchor.
  await expect(view).toBeFocused();
  await cap(page, 'annotate', 'select', id, 0, 'src-square');
  await page.keyboard.press('Shift+F10');
  await expect(menu(page)).toHaveAccessibleName('Comment');
  await page.keyboard.press('ArrowDown');
  await expect(menu(page).getByRole('menuitem', { name: 'Copy', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(status(page, '1 comment copied.')).toBeVisible();
  await expect(view).toBeFocused();
  await page.keyboard.press('Shift+F10');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(menu(page).getByRole('menuitem', { name: 'Paste', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(status(page, '1 comment pasted.')).toBeVisible();
  await expect.poll(async () => (await objects(page, id)).length).toBe(10);
  const copy = (await objects(page, id)).find(
    (o) => o.contents === 'Check weld size' && o.id !== 'src-square',
  );
  // The anchor is the middle of the square: x 175, y 202.
  expect(Math.abs((copy?.rect.origin.x ?? 0) - 175)).toBeLessThan(2.5);
  expect(Math.abs((copy?.rect.origin.y ?? 0) - 202)).toBeLessThan(2.5);
});

test('the page menu: tools, zoom and rotate run their commands; form fields keep the browser’s menu', async ({
  page,
}) => {
  await page.goto('/');
  await open(page, simplePdf(2), 'plain.pdf');
  await fitPage(page);
  const zoom = page.getByRole('textbox', { name: 'Zoom', exact: true });
  const before = await zoom.inputValue();

  await clickAt(page, 0, 300, 400, true);
  await expect(menu(page)).toHaveAccessibleName('Page');
  await expect(menu(page).getByRole('menuitemcheckbox')).toHaveText([
    /^Hand\s*H$/,
    'Select Text',
    'Select Comments',
  ]);
  await expect(menu(page).getByRole('menuitemcheckbox', { name: 'Hand' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await menu(page).getByRole('menuitemcheckbox', { name: 'Hand' }).click();
  await expect(page.getByRole('button', { name: 'Hand' }).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await clickAt(page, 0, 300, 400, true);
  await expect(menu(page).getByRole('menuitemcheckbox', { name: 'Hand' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await menu(page).getByRole('menuitem', { name: 'Zoom In' }).click();
  await expect(zoom).not.toHaveValue(before);

  await clickAt(page, 0, 300, 400, true);
  await menu(page).getByRole('menuitem', { name: 'Rotate View Clockwise' }).click();
  await expect
    .poll(async () => {
      const b = await page.locator('[data-page="0"]').boundingBox();
      return b ? b.width > b.height : false;
    })
    .toBe(true);

  await clickAt(page, 0, 300, 400, true);
  await menu(page).getByRole('menuitem', { name: 'Properties' }).click();
  await expect(page.getByTestId('properties-pane')).toBeVisible();

  // A form field is text the user edits: the browser's own menu (cut/copy/paste text).
  await open(page, fullFormPdf(), 'form.pdf');
  await page.getByRole('textbox', { name: 'first field' }).click({ button: 'right' });
  await expect(menu(page)).toHaveCount(0);
});

test('a document that forbids copying and commenting: the items are disabled and say why (rule 9)', async ({
  page,
}) => {
  test.skip(!hasQpdf(), 'qpdf not installed');
  await page.goto('/');
  const locked = qpdfEncrypt(reviewSourcePdf(), USER_PW, OWNER_PW, [
    '256',
    '--extract=n',
    '--annotate=n',
    '--modify=none',
  ]);
  await drop(page, [{ name: 'locked.pdf', b64: b64(locked) }]);
  await page
    .getByRole('dialog', { name: 'Password required' })
    .getByLabel('Password')
    .fill(USER_PW);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(async () => (await objects(page, id)).length).toBe(5);

  await cap(page, 'annotate', 'select', id, 0, 'src-square');
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Shift+F10');
  const m = menu(page);
  await expect(m).toHaveAccessibleName('Comment');
  for (const name of [
    'Cut',
    'Copy',
    'Delete Selected Comments',
    'Apply Style',
    // M6-09: flattening changes the page content (modify).
    'Flatten Selected Comments',
  ]) {
    const item = m.getByRole('menuitem', { name, exact: true });
    await expect(item).toHaveAttribute('aria-disabled', 'true');
    await expect(item).toHaveAccessibleDescription(
      "Not allowed by this document's security settings",
    );
  }
  await m.getByRole('menuitem', { name: 'Copy', exact: true }).focus();
  await page.keyboard.press('Enter');
  // Still open: a disabled item does nothing.
  await expect(m).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('ControlOrMeta+x');
  await expect(status(page, 'copied')).toHaveCount(0);
  expect(await objects(page, id)).toHaveLength(5);
});
