import type { Page } from '@playwright/test';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M11-05 (ADR-028 D-50): the file tab's right-click menu (also Shift+F10, the Menu key
// and a touch hold) acts on that tab; the empty strip has its own menu. Close Others /
// to the Right / All ask about unsaved documents one by one; Reopen Closed Tab reopens
// from the file's handle; Rename File renames the file in place (FSA move()).

// CSS, not roles: while a (modal) menu is open, the rest of the page is hidden from the
// accessibility tree.
const tabs = (page: Page) => page.locator('.tab-tablist [role="tab"]');
const names = (page: Page) =>
  tabs(page).evaluateAll((els) => els.map((el) => el.querySelector('.tab-name')?.textContent));
const tabMenu = (page: Page, name: string) => page.getByRole('menu', { name: `${name} tab` });
const stripMenu = (page: Page) => page.getByRole('menu', { name: 'File tabs' });
/** The items' labels (without their key hints). */
const labels = (menu: ReturnType<Page['getByRole']>) =>
  menu.locator('.ui-menu-label').allTextContents();
const announced = (page: Page) => page.locator('.tab-strip .tab-moved[aria-live="polite"]');

async function openTabs(page: Page, pdfs: { simple(n: number): Buffer }, list: string[]) {
  for (const [i, name] of list.entries()) {
    await drop(page, [{ name, b64: pdfs.simple(i + 1).toString('base64') }]);
    await expect(tabs(page)).toHaveCount(i + 1);
  }
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
}

const tab = (page: Page, name: string) =>
  tabs(page).filter({ has: page.locator('.tab-name', { hasText: name }) });

async function rightClick(page: Page, name: string): Promise<void> {
  await tab(page, name).click({ button: 'right' });
  await expect(tabMenu(page, name)).toBeVisible();
}

test('the tab menu acts on the tab it was opened on @smoke', async ({ page, pdfs }) => {
  // The system clipboard is shared with tests running beside this one (their Ctrl+V):
  // the text written is kept in the page instead.
  await page.addInitScript(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      value: (text: string) => {
        (window as unknown as { __copied: string }).__copied = text;
        return Promise.resolve();
      },
    });
  });
  await page.goto('/');
  await openTabs(page, pdfs, ['Sheet 10.pdf', 'Sheet 2.pdf', 'b.pdf', 'Sheet 1.pdf']);
  await tab(page, 'Sheet 10.pdf').click();

  // The plan's items, in order; Rename File is not offered for a dropped file (no handle).
  await rightClick(page, 'Sheet 2.pdf');
  const menu = tabMenu(page, 'Sheet 2.pdf');
  expect(await labels(menu)).toEqual([
    'Save',
    'Save As',
    'Close',
    'Close Other Tabs',
    'Close Tabs to the Right',
    'Close All Tabs',
    'Reopen Closed Tab',
    'Move Left',
    'Move Right',
    'Sort Tabs by Name',
    'Copy File Name',
    'Document Properties',
  ]);
  // Opening the menu does not select the tab (as in Chrome).
  await expect(tab(page, 'Sheet 10.pdf')).toHaveAttribute('aria-selected', 'true');
  await expect(menu.getByRole('menuitem', { name: /^Reopen Closed Tab/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  );

  // Move Right moves that tab, not the selected one.
  await menu.getByRole('menuitem', { name: /^Move Right/ }).click();
  await expect
    .poll(() => names(page))
    .toEqual(['Sheet 10.pdf', 'b.pdf', 'Sheet 2.pdf', 'Sheet 1.pdf']);
  await expect(announced(page)).toHaveText('Moved to position 3 of 4');
  await expect(tab(page, 'Sheet 10.pdf')).toHaveAttribute('aria-selected', 'true');

  // Move Left is disabled on the first tab, and says why.
  await rightClick(page, 'Sheet 10.pdf');
  const left = tabMenu(page, 'Sheet 10.pdf').getByRole('menuitem', { name: /^Move Left/ });
  await expect(left).toHaveAttribute('aria-disabled', 'true');
  await expect(left).toHaveAccessibleDescription('This is the first tab');
  await page.keyboard.press('Escape');

  // Copy File Name: the whole name to the clipboard.
  await rightClick(page, 'b.pdf');
  await tabMenu(page, 'b.pdf').getByRole('menuitem', { name: 'Copy File Name' }).click();
  await expect(announced(page)).toHaveText('File name copied');
  expect(await page.evaluate(() => (window as unknown as { __copied: string }).__copied)).toBe(
    'b.pdf',
  );

  // Sort Tabs by Name: natural order ("Sheet 2" before "Sheet 10").
  await rightClick(page, 'b.pdf');
  await tabMenu(page, 'b.pdf').getByRole('menuitem', { name: 'Sort Tabs by Name' }).click();
  await expect
    .poll(() => names(page))
    .toEqual(['b.pdf', 'Sheet 1.pdf', 'Sheet 2.pdf', 'Sheet 10.pdf']);
  await expect(announced(page)).toHaveText('Tabs sorted by name');

  // Close Tabs to the Right of Sheet 1, then Close Other Tabs of Sheet 1.
  await rightClick(page, 'Sheet 1.pdf');
  await tabMenu(page, 'Sheet 1.pdf')
    .getByRole('menuitem', { name: 'Close Tabs to the Right' })
    .click();
  await expect.poll(() => names(page)).toEqual(['b.pdf', 'Sheet 1.pdf']);
  await rightClick(page, 'Sheet 1.pdf');
  await tabMenu(page, 'Sheet 1.pdf').getByRole('menuitem', { name: 'Close Other Tabs' }).click();
  await expect.poll(() => names(page)).toEqual(['Sheet 1.pdf']);
  await expect(tab(page, 'Sheet 1.pdf')).toHaveAttribute('aria-selected', 'true');
});

test('Shift+F10 on a focused tab opens its menu; Esc returns to the tab', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await openTabs(page, pdfs, ['alpha.pdf', 'bravo.pdf']);
  await tab(page, 'bravo.pdf').focus();
  await page.keyboard.press('Shift+F10');
  const menu = tabMenu(page, 'bravo.pdf');
  await expect(menu).toBeVisible();
  // The first item has the focus; the keys walk the menu.
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(tab(page, 'bravo.pdf')).toBeFocused();
  // Move Left from the keyboard: Shift+F10, then pick it by its letters.
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: /^Move Left/ }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => names(page)).toEqual(['bravo.pdf', 'alpha.pdf']);
  await expect(tab(page, 'bravo.pdf')).toBeFocused();
});

test('Close All Tabs asks about each unsaved document; Cancel stops there', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await openTabs(page, pdfs, ['one.pdf', 'two.pdf', 'three.pdf', 'four.pdf']);
  for (const n of ['two.pdf', 'four.pdf']) {
    await tab(page, n).click();
    await cap(page, 'open', 'markActiveDirty');
  }
  await rightClick(page, 'one.pdf');
  await tabMenu(page, 'one.pdf').getByRole('menuitem', { name: 'Close All Tabs' }).click();
  // The saved ones close at once; two.pdf is asked about first.
  const ask = (n: string) => page.getByRole('dialog', { name: `Save changes to ${n}?` });
  await expect(ask('two.pdf')).toBeVisible();
  await expect.poll(() => names(page)).toEqual(['two.pdf', 'four.pdf']);
  await ask('two.pdf').getByRole('button', { name: "Don't save" }).click();
  // Then four.pdf; Cancel keeps it open.
  await expect(ask('four.pdf')).toBeVisible();
  await ask('four.pdf').getByRole('button', { name: 'Cancel' }).click();
  await expect(ask('four.pdf')).toBeHidden();
  expect(await names(page)).toEqual(['four.pdf']);
});

test('the empty strip has its own menu', async ({ page, pdfs }) => {
  await page.goto('/');
  await openTabs(page, pdfs, ['alpha.pdf']);
  const strip = page.locator('.tab-strip');
  const box = await strip.boundingBox();
  if (!box) throw new Error('no strip');
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2, { button: 'right' });
  const menu = stripMenu(page);
  await expect(menu).toBeVisible();
  expect(await labels(menu)).toEqual([
    'Open',
    'Create Blank PDF…',
    'Reopen Closed Tab',
    'Close All Tabs',
  ]);
  await menu.getByRole('menuitem', { name: 'Close All Tabs' }).click();
  await expect(tabs(page)).toHaveCount(0);
  await expect(page.getByTestId('start-screen')).toBeVisible();
});

test('on touch, a tab held until it lifts and let go opens its menu', async ({ page, pdfs }) => {
  await page.goto('/');
  await openTabs(page, pdfs, ['alpha.pdf', 'bravo.pdf']);
  const b = await tab(page, 'alpha.pdf').boundingBox();
  if (!b) throw new Error('no box');
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchEnd', x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    });
  await touch('touchStart', b.x + 20, b.y + b.height / 2);
  await page.waitForTimeout(450);
  await expect(tab(page, 'alpha.pdf')).toHaveClass(/tab--dragging/);
  await touch('touchEnd', 0, 0);
  await expect(tabMenu(page, 'alpha.pdf')).toBeVisible();
  expect(await names(page)).toEqual(['alpha.pdf', 'bravo.pdf']);
  await page.keyboard.press('Escape');
});

test('Reopen Closed Tab reopens a file from its handle at its place; Rename File renames it in place', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await cap(page, 'open', 'openHandles', [
    { name: 'a.pdf', b64: pdfs.simple(1).toString('base64') },
    { name: 'b.pdf', b64: pdfs.simple(2).toString('base64') },
    { name: 'c.pdf', b64: pdfs.simple(3).toString('base64') },
  ]);
  await expect(tabs(page)).toHaveCount(3);

  // Close b (the ×), then reopen it from the strip's menu: back in the middle.
  await page.getByRole('button', { name: 'Close b.pdf' }).click();
  await expect.poll(() => names(page)).toEqual(['a.pdf', 'c.pdf']);
  await rightClick(page, 'a.pdf');
  await tabMenu(page, 'a.pdf')
    .getByRole('menuitem', { name: /^Reopen Closed Tab/ })
    .click();
  await expect.poll(() => names(page)).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
  await expect(tab(page, 'b.pdf')).toHaveAttribute('aria-selected', 'true');
  // And from the keys (the alternate of Ctrl+Shift+T, which Chrome keeps in a normal tab).
  await page.getByRole('button', { name: 'Close a.pdf' }).click();
  await expect.poll(() => names(page)).toEqual(['b.pdf', 'c.pdf']);
  await page.keyboard.press('Control+Alt+Shift+T');
  await expect.poll(() => names(page)).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);

  // Rename File… is offered for a file opened from its handle.
  await rightClick(page, 'c.pdf');
  await tabMenu(page, 'c.pdf').getByRole('menuitem', { name: 'Rename File…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename File' });
  const field = dialog.getByRole('textbox', { name: 'New file name' });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('c.pdf');
  // The name of another open file is refused: move() could write over it.
  await field.fill('a.pdf');
  await dialog.getByRole('button', { name: 'Rename' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Another file you opened here already has this name. Pick another name.',
  );
  await field.fill('Site report');
  await dialog.getByRole('button', { name: 'Rename' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => names(page)).toEqual(['a.pdf', 'b.pdf', 'Site report.pdf']);
  expect(await cap(page, 'open', 'fileNames')).toEqual(['Site report.pdf', 'a.pdf', 'b.pdf']);
});
