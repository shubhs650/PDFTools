import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { darkTheme, drop, type DropFile } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { encryptedVariants, hasQpdf, OWNER_PW, USER_PW } from './fixtures/encrypted.ts';
import { simplePdf } from './fixtures/generate.ts';

// M12-08 (D-58, ARCHITECTURE §7.16): the comparison tab and its input window. Compare is
// on in tests (the build switch is off only in release builds).

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
const input = (page: Page) => page.getByTestId('compare-input');
const side = (page: Page, s: 'a' | 'b') => page.getByTestId(`compare-side-${s}`);
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

/** Drops files on one element, as a user dragging them onto it would. */
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

async function axe(page: Page, where: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    where,
  ).toEqual([]);
}

async function openOverlay(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Compare', exact: true }).click();
  await page.getByRole('button', { name: 'PDF Overlay' }).click();
  await expect(input(page)).toBeVisible();
}

test('Compare → PDF Overlay: a comparison tab with both sides; drop, open tab, range, swap, Compare @smoke', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await drop(page, [{ name: 'RevB.pdf', b64: pdfs.simple(2).toString('base64') }]);
  await expect(tabs(page)).toHaveCount(1);
  await openOverlay(page);
  await expect(tabs(page)).toHaveCount(2);
  const cmpTab = tabs(page).nth(1);
  await expect(cmpTab).toHaveAccessibleName('PDF Overlay');
  await expect(cmpTab).toHaveAttribute('aria-selected', 'true');
  await expect(input(page).getByRole('heading', { level: 2 })).toContainText('Preview');
  const compare = input(page).getByRole('button', { name: 'Compare', exact: true });
  await expect(compare).toBeDisabled();
  await expect(input(page).getByRole('status').last()).toHaveText(
    'Add a file to Document A (old).',
  );

  // A: a dropped file opens without a tab of its own.
  await dropOn(side(page, 'a'), [{ name: 'RevA.pdf', b64: pdfs.simple(3).toString('base64') }]);
  await expect(side(page, 'a').getByTestId('compare-file')).toContainText('RevA.pdf');
  await expect(side(page, 'a').getByTestId('compare-file')).toContainText('3 pages');
  await expect(side(page, 'a').locator('.compare-thumb img')).toHaveCount(3, { timeout: 20_000 });
  await expect(tabs(page)).toHaveCount(2);

  // B: the open tab's document (one document, it keeps its tab).
  await side(page, 'b').getByRole('button', { name: 'Use an open file' }).click();
  await page.getByRole('menuitem', { name: 'RevB.pdf' }).click();
  await expect(side(page, 'b').getByTestId('compare-file')).toContainText('RevB.pdf');
  await expect(cmpTab).toHaveAccessibleName('RevA ↔ RevB');
  await expect(compare).toBeEnabled();
  await expect(input(page).locator('.compare-status')).toHaveText(
    'Ready: 3 pages against 2 pages.',
  );

  // A page range: checked as typed, and the thumbnails follow it.
  const range = side(page, 'a').getByLabel('Pages of RevA.pdf');
  await range.fill('7');
  await expect(side(page, 'a').getByRole('alert')).toHaveText(
    'A page in this range is not in the file.',
  );
  await expect(compare).toBeDisabled();
  await range.fill('2-3');
  await expect(side(page, 'a').locator('.compare-thumb')).toHaveCount(2);
  await expect(compare).toBeEnabled();

  // Swap, with the ranges.
  await input(page).getByRole('button', { name: 'Swap Document A and Document B' }).click();
  await expect(side(page, 'a').getByTestId('compare-file')).toContainText('RevB.pdf');
  await expect(side(page, 'b').getByLabel('Pages of RevA.pdf')).toHaveValue('2-3');
  await expect(cmpTab).toHaveAccessibleName('RevB ↔ RevA');

  // Compare turns the tab into the result; the inputs can be revisited.
  await compare.click();
  await expect(page.getByTestId('compare-result')).toBeVisible();
  await page.getByRole('button', { name: 'Change inputs' }).click();
  await expect(input(page)).toBeVisible();

  // The other type keeps one file per side.
  await input(page).getByRole('radio', { name: 'Text Comparison' }).check();
  await expect(input(page)).toHaveAttribute('data-type', 'text');
  await expect(cmpTab).toHaveAccessibleName('RevB ↔ RevA');

  // Closing the comparison closes RevA (no tab of its own) and keeps RevB's tab.
  await page.getByRole('button', { name: 'Close RevB ↔ RevA' }).click();
  await expect(tabs(page)).toHaveCount(1);
  await expect(tabs(page).first()).toHaveAccessibleName('RevB.pdf');
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
});

test('an overlay side takes several files as one set, in an order the user can change', async ({
  page,
}) => {
  await page.goto('/');
  await openOverlay(page);
  await dropOn(side(page, 'a'), [
    { name: 'S-101.pdf', b64: b64(simplePdf(1)) },
    { name: 'S-102.pdf', b64: b64(simplePdf(2)) },
  ]);
  const files = side(page, 'a').getByTestId('compare-file');
  await expect(files).toHaveCount(2);
  await expect(files.first()).toContainText('S-101.pdf');
  await side(page, 'a').getByRole('button', { name: 'Move S-102.pdf up' }).click();
  await expect(files.first()).toContainText('S-102.pdf');
  await dropOn(side(page, 'b'), [{ name: 'S-201.pdf', b64: b64(simplePdf(3)) }]);
  await expect(tabs(page).first()).toHaveAccessibleName('S-102 +1 ↔ S-201');
  await side(page, 'a').getByRole('button', { name: 'Remove S-102.pdf' }).click();
  await expect(files).toHaveCount(1);
  await expect(tabs(page).first()).toHaveAccessibleName('S-101 ↔ S-201');
});

test('Compare with… on a document tab puts it on Document A', async ({ page, pdfs }) => {
  await page.goto('/');
  await drop(page, [{ name: 'drawing.pdf', b64: pdfs.simple(1).toString('base64') }]);
  await expect(tabs(page)).toHaveCount(1);
  await tabs(page).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Compare with…' }).click();
  await expect(input(page)).toBeVisible();
  await expect(side(page, 'a').getByTestId('compare-file')).toContainText('drawing.pdf');
  // Closing the document's tab while the comparison shows it only takes the tab away.
  await page.getByRole('button', { name: 'Close drawing.pdf' }).click();
  await expect(tabs(page)).toHaveCount(1);
  await expect(side(page, 'a').getByTestId('compare-file')).toContainText('drawing.pdf');
});

test('an encrypted file asks for its password; its restrictions are named, and Unlock lifts them', async ({
  page,
}) => {
  test.skip(!hasQpdf(), 'qpdf is needed to make the encrypted fixtures');
  const locked = encryptedVariants(simplePdf(1)).find((v) => v.name === 'R6-aes-256');
  if (!locked) throw new Error('R6 fixture');
  await page.goto('/');
  await openOverlay(page);
  await dropOn(side(page, 'b'), [{ name: 'locked.pdf', b64: b64(locked.bytes) }]);
  const dialog = page.getByRole('dialog', { name: 'Password required' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Password').fill(USER_PW);
  await dialog.getByRole('button', { name: 'Open' }).click();
  await expect(dialog).toBeHidden();
  const file = side(page, 'b').getByTestId('compare-file');
  await expect(file).toContainText('locked.pdf');
  await expect(file.locator('.compare-limits')).toContainText(
    "locked.pdf doesn't allow comments or copying content",
  );
  await file.getByRole('button', { name: 'Unlock locked.pdf…' }).click();
  const unlock = page.getByRole('dialog', { name: 'Unlock with owner password' });
  await unlock.getByLabel('Owner password').fill(OWNER_PW);
  await unlock.getByRole('button', { name: 'Unlock' }).click();
  await expect(unlock).toBeHidden();
  await expect(file.locator('.compare-limits')).toHaveCount(0);
});

test('the keyboard reaches every control of the input window, in order', async ({ page }) => {
  await page.goto('/');
  await openOverlay(page);
  await dropOn(side(page, 'a'), [{ name: 'A.pdf', b64: b64(simplePdf(1)) }]);
  await expect(side(page, 'a').getByTestId('compare-file')).toContainText('A.pdf');
  await dropOn(side(page, 'b'), [{ name: 'B.pdf', b64: b64(simplePdf(2)) }]);
  await expect(side(page, 'b').getByTestId('compare-file')).toContainText('B.pdf');
  await expect(input(page).getByRole('button', { name: 'Compare', exact: true })).toBeEnabled();
  // From the comparison's tab, Tab walks the window.
  await tabs(page).first().focus();
  const names: string[] = [];
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    const name = await page.evaluate(() => {
      const el = document.activeElement as HTMLInputElement | null;
      if (!el?.closest('[data-testid="compare-input"]')) return null;
      return (
        el.getAttribute('aria-label') ?? (el.labels?.[0]?.textContent ?? el.textContent).trim()
      );
    });
    if (name === null) {
      if (names.length > 0) break;
      continue;
    }
    names.push(name);
  }
  expect(names).toEqual([
    'PDF Overlay', // the type switch (one stop; arrows choose)
    'Help for comparing documents', // "?" (M12-22)
    'Remove A.pdf',
    'Pages of A.pdf',
    'Add files…', // "Use an open file" is disabled: no file is open in a tab
    'Swap Document A and Document B',
    'Remove B.pdf',
    'Pages of B.pdf',
    'Add files…',
    // The pairing table (M12-09): "Pair automatically" is off until the table is edited.
    'Document A (old) page of sheet 1',
    'Document B (new) page of sheet 1',
    'Compare sheet 1',
    'Document A (old) page of sheet 2',
    'Document B (new) page of sheet 2',
    'Options', // the presets (M12-21), collapsed
    'Compare',
  ]);
  // Arrow keys choose the type; Enter on Compare runs it.
  await input(page).getByRole('radio', { name: 'PDF Overlay' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(input(page)).toHaveAttribute('data-type', 'text');
  await input(page).getByRole('button', { name: 'Compare', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('compare-result')).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(
    `the comparison tab and input window pass axe (${theme})`,
    { tag: '@a11y' },
    async ({ page }) => {
      if (theme === 'dark') await darkTheme(page);
      await page.goto('/');
      await page.getByRole('tab', { name: 'Compare', exact: true }).click();
      await axe(page, 'ribbon: Compare');
      await page.getByRole('button', { name: 'PDF Overlay' }).click();
      await expect(input(page)).toBeVisible();
      await axe(page, 'input window, empty');
      await dropOn(side(page, 'a'), [
        { name: 'A1.pdf', b64: b64(simplePdf(2)) },
        { name: 'A2.pdf', b64: b64(simplePdf(1)) },
      ]);
      await expect(side(page, 'a').getByTestId('compare-file')).toHaveCount(2);
      await dropOn(side(page, 'b'), [{ name: 'B.pdf', b64: b64(simplePdf(3)) }]);
      await expect(side(page, 'b').locator('.compare-thumb img')).toHaveCount(3, {
        timeout: 20_000,
      });
      await side(page, 'a').getByLabel('Pages of A1.pdf').fill('x');
      await expect(side(page, 'a').getByRole('alert')).toBeVisible();
      await axe(page, 'input window, files and a range error');
      await side(page, 'a').getByLabel('Pages of A1.pdf').fill('');
      await input(page).getByRole('button', { name: 'Compare', exact: true }).click();
      await expect(page.getByTestId('compare-result')).toBeVisible();
      await axe(page, 'result');
    },
  );
}
