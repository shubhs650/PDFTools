import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M6-07 (ADR-021 D-37; beta review B5): the comment tools are split buttons;
// the arrow opens a palette of preset swatches (Red … Black, Cloudy variants
// for closed shapes) and the user's own styles. A swatch restyles the
// selected comments of the tool's group in one undo step, or sets the tool's
// style and turns it on. The Comment Styles Palette window (M6-17,
// styles-window.spec.ts) manages them; here its export and import.

interface Obj {
  id: string;
  type: number;
  strokeColor?: string;
  color?: string;
  cloudyBorderIntensity?: number;
}

const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];
const styleOf = async (page: Page, tool: string) =>
  (await cap(page, 'annotate', 'styleOf', tool)) as Record<string, unknown>;

async function openDoc(page: Page): Promise<string> {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name: 'palette.pdf', b64: Buffer.from(simplePdf(1)).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await page.getByRole('tab', { name: 'Comment', exact: true }).click();
  return id;
}

const arrow = (page: Page, tool: string) =>
  page.getByRole('button', { name: `${tool} styles`, exact: true });
const palette = (page: Page) => page.getByRole('menu', { name: /styles$/ });

async function axe(page: Page, what: string, scope: string) {
  const r = await new AxeBuilder({ page }).include(scope).analyze();
  expect(r.violations.map((v) => `${what}: ${v.id}`)).toEqual([]);
}

test('keyboard: open the Line palette, move in the grid, Enter sets the style and starts the tool @smoke', async ({
  page,
}) => {
  await openDoc(page);
  const line = arrow(page, 'Line');
  await expect(line).toBeVisible();
  await line.focus();
  await page.keyboard.press('ArrowDown');
  const menu = palette(page);
  await expect(menu).toBeVisible();
  await expect(menu.locator('.style-palette-hint')).toHaveText('Sets the Line tool’s style');
  // Seven presets, no cloudy variant for a line; Red (the shipped default) is current.
  await expect(
    menu.getByRole('group', { name: 'Custom Styles' }).getByRole('menuitem'),
  ).toHaveCount(7);
  await expect(menu.locator('[data-current]')).toHaveAttribute('aria-label', 'Red');
  await axe(page, 'Line palette', '[role="menu"]');
  await expect(menu.getByRole('menuitem', { name: 'Red', exact: true })).toBeFocused();
  for (const k of ['ArrowRight', 'ArrowRight', 'ArrowRight']) await page.keyboard.press(k);
  await expect(menu.getByRole('menuitem', { name: 'Blue', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Comment Styles Palette…' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(menu.getByRole('menuitem', { name: 'Red', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Comment Styles Palette…' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(menu.getByRole('menuitem', { name: 'Black', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(menu.getByRole('menuitem', { name: 'Red', exact: true })).toBeFocused();
  // Esc closes and gives focus back to the arrow.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(line).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect.poll(() => styleOf(page, 'line')).toMatchObject({ strokeColor: '#0000FF' });
  await expect
    .poll(
      async () =>
        ((await cap(page, 'annotate', 'toolDefaults', 'line')) as Obj | null)?.strokeColor,
    )
    .toBe('#0000FF');
  await expect(page.locator('button[data-command="comment.line"]').first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // The choice persists across a reload.
  await openDoc(page);
  await expect.poll(() => styleOf(page, 'line')).toMatchObject({ strokeColor: '#0000FF' });
});

test('with a rectangle selected a swatch restyles it in one undo step; Cloudy variants @smoke', async ({
  page,
}) => {
  const id = await openDoc(page);
  const sq = (await cap(page, 'annotate', 'createSquare', id, 0, 60, 60)) as string;
  await expect.poll(async () => (await objects(page, id)).length).toBe(1);
  const before = (await objects(page, id)).find((o) => o.id === sq)?.strokeColor;
  await cap(page, 'annotate', 'selectMany', id, [sq]);
  await arrow(page, 'Rectangle').click();
  const menu = palette(page);
  await expect(menu.locator('.style-palette-hint')).toHaveText('Applies to the selected comment');
  await expect(
    menu.getByRole('group', { name: 'Custom Styles' }).getByRole('menuitem'),
  ).toHaveCount(14);
  await menu.getByRole('menuitem', { name: 'Green cloudy', exact: true }).click();
  await expect
    .poll(async () => (await objects(page, id)).find((o) => o.id === sq))
    .toMatchObject({ strokeColor: '#008000', cloudyBorderIntensity: 2 });
  // The tool's own style is untouched.
  expect(await styleOf(page, 'square')).toMatchObject({ strokeColor: '#FF0000' });
  await cap(page, 'annotate', 'undo', id);
  await expect
    .poll(async () => (await objects(page, id)).find((o) => o.id === sq)?.strokeColor)
    .toBe(before);
  const back = (await objects(page, id)).find((o) => o.id === sq);
  expect(back?.cloudyBorderIntensity ?? 0).toBe(0);
  // A Line style does not reach a rectangle: the Line palette sets the tool instead.
  await arrow(page, 'Line').click();
  await expect(palette(page).locator('.style-palette-hint')).toHaveText(
    'Sets the Line tool’s style',
  );
  await page.keyboard.press('Escape');
});

test('Comment Styles Palette: export and import; imported styles are in the palette', async ({
  page,
}) => {
  await openDoc(page);
  await cap(page, 'annotate', 'setToolDefaults', 'square', {
    strokeColor: '#123456',
    strokeWidth: 3,
  });
  await arrow(page, 'Rectangle').click();
  await palette(page).getByRole('menuitem', { name: 'Comment Styles Palette…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Comment Styles Palette' });
  await expect(dialog).toBeVisible();
  // Clone the Current Style (M6-17) under a name of its own.
  await dialog.getByRole('button', { name: 'Clone', exact: true }).click();
  const name = dialog.getByLabel('Style name');
  await expect(name).toBeFocused();
  await name.fill('Steel 3 pt');
  await name.press('Enter');
  const list = dialog
    .getByRole('listbox', { name: 'Rectangle styles' })
    .getByRole('group', { name: 'Custom Styles' })
    .getByRole('option');
  await expect(list.last()).toHaveAccessibleName('Steel 3 pt');

  // Export every tool's styles: presets as shipped stay out of the file.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Export…' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('comment-styles.pdftools-styles.json');
  const path = await download.path();
  const exported = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  expect(exported).toEqual({
    format: 'pdftools-styles',
    version: 1,
    tools: {
      square: [
        {
          name: 'Steel 3 pt',
          props: { strokeColor: '#123456', strokeWidth: 3, color: 'transparent' },
        },
      ],
    },
  });

  // Import: a malformed file is refused with the reason; a good one is appended.
  const input = dialog.getByTestId('comment-styles-import');
  await input.setInputFiles({
    name: 'bad.pdftools-styles.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      '{"format":"pdftools-styles","version":1,"tools":{"square":[{"name":"X","props":{"strokeColor":"red"}}]}}',
    ),
  });
  await expect(dialog.getByTestId('comment-styles-message')).toHaveText(
    'Nothing imported. A style in the file has no name or a property PDFTools cannot use.',
  );
  await input.setInputFiles({
    name: 'good.pdftools-styles.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        format: 'pdftools-styles',
        version: 1,
        tools: {
          square: [{ name: 'Blue 2 pt', props: { strokeColor: '#0000FF', strokeWidth: 2 } }],
        },
      }),
    ),
  });
  await expect(dialog.getByTestId('comment-styles-message')).toHaveText('1 style imported');
  await expect(list).toHaveCount(16);
  await expect(list.last()).toHaveAccessibleName('Blue 2 pt');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // They persist, and show after the presets in the palette.
  await openDoc(page);
  await arrow(page, 'Rectangle').click();
  const styles = palette(page).getByRole('group', { name: 'Custom Styles' });
  await expect(styles.getByRole('menuitem')).toHaveCount(16);
  await styles.getByRole('menuitem', { name: 'Blue 2 pt' }).click();
  await expect
    .poll(() => styleOf(page, 'square'))
    .toMatchObject({ strokeColor: '#0000FF', strokeWidth: 2 });
});

test('Highlight palette: a tint becomes the next highlight’s colour', async ({ page }) => {
  const id = await openDoc(page);
  await arrow(page, 'Highlight').click();
  const menu = palette(page);
  // No black highlighter; yellow is current.
  await expect(
    menu.getByRole('group', { name: 'Custom Styles' }).getByRole('menuitem'),
  ).toHaveCount(6);
  await expect(menu.locator('[data-current]')).toHaveAttribute('aria-label', 'Yellow');
  await menu.getByRole('menuitem', { name: 'Green', exact: true }).click();
  await expect.poll(() => styleOf(page, 'highlight')).toMatchObject({ strokeColor: '#A4EBA4' });
  // The tool is on; turn it off, select the text and highlight it.
  await page.keyboard.press('Escape');
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+A');
  await expect
    .poll(
      async () =>
        ((await cap(page, 'view', 'selection')) as { selection: unknown } | null)?.selection,
    )
    .toBeTruthy();
  await page.keyboard.press('g');
  await expect
    .poll(async () => (await objects(page, id)).map((o) => [o.strokeColor, o.color]))
    .toEqual([['#A4EBA4', '#A4EBA4']]);
});

test('no ribbon tab overflows at 1280 px with the split buttons', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openDoc(page);
  for (const tab of ['Home', 'Comment']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    const over = await page.evaluate(() => {
      const panel = document.getElementById('ribbon-panel');
      return panel ? panel.scrollWidth - panel.clientWidth : -1;
    });
    expect(over, tab).toBeLessThanOrEqual(1);
  }
});
