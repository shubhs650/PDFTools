import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M6-17 (D-37; owner request 2026-11-03): the Comment Styles Palette is a
// PDF-XChange-style window. Tools in groups on the left; the tool's Current
// Style and its Custom Styles (presets and the user's own, one list) as tiles;
// the selected tile's properties on the right. Clone, Rename, Reset, Delete,
// Set Current, Reset All; every change is saved on the device at once.

const SHOTS = process.env.M6_17_SHOTS;

interface Style {
  id: string;
  name: string;
  props: Record<string, unknown>;
  preset?: string;
}

const styleOf = async (page: Page, tool: string) =>
  (await cap(page, 'annotate', 'styleOf', tool)) as Record<string, unknown>;
const stored = async (page: Page, tool: string) =>
  ((await cap(page, 'annotate', 'commentStyles')) as Record<string, Style[] | undefined>)[tool] ??
  null;

async function openDoc(page: Page): Promise<string> {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name: 'styles.pdf', b64: Buffer.from(simplePdf(1)).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await page.getByRole('tab', { name: 'Comment', exact: true }).click();
  return id;
}

async function openWindow(page: Page, tool = 'Rectangle') {
  await page.getByRole('button', { name: `${tool} styles`, exact: true }).click();
  await page
    .getByRole('menu', { name: /styles$/ })
    .getByRole('menuitem', { name: 'Comment Styles Palette…' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Comment Styles Palette' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function axe(page: Page, what: string) {
  const r = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(r.violations.map((v) => `${what}: ${v.id}`)).toEqual([]);
}

test('the window: tools, Current Style, presets as Custom Styles, edit, clone, set current, reset @smoke', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openDoc(page);
  const dialog = await openWindow(page);
  const tools = dialog.getByRole('listbox', { name: 'Comment tools' });
  await expect(tools.getByRole('option', { selected: true })).toHaveText('Rectangle');
  for (const g of ['Drawings', 'Text Boxes', 'Text Markups', 'Notes'])
    await expect(tools.getByRole('group', { name: g })).toBeVisible();
  // The six tools added in M6-17 are listed.
  for (const name of [
    'Underline',
    'Strikeout',
    'Squiggly',
    'Highlight Area',
    'Free Highlight',
    'Sticky Note',
  ])
    await expect(tools.getByRole('option', { name, exact: true })).toBeVisible();

  const tiles = dialog.getByRole('listbox', { name: 'Rectangle styles' });
  await expect(tiles.getByRole('option', { name: 'Current Style' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const custom = tiles.getByRole('group', { name: 'Custom Styles' }).getByRole('option');
  await expect(custom).toHaveCount(14);
  await expect(custom.first()).toHaveAccessibleName('Red');
  await expect(custom.nth(7)).toHaveAccessibleName('Red cloudy');
  const props = dialog.getByTestId('style-properties');
  await expect(props.getByText('Properties of Current Style')).toBeVisible();
  // The Current Style can't be renamed, deleted or set current.
  for (const a of ['Rename', 'Delete', 'Set Current'])
    await expect(dialog.getByRole('button', { name: a, exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  await axe(page, 'Comment Styles Palette');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-window-1366.png` });

  // Edit a preset in place: Blue gets a 3 pt line.
  await tiles.getByRole('option', { name: 'Blue', exact: true }).click();
  await expect(props.getByText('Properties of Blue')).toBeVisible();
  const width = props.getByLabel('Line width');
  await width.fill('3');
  await width.press('Enter');
  await expect
    .poll(async () => (await stored(page, 'square'))?.find((s) => s.preset === 'blue')?.props)
    .toMatchObject({ strokeColor: '#0000FF', strokeWidth: 3 });
  await expect(dialog.getByRole('button', { name: 'Reset', exact: true })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );

  // Clone it: the copy comes right after, its name field open.
  await dialog.getByRole('button', { name: 'Clone', exact: true }).click();
  const field = dialog.getByLabel('Style name');
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('Blue copy');
  await field.fill('Steel 3 pt');
  await field.press('Enter');
  await expect(custom.nth(4)).toHaveAccessibleName('Steel 3 pt');
  await expect(custom.nth(4)).toBeFocused();
  await expect(custom).toHaveCount(15);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/02-cloned-1366.png` });

  // Set Current: the tool's next rectangle has it.
  await dialog.getByRole('button', { name: 'Set Current', exact: true }).click();
  await expect
    .poll(() => styleOf(page, 'square'))
    .toMatchObject({ strokeColor: '#0000FF', strokeWidth: 3 });
  await expect(dialog.getByTestId('comment-styles-message')).toHaveText(
    'Rectangle Current Style set to Steel 3 pt',
  );

  // Edit the Current Style directly: dashed.
  await tiles.getByRole('option', { name: 'Current Style' }).click();
  await props.getByLabel('Line style').selectOption('dashed');
  await expect.poll(() => styleOf(page, 'square')).toMatchObject({ strokeStyle: 2 });

  // Reset the edited preset, delete the copy.
  await tiles.getByRole('option', { name: 'Blue', exact: true }).click();
  await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect
    .poll(async () => (await stored(page, 'square'))?.find((s) => s.preset === 'blue')?.props)
    .toEqual({ strokeColor: '#0000FF', cloudyBorderIntensity: 0 });
  await tiles.getByRole('option', { name: 'Steel 3 pt' }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(custom).toHaveCount(14);
  await expect(dialog.getByTestId('comment-styles-message')).toHaveText('Steel 3 pt deleted');

  // A deleted preset stays deleted after a reload; Reset All brings it back.
  await tiles.getByRole('option', { name: 'Purple', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(custom).toHaveCount(13);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await openDoc(page);
  const again = await openWindow(page);
  const list = again
    .getByRole('listbox', { name: 'Rectangle styles' })
    .getByRole('group', { name: 'Custom Styles' })
    .getByRole('option');
  await expect(list).toHaveCount(13);
  await expect.poll(() => styleOf(page, 'square')).toMatchObject({ strokeStyle: 2 });
  await again.getByRole('button', { name: 'Reset All' }).click();
  const confirm = page.getByRole('dialog', { name: 'Reset all comment styles?' });
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/05-reset-all-1366.png` });
  await confirm.getByRole('button', { name: 'Reset All' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(list).toHaveCount(14);
  await expect(list.nth(1)).toHaveAccessibleName('Purple');
  await expect.poll(() => styleOf(page, 'square')).toMatchObject({ strokeColor: '#FF0000' });
  expect((await styleOf(page, 'square')).strokeStyle).toBeUndefined();
});

test('keyboard: tool list, tiles, rename with F2, Esc cancels only the rename, Delete, Alt+arrows @smoke', async ({
  page,
}) => {
  const id = await openDoc(page);
  const dialog = await openWindow(page, 'Line');
  const tools = dialog.getByRole('listbox', { name: 'Comment tools' });
  const line = tools.getByRole('option', { name: 'Line', exact: true });
  await line.focus();
  await page.keyboard.press('ArrowDown');
  await expect(tools.getByRole('option', { name: 'Arrow', exact: true })).toBeFocused();
  await expect(dialog.getByRole('listbox', { name: 'Arrow styles' })).toBeVisible();
  // Type-ahead.
  await page.keyboard.press('u');
  await expect(tools.getByRole('option', { name: 'Underline' })).toBeFocused();
  await expect(tools.getByRole('option', { name: 'Underline' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  const tiles = dialog.getByRole('listbox', { name: 'Underline styles' });
  const custom = tiles.getByRole('group', { name: 'Custom Styles' }).getByRole('option');
  await tiles.getByRole('option', { name: 'Current Style' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(custom.first()).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(custom.nth(1)).toBeFocused();
  await expect(custom.nth(1)).toHaveAccessibleName('Purple');

  // Enter sets the current style.
  await page.keyboard.press('Enter');
  await expect.poll(() => styleOf(page, 'underline')).toMatchObject({ strokeColor: '#800080' });

  // F2 renames; Esc cancels the rename and keeps the window open.
  await page.keyboard.press('F2');
  const field = dialog.getByLabel('Style name');
  await expect(field).toBeFocused();
  await field.fill('Never mind');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(custom.nth(1)).toHaveAccessibleName('Purple');
  await expect(custom.nth(1)).toBeFocused();
  await page.keyboard.press('F2');
  await field.fill('Review');
  await page.keyboard.press('Enter');
  await expect(custom.nth(1)).toHaveAccessibleName('Review');

  // Alt+Left moves it first; Delete deletes and selects the next.
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(custom.first()).toHaveAccessibleName('Review');
  await expect(custom.first()).toBeFocused();
  await page.keyboard.press('Delete');
  await expect(custom.first()).toHaveAccessibleName('Red');
  await expect(custom.first()).toBeFocused();
  await expect(custom).toHaveCount(6);
  await expect
    .poll(async () => (await stored(page, 'underline'))?.map((s) => s.name))
    .toEqual(['', '', '', '', '', '']);

  // The toolbar is one tab stop with arrow keys.
  const clone = dialog.getByRole('button', { name: 'Clone', exact: true });
  await clone.focus();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('button', { name: 'Rename', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(dialog.getByRole('button', { name: 'Import…' })).toBeFocused();
  await axe(page, 'Comment Styles Palette (Underline)');

  // The underline made next has the current style.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+A');
  await expect
    .poll(
      async () =>
        ((await cap(page, 'view', 'selection')) as { selection: unknown } | null)?.selection,
    )
    .toBeTruthy();
  await page.keyboard.press('u');
  await expect
    .poll(async () =>
      ((await cap(page, 'annotate', 'objects', id)) as { strokeColor?: string }[] | null)?.map(
        (o) => o.strokeColor,
      ),
    )
    .toEqual(['#800080']);
});

test('Sticky Note, Free Highlight and Highlight Area take their style from the window', async ({
  page,
}) => {
  const id = await openDoc(page);
  const dialog = await openWindow(page, 'Line');
  const tools = dialog.getByRole('listbox', { name: 'Comment tools' });
  for (const [name, tool, preset, want] of [
    ['Sticky Note', 'textComment', 'Blue', { strokeColor: '#0000FF' }],
    ['Free Highlight', 'inkHighlighter', 'Green', { strokeColor: '#A4EBA4', color: '#A4EBA4' }],
    ['Highlight Area', 'highlightArea', 'Blue', { color: '#9CCBFF' }],
  ] as const) {
    await tools.getByRole('option', { name, exact: true }).click();
    const tiles = dialog.getByRole('listbox', { name: `${name} styles` });
    await tiles.getByRole('option', { name: preset, exact: true }).dblclick();
    await expect.poll(() => styleOf(page, tool)).toMatchObject(want);
    // The plugin's tool has it too, so the next comment does.
    await expect
      .poll(async () => await cap(page, 'annotate', 'toolDefaults', tool))
      .toMatchObject(want);
  }
  if (SHOTS) {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ path: `${SHOTS}/03-highlight-area-1920.png` });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.screenshot({ path: `${SHOTS}/04-highlight-area-1280.png` });
    await page.setViewportSize({ width: 800, height: 700 });
    await page.screenshot({ path: `${SHOTS}/06-narrow-800.png` });
  }
  await page.keyboard.press('Escape');
  expect(id).toBeTruthy();
});

test('with no document open the window still edits the styles', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Comment', exact: true }).click();
  await page.locator('button[data-command="comment.stylesPalette"]').first().click();
  const dialog = page.getByRole('dialog', { name: 'Comment Styles Palette' });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('listbox', { name: 'Comment tools' })
    .getByRole('option', { name: 'Arrow' })
    .click();
  const props = dialog.getByTestId('style-properties');
  // The arrow's line end shows without the plugin running.
  await expect(props.getByLabel('Line end')).toHaveValue(/\d/);
  await props.getByLabel('Line end').selectOption({ label: 'Closed arrow' });
  await expect.poll(() => styleOf(page, 'lineArrow')).toMatchObject({ lineEndings: { end: 5 } });
});
