import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { customColor, pickColor } from './support/colors.ts';
import { expect, test } from './support/fixtures.ts';

// M6-16 (beta follow-up): every colour the user picks opens "Standard
// colors" (8 × 6) with "More colors…" for the system picker; fill colours
// add "No fill". Keyboard: ArrowDown opens, arrows move, Enter picks, Esc
// closes back to the button.

interface Obj {
  id: string;
  color?: string;
  strokeColor?: string;
}

const pane = (page: Page) => page.getByTestId('properties-pane');
const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];

async function setup(page: Page) {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name: 'colors.pdf', b64: Buffer.from(simplePdf(1)).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  const sq = (await cap(page, 'annotate', 'createSquare', id, 0, 60, 60)) as string;
  await expect.poll(async () => (await objects(page, id)).length).toBe(1);
  await page.getByRole('tab', { name: 'View' }).click();
  await page.getByRole('button', { name: 'Properties Pane' }).click();
  await cap(page, 'annotate', 'selectMany', id, [sq]);
  return { id, sq };
}

const stroke = async (page: Page, id: string, sq: string) =>
  (await objects(page, id)).find((o) => o.id === sq)?.strokeColor?.toLowerCase();
const fill = async (page: Page, id: string, sq: string) =>
  (await objects(page, id)).find((o) => o.id === sq)?.color?.toLowerCase();

test('Properties pane: standard colours, keyboard, No fill and More colors @smoke', async ({
  page,
}, info) => {
  const { id, sq } = await setup(page);
  const button = pane(page).getByRole('button', { name: 'Stroke color', exact: true });
  await expect(button).toHaveAttribute('data-value', '#0000ff');

  // Click: the grid opens with the current colour marked and focused.
  await button.click();
  const popup = page.getByRole('dialog', { name: 'Stroke color' });
  const grid = popup.getByRole('group', { name: 'Standard colors' });
  await expect(grid.getByRole('button')).toHaveCount(48);
  await expect(grid.getByRole('button', { name: 'Blue', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(grid.getByRole('button', { name: 'Blue', exact: true })).toBeFocused();
  await expect(popup.getByRole('button', { name: 'More colors…' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('stroke-standard-colors.png') });
  const { violations } = await new AxeBuilder({ page }).include('.ui-color-popup').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  await popup.getByRole('button', { name: 'Red', exact: true }).click();
  await expect(popup).toBeHidden();
  await expect.poll(() => stroke(page, id, sq)).toBe('#ff0000');
  await expect(button).toBeFocused();

  // Keyboard: ArrowDown opens on the current colour, arrows move, Enter picks.
  await page.keyboard.press('ArrowDown');
  await expect(grid.getByRole('button', { name: 'Red', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(grid.getByRole('button', { name: 'Light red', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => stroke(page, id, sq)).toBe('#ff8080');
  // Esc closes without a change.
  await page.keyboard.press('ArrowDown');
  await expect(popup).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();
  await expect(button).toBeFocused();
  expect(await stroke(page, id, sq)).toBe('#ff8080');

  // Fill: "No fill" is in the popup; a swatch turns it on again.
  const fillButton = pane(page).getByRole('button', { name: 'Fill color', exact: true });
  await expect(fillButton).toHaveAttribute('data-value', 'transparent');
  await fillButton.click();
  const fillPopup = page.getByRole('dialog', { name: 'Fill color' });
  await expect(fillPopup.getByRole('button', { name: 'No fill' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.screenshot({ path: info.outputPath('fill-no-fill.png') });
  await fillPopup.getByRole('button', { name: 'Pale yellow', exact: true }).click();
  await expect.poll(() => fill(page, id, sq)).toBe('#ffffcc');
  await pickColor(pane(page), 'Fill color', 'No fill');
  await expect(fillButton).toHaveAttribute('data-value', 'transparent');

  // More colors…: the system picker (driven through its input here).
  await customColor(pane(page), 'Stroke color', '#123456');
  await expect.poll(() => stroke(page, id, sq)).toBe('#123456');
  await expect(button).toHaveAttribute('title', 'RGB: 18, 52, 86');
});

test('the picker in dark theme and inside a dialog (stamp status schemes)', async ({
  page,
}, info) => {
  await page.goto('/?theme=dark');
  await page.getByRole('tab', { name: 'Comment' }).click();
  await page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name: 'Status Schemes' })
    .click();
  const schemes = page.getByRole('dialog', { name: 'Status schemes' });
  await schemes.getByRole('button', { name: 'Duplicate 1 / 2 / 3 / 4' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit status scheme' });
  await editor.getByRole('button', { name: 'Colour 1', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Colour 1' });
  await expect(popup).toBeVisible();
  await page.screenshot({ path: info.outputPath('scheme-colour-dark.png') });
  const { violations } = await new AxeBuilder({ page }).include('.ui-color-popup').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  // Esc closes only the picker, not the dialog under it.
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();
  await expect(editor).toBeVisible();
  await pickColor(editor, 'Colour 1', 'Dark green');
  await expect(editor.getByRole('button', { name: 'Colour 1', exact: true })).toHaveAttribute(
    'data-value',
    '#004000',
  );
});
