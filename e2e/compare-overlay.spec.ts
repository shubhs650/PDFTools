import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { corpusBytes, corpusPair } from './fixtures/comparison-corpus/index.ts';
import { darkTheme, type DropFile } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M12-11 (D-59): the overlay view. Both revisions are drawn by the Render
// worker at the current zoom, tinted (old red, new green) and multiplied, so
// what is the same is black; the floating bar shows and hides each side,
// balances, fades, thickens, blinks and changes the colours; the sheet list
// moves between sheets; comments of both documents are drawn on top with
// their switches; each file's layers are listed with the notice.

const side = (page: Page, s: 'a' | 'b') => page.getByTestId(`compare-side-${s}`);
const view = (page: Page) => page.getByTestId('overlay-view');
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Overlay controls' });
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

const corpus = (id: string, s: 'old' | 'new', name: string): DropFile => ({
  name,
  b64: b64(corpusBytes(corpusPair('overlay', id), s)),
});

async function dropOn(target: Locator, files: DropFile[]): Promise<void> {
  await target.evaluate((el, fs) => {
    const dt = new DataTransfer();
    for (const f of fs) {
      const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], f.name, { type: 'application/pdf' }));
    }
    for (const type of ['dragenter', 'dragover', 'drop'])
      el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, files);
}

/** Opens a PDF overlay of corpus pair `id` and shows its result. */
async function overlayOf(page: Page, id: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Compare', exact: true }).click();
  await page.getByRole('button', { name: 'PDF Overlay' }).click();
  await dropOn(side(page, 'a'), [corpus(id, 'old', `Pair ${id} RevA.pdf`)]);
  await expect(side(page, 'a').getByTestId('compare-file')).toHaveCount(1);
  await dropOn(side(page, 'b'), [corpus(id, 'new', `Pair ${id} RevB.pdf`)]);
  await expect(page.getByTestId('compare-pairing')).toHaveAttribute('data-status', 'done', {
    timeout: 30_000,
  });
  await page
    .getByTestId('compare-input')
    .getByRole('button', { name: 'Compare', exact: true })
    .click();
  await drawn(page);
}

/**
 * Waits until the sheet shown is aligned (its overlay is then drawn through the
 * alignment, M12-10) and every visible tile of the current state is on screen.
 */
async function drawn(page: Page): Promise<void> {
  await expect(
    page.locator('.overlay-sheet[aria-selected="true"] .overlay-sheet-align'),
  ).toBeVisible({ timeout: 30_000 });
  await expect(view(page)).toHaveAttribute('data-complete', 'true', { timeout: 30_000 });
}

interface Counts {
  red: number;
  green: number;
  blue: number;
  yellow: number;
  black: number;
  total: number;
}

/** Counts the colours of the overlay as drawn on screen (the top layer of tiles). */
async function colours(page: Page): Promise<Counts> {
  return view(page).evaluate((el) => {
    const layers = el.querySelectorAll('.overlay-tiles');
    const top = layers[layers.length - 1];
    const out = { red: 0, green: 0, blue: 0, yellow: 0, black: 0, total: 0 };
    if (!top) return out;
    for (const c of top.querySelectorAll('canvas')) {
      const copy = document.createElement('canvas');
      copy.width = c.width;
      copy.height = c.height;
      const ctx = copy.getContext('2d');
      if (!ctx) continue;
      ctx.drawImage(c, 0, 0);
      const px = ctx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i] ?? 0;
        const g = px[i + 1] ?? 0;
        const b = px[i + 2] ?? 0;
        out.total++;
        if (r < 60 && g < 60 && b < 60) out.black++;
        else if (r > 200 && g < 90 && b < 90) out.red++;
        else if (g > 200 && r < 90 && b < 90) out.green++;
        else if (b > 200 && r < 90 && g < 90) out.blue++;
        else if (r > 200 && g > 200 && b < 90) out.yellow++;
      }
    }
    return out;
  });
}

test('pair 01: old red, new green, the same black; the floating bar changes the drawing @smoke', async ({
  page,
}) => {
  await overlayOf(page, '01');
  await expect(view(page)).toHaveAccessibleName(
    'Overlay of sheet 1: Pair 01 RevA.pdf in red, Pair 01 RevB.pdf in green',
  );
  const base = await colours(page);
  expect(base.red).toBeGreaterThan(200);
  expect(base.green).toBeGreaterThan(200);
  expect(base.black).toBeGreaterThan(1000);

  // Hide the old revision: no red is left.
  await bar(page).getByRole('button', { name: 'Show Document A (old)' }).click();
  await drawn(page);
  const noA = await colours(page);
  expect(noA.red).toBe(0);
  expect(noA.green + noA.black).toBeGreaterThan(1000);
  await bar(page).getByRole('button', { name: 'Show Document A (old)' }).click();
  await drawn(page);

  // Red and blue preset.
  await bar(page).getByRole('button', { name: 'Colours' }).click();
  await page.getByRole('menuitemradio', { name: 'Red and blue' }).click();
  await expect(view(page)).toHaveAttribute('data-preset', 'redBlue');
  await drawn(page);
  const blue = await colours(page);
  expect(blue.blue).toBeGreaterThan(200);
  expect(blue.green).toBe(0);

  // Fade unchanged: the shared ink is no longer black.
  await bar(page).getByRole('button', { name: 'Fade unchanged' }).click();
  await drawn(page);
  const faded = await colours(page);
  expect(faded.black).toBeLessThan(base.black / 10);
  expect(faded.red).toBeGreaterThan(200);

  // Zoom in from the bar: the tiles are drawn again at the new zoom.
  const z0 = Number(await view(page).getAttribute('data-zoom'));
  await bar(page).getByRole('button', { name: 'Zoom in' }).click();
  await expect
    .poll(async () => Number(await view(page).getAttribute('data-zoom')))
    .toBeGreaterThan(z0);
  await drawn(page);

  // Blink: hold X in the window.
  await view(page).focus();
  await page.keyboard.down('x');
  await expect(view(page)).toHaveAttribute('data-blink', /^(a|b)$/);
  await page.keyboard.up('x');
  await expect(view(page)).toHaveAttribute('data-blink', '');

  // Back to the inputs and to the result again.
  await page.getByRole('button', { name: 'Change inputs' }).click();
  await expect(page.getByTestId('compare-input')).toBeVisible();
});

test('pair 16 (identical): no red or green anywhere', async ({ page }) => {
  await overlayOf(page, '16');
  const c = await colours(page);
  expect(c.black).toBeGreaterThan(1000);
  expect(c.red).toBe(0);
  expect(c.green).toBe(0);
});

test('pair 15 (A1 against A3): the sheet is aligned automatically and drawn through the alignment', async ({
  page,
}) => {
  await overlayOf(page, '15');
  const sheet = page.getByRole('option', { name: /Sheet 1/ });
  await expect(sheet.locator('.overlay-sheet-align')).toHaveAttribute('data-status', 'auto');
  await expect(sheet).toContainText('Auto-aligned · Shift');
  const aligned = await colours(page);
  // Drawn through the alignment, the two revisions mostly agree (the A3 plot's pens
  // are heavier relative to the sheet, S29); as is, they would not line up at all.
  expect(aligned.black).toBeGreaterThan(aligned.red);
});

test('pair 07: the sheet list moves between sheets; custom colours warn when the overlap is not dark', async ({
  page,
}) => {
  await overlayOf(page, '07');
  const list = page.getByRole('listbox', { name: 'Sheets of this comparison' });
  await expect(list.getByRole('option')).toHaveCount(2);
  await expect(page.getByText('Sheet 1 of 2')).toBeVisible();
  await list.focus();
  await page.keyboard.press('ArrowDown');
  await expect(list.getByRole('option', { name: /Sheet 2/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByText('Sheet 2 of 2')).toBeVisible();
  await drawn(page);
  const c = await colours(page);
  expect(c.red + c.green).toBeGreaterThan(100);

  await bar(page).getByRole('button', { name: 'Colours' }).click();
  await page.getByRole('menuitem', { name: 'Custom colours…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Overlay colours' });
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Colour of Document B (new)' }).click();
  await page.getByRole('button', { name: 'Orange', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(view(page)).toHaveAttribute('data-preset', 'custom');
});

test('pair 08: Thicken thin lines makes the hairlines heavier', async ({ page }) => {
  await overlayOf(page, '08');
  const thin = await colours(page);
  await bar(page)
    .getByRole('button', { name: 'Thicken thin lines (lines closer than two pixels merge)' })
    .click();
  await drawn(page);
  const thick = await colours(page);
  expect(thick.black + thick.red + thick.green).toBeGreaterThan(
    (thin.black + thin.red + thin.green) * 1.3,
  );
  await expect(
    page.getByRole('listbox', { name: 'Sheets of this comparison' }).getByRole('option'),
  ).toHaveCount(3);
});

test('pair 11: each file’s layers are listed, with the notice for a layer whose default differs', async ({
  page,
}) => {
  await overlayOf(page, '11');
  const layers = page.getByTestId('overlay-layers');
  await expect(layers.getByRole('note')).toContainText('FIRE_PROTECTION');
  await expect(layers.getByRole('list', { name: 'Layers of Pair 11 RevA.pdf' })).toContainText(
    'FIRE_PROTECTION: hidden by default',
  );
  await expect(layers.getByRole('list', { name: 'Layers of Pair 11 RevB.pdf' })).toContainText(
    'REV_CLOUDS: shown by default',
  );
});

test('pair 19: comments are drawn on top and can be switched off; check highlights hide', async ({
  page,
}) => {
  await overlayOf(page, '19');
  // The checker's yellow marks (Highlight, and Multiply ink over the drawing) are comments of A.
  const shown = await colours(page);
  expect(shown.yellow).toBeGreaterThan(500);
  await page.getByRole('checkbox', { name: 'Hide check highlights' }).check();
  await drawn(page);
  const noChecks = await colours(page);
  expect(noChecks.yellow).toBeLessThan(shown.yellow / 20);
  // Comments of A off: its red clouds and notes go too.
  await page.getByRole('checkbox', { name: 'Hide check highlights' }).uncheck();
  await page.getByRole('checkbox', { name: 'Comments of Document A' }).uncheck();
  await drawn(page);
  const noA = await colours(page);
  expect(noA.yellow).toBeLessThan(shown.yellow / 20);
  expect(noA.red).toBeLessThan(shown.red);
});

test('the overlay result passes axe in light and dark, and its controls are keyboard reachable @a11y', async ({
  page,
}) => {
  await overlayOf(page, '07');
  const axe = async (): Promise<void> => {
    const r = await new AxeBuilder({ page }).include('[data-testid="compare-result"]').analyze();
    expect(r.violations).toEqual([]);
  };
  await axe();
  await darkTheme(page);
  await axe();
  // The window, the sheet list and the bar's controls all take focus.
  await view(page).focus();
  await expect(view(page)).toBeFocused();
  await page.keyboard.press('Control+=');
  await drawn(page);
  await bar(page)
    .getByRole('slider', { name: 'Balance between Document A and Document B' })
    .focus();
  await page.keyboard.press('ArrowLeft');
  await expect(
    bar(page).getByRole('slider', { name: 'Balance between Document A and Document B' }),
  ).toHaveAttribute('aria-valuetext', 'Document A 100%, Document B 90%');
});
