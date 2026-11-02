import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { OWNER_PW, USER_PW, hasQpdf, qpdfEncrypt } from './fixtures/encrypted.ts';
import { bigOutlinePdf, richOutlinePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M6-11 (§7.15, ADR-022 decision 5; beta review B3c; rules 7, 9, 12): the
// Bookmarks pane edits the outline — toolbar, context menu, the tree's keys,
// in-place rename, drag and drop, Properties — each edit one undo step,
// written by our own outline writer (every key kept: colour, style, open
// state, actions) and saved by Ctrl+S in a narrow, verified revision.

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const tree = (page: Page) => page.getByRole('tree', { name: 'Bookmarks' });
const item = (page: Page, name: string) => tree(page).getByRole('treeitem', { name, exact: true });
const tools = (page: Page) => page.getByRole('toolbar', { name: 'Bookmark tools' });
const rail = (page: Page) =>
  page.getByRole('complementary', { name: 'Navigation panes' }).getByRole('button', {
    name: 'Bookmarks',
  });
const pageBox = (page: Page) =>
  page
    .getByRole('contentinfo', { name: 'Status bar' })
    .getByRole('textbox', { name: 'Page number' });

/** The titles in the tree, indented by level ("  " per level below the top). */
async function titles(page: Page): Promise<string[]> {
  return tree(page)
    .getByRole('treeitem')
    .evaluateAll((els) =>
      els.map((el) => `${'  '.repeat(Number(el.getAttribute('aria-level')) - 1)}${el.textContent}`),
    );
}

async function open(page: Page, bytes: Uint8Array, name: string): Promise<string> {
  await drop(page, [{ name, b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  return (await cap(page, 'view', 'activeDocId')) as string;
}

async function openPane(page: Page): Promise<void> {
  if ((await rail(page).getAttribute('aria-pressed')) !== 'true') await rail(page).click();
  await expect(tree(page)).toBeVisible();
}

/** Waits for the edit to land (the tree read again) by its effect. */
const rename = async (page: Page, text: string) => {
  const field = tree(page).getByRole('textbox', { name: 'Bookmark title' });
  await expect(field).toBeFocused();
  await field.fill(text);
  await field.press('Enter');
  await expect(item(page, text)).toBeFocused();
};

const RICH = ['Named destination', 'Web link', 'Other file', 'Script', 'Red bold, closed', 'Last'];

test('Bookmarks: new from the current view, rename, delete, the menu, undo; saved and reopened @smoke', async ({
  page,
}) => {
  await page.goto('/');
  const source = richOutlinePdf();
  const id = await open(page, source, 'rich.pdf');
  await rail(page).focus();
  await page.keyboard.press('Enter');
  await expect(item(page, 'Named destination')).toBeFocused();
  // The file's closed parent stays closed; colour and style are shown.
  expect(await titles(page)).toEqual(RICH);
  await expect(item(page, 'Red bold, closed')).toHaveAttribute('aria-expanded', 'false');
  await expect(item(page, 'Red bold, closed').locator('.bookmark-title')).toHaveCSS(
    'color',
    'rgb(255, 0, 0)',
  );
  await expect(item(page, 'Last').locator('.bookmark-title')).toHaveCSS('font-style', 'italic');

  // New Bookmark (Insert) after the focused one, from the current view (page 2), renamed in place.
  await pageBox(page).fill('2');
  await pageBox(page).press('Enter');
  await item(page, 'Named destination').focus();
  await page.keyboard.press('Insert');
  await rename(page, 'Chapter A');
  expect((await titles(page)).slice(0, 3)).toEqual(['Named destination', 'Chapter A', 'Web link']);
  await pageBox(page).fill('1');
  await pageBox(page).press('Enter');
  await item(page, 'Chapter A').click();
  await expect(pageBox(page)).toHaveValue('2');

  // F2 renames; Esc in the field keeps the old title.
  await item(page, 'Web link').focus();
  await page.keyboard.press('F2');
  await tree(page).getByRole('textbox', { name: 'Bookmark title' }).fill('Never mind');
  await page.keyboard.press('Escape');
  await expect(item(page, 'Web link')).toBeFocused();
  await page.keyboard.press('F2');
  await rename(page, 'Website — Δ');

  // The context menu: Delete but Retain Children lifts the child to the top level.
  await item(page, 'Red bold, closed').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Bookmark menu' });
  await menu.getByRole('menuitem', { name: 'Delete but Retain Children' }).click();
  await expect(item(page, 'Child of closed')).toHaveAttribute('aria-level', '1');
  await expect(item(page, 'Child of closed')).toBeFocused();

  // Delete, then Ctrl+Z brings it back (one undo step).
  await item(page, 'Script').focus();
  await page.keyboard.press('Delete');
  await expect(item(page, 'Script')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(item(page, 'Script')).toHaveCount(1);
  const want = [
    'Named destination',
    'Chapter A',
    'Website — Δ',
    'Other file',
    'Script',
    'Child of closed',
    'Last',
  ];
  expect(await titles(page)).toEqual(want);

  // Keyboard menu (Shift+F10) and axe on the open menu.
  await item(page, 'Last').focus();
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /^Rename/ })).toBeVisible();
  const { violations: inMenu } = await new AxeBuilder({ page }).include('[role="menu"]').analyze();
  expect(inMenu.map((v) => v.id)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(item(page, 'Last')).toBeFocused();

  // Ctrl+S: one narrow, verified revision; reopened with the same bookmarks.
  const saved = (await cap(page, 'save', 'verifiedSave', id)) as {
    mode: string;
    fellBack: boolean;
    tail: string;
  };
  expect(saved).toMatchObject({ mode: 'narrow', fellBack: false });
  const file = Buffer.concat([Buffer.from(source), Buffer.from(saved.tail, 'base64')]);
  await open(page, new Uint8Array(file), 'saved.pdf');
  await openPane(page);
  await expect.poll(() => titles(page)).toEqual(want);
  await expect(item(page, 'Last').locator('.bookmark-title')).toHaveCSS('font-style', 'italic');
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
});

test('drag and drop, Alt+Shift+arrows, cut and paste, Properties', async ({ page }) => {
  await page.goto('/');
  await open(page, richOutlinePdf(), 'rich.pdf');
  await openPane(page);

  // Drag "Last" into "Named destination" (the middle of the row: inside).
  await item(page, 'Last').dragTo(item(page, 'Named destination'));
  await expect(item(page, 'Last')).toHaveAttribute('aria-level', '2');
  await expect(item(page, 'Named destination')).toHaveAttribute('aria-expanded', 'true');
  // Back out with the keys: Alt+Shift+Left, then Alt+Shift+Up.
  await item(page, 'Last').focus();
  await page.keyboard.press('Alt+Shift+ArrowLeft');
  await expect(item(page, 'Last')).toHaveAttribute('aria-level', '1');
  await expect(item(page, 'Last')).toBeFocused();
  expect((await titles(page)).slice(0, 2)).toEqual(['Named destination', 'Last']);
  await page.keyboard.press('Alt+Shift+ArrowUp');
  await expect
    .poll(async () => (await titles(page)).slice(0, 2))
    .toEqual(['Last', 'Named destination']);
  await expect(item(page, 'Last')).toBeFocused();

  // Cut "Script", paste it after "Last".
  await item(page, 'Script').focus();
  await page.keyboard.press('ControlOrMeta+x');
  await expect(item(page, 'Script')).toHaveCount(0);
  await item(page, 'Last').focus();
  await page.keyboard.press('ControlOrMeta+v');
  await expect(item(page, 'Script')).toBeFocused();
  await expect
    .poll(async () => (await titles(page)).slice(0, 3))
    .toEqual(['Last', 'Script', 'Named destination']);

  // Properties (Alt+Enter): title, bold, page 3 at Fit Page.
  await item(page, 'Other file').focus();
  await page.keyboard.press('Alt+Enter');
  const dialog = page.getByRole('dialog', { name: 'Bookmark Properties' });
  // An action other than a link in this document is shown, not edited.
  await expect(dialog.getByTestId('bookmark-action')).toContainText('GoToR');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await item(page, 'Named destination').focus();
  await page.keyboard.press('Alt+Enter');
  await expect(dialog.getByLabel('Page')).toHaveValue('2');
  await dialog.getByLabel('Title').fill('Appendix');
  await dialog.getByLabel('Bold').check();
  await dialog.getByLabel('Page').fill('3');
  await dialog.getByLabel('Zoom', { exact: true }).selectOption({ label: 'Fit Page' });
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(item(page, 'Appendix')).toBeFocused();
  await expect(item(page, 'Appendix').locator('.bookmark-title')).toHaveCSS('font-weight', '600');
  await page.keyboard.press('Enter');
  await expect(pageBox(page)).toHaveValue('3');

  // The toolbar is one tab stop; its Options menu has the rest, with their keys.
  await tools(page).getByRole('button', { name: 'Bookmark options' }).click();
  const options = page.getByRole('menu', { name: 'Bookmark options' });
  await expect(options.getByRole('menuitem', { name: /Move Into Bookmark Above/ })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('a 1,000-bookmark outline: open branches, expand all, a quick rename', async ({ page }) => {
  await page.goto('/');
  await open(page, bigOutlinePdf(20, 49, 20), 'big.pdf');
  await openPane(page);
  // The file's parents are open: every row is shown.
  await expect(tree(page).getByRole('treeitem')).toHaveCount(1000);
  await tools(page).getByRole('button', { name: 'Collapse All' }).click();
  await expect(tree(page).getByRole('treeitem')).toHaveCount(20);
  await tools(page).getByRole('button', { name: 'Expand All' }).click();
  await expect(tree(page).getByRole('treeitem')).toHaveCount(1000);
  await item(page, 'Item 12.30').focus();
  const t0 = Date.now();
  await page.keyboard.press('F2');
  await rename(page, 'Renamed among 1,000');
  expect(Date.now() - t0).toBeLessThan(5000);
  await expect(tree(page).getByRole('treeitem')).toHaveCount(1000);
});

test('a document that forbids changes disables bookmark editing (rule 9)', async ({ page }) => {
  test.skip(!hasQpdf(), 'qpdf not installed');
  await page.goto('/');
  const locked = qpdfEncrypt(richOutlinePdf(), USER_PW, OWNER_PW, ['256', '--modify=none']);
  await drop(page, [{ name: 'locked.pdf', b64: b64(locked) }]);
  await page
    .getByRole('dialog', { name: 'Password required' })
    .getByLabel('Password')
    .fill(USER_PW);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  await openPane(page);
  await expect(tools(page).getByRole('button', { name: 'New Bookmark' })).toBeDisabled();
  await item(page, 'Web link').focus();
  await page.keyboard.press('F2');
  await expect(tree(page).getByRole('textbox')).toHaveCount(0);
  await page.keyboard.press('Delete');
  expect(await titles(page)).toEqual(RICH);
  // Going to a bookmark still works.
  await page.keyboard.press('Enter');
});
