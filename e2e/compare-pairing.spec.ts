import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { corpusBytes, corpusPair } from './fixtures/comparison-corpus/index.ts';
import { darkTheme, type DropFile } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M12-09 (D-60): page pairing in the input window of a PDF overlay. The pages
// are paired automatically in the workers; the pairing table shows the result
// and can be edited. Corpus pair 17: S-101 … S-106, S-103 removed in Rev B and
// S-105 and S-106 swapped.

const input = (page: Page) => page.getByTestId('compare-input');
const side = (page: Page, s: 'a' | 'b') => page.getByTestId(`compare-side-${s}`);
const table = (page: Page) => page.getByTestId('compare-pairing');
const rows = (page: Page) => table(page).getByTestId('compare-pairing-row');
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

async function openOverlay(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Compare', exact: true }).click();
  await page.getByRole('button', { name: 'PDF Overlay' }).click();
  await expect(input(page)).toBeVisible();
}

/** The table's sheets as [A side page, B side page] (null: none). */
async function sheets(page: Page): Promise<[number | null, number | null][]> {
  return rows(page).evaluateAll((trs) =>
    trs.map((tr) => {
      const v = (k: string): number | null => {
        const s = tr.getAttribute(k);
        return s === null || s === '' ? null : Number(s);
      };
      return [v('data-a'), v('data-b')] as [number | null, number | null];
    }),
  );
}

async function pairSet17(page: Page): Promise<void> {
  await page.goto('/');
  await openOverlay(page);
  await dropOn(side(page, 'a'), [corpus('17', 'old', 'Set RevA.pdf')]);
  await expect(side(page, 'a').getByTestId('compare-file')).toHaveCount(1);
  await dropOn(side(page, 'b'), [corpus('17', 'new', 'Set RevB.pdf')]);
  await expect(table(page)).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
}

test('pairs a set with a removed and two swapped sheets, and the table can be edited @smoke', async ({
  page,
}) => {
  await pairSet17(page);
  const compare = input(page).getByRole('button', { name: 'Compare', exact: true });
  await expect(compare).toBeEnabled();
  expect(await sheets(page)).toEqual([
    [0, 0],
    [1, 1],
    [2, null],
    [3, 2],
    [5, 3],
    [4, 4],
  ]);
  const status = table(page).getByRole('status');
  await expect(status).toHaveText(
    '5 sheets to compare. Added in Document B: 0. Removed from Document A: 1.',
  );
  await expect(rows(page).nth(2)).toContainText('Removed');
  await expect(rows(page).nth(0).locator('.compare-pairing-match')).toHaveText('100%');

  // Sheet 5 (A page 6 with B page 4) gets A page 5: page 6 is left on its own.
  const reset = table(page).getByRole('button', { name: 'Pair automatically' });
  await expect(reset).toBeDisabled();
  await table(page)
    .getByRole('combobox', { name: 'Document A (old) page of sheet 5' })
    .selectOption({ label: 'Page 5' });
  expect(await sheets(page)).toEqual([
    [0, 0],
    [1, 1],
    [2, null],
    [3, 2],
    [4, 3],
    [5, null],
    [null, 4],
  ]);
  await expect(table(page)).toContainText('Edited');
  await expect(status).toHaveText(
    '4 sheets to compare. Added in Document B: 1. Removed from Document A: 2.',
  );

  // Leave sheet 1 out; then back to the automatic pairing.
  await table(page).getByRole('checkbox', { name: 'Compare sheet 1' }).uncheck();
  await expect(status).toHaveText(
    '3 sheets to compare. Added in Document B: 1. Removed from Document A: 2.',
  );
  await reset.click();
  await expect(status).toHaveText(
    '5 sheets to compare. Added in Document B: 0. Removed from Document A: 1.',
  );
  await expect(table(page).getByRole('checkbox', { name: 'Compare sheet 1' })).toBeChecked();

  // No sheet left to compare: Compare waits.
  for (const n of [1, 2, 4, 5, 6])
    await table(page)
      .getByRole('checkbox', { name: `Compare sheet ${String(n)}` })
      .uncheck();
  await expect(compare).toBeDisabled();
  await expect(input(page).locator('.compare-status')).toHaveText(
    'Choose at least one sheet to compare in the pairing table.',
  );

  // A page range pairs again.
  await side(page, 'a').getByLabel('Pages of Set RevA.pdf').fill('1-2');
  await expect(table(page)).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
  expect(await sheets(page)).toEqual([
    [0, 0],
    [1, 1],
    [null, 2],
    [null, 3],
    [null, 4],
  ]);
  await expect(compare).toBeEnabled();
});

test('a set of several files per side is paired by sheet, with file names in the table', async ({
  page,
}) => {
  await page.goto('/');
  await openOverlay(page);
  await dropOn(side(page, 'a'), [
    corpus('01', 'old', 'M-101 Flange RevA.pdf'),
    corpus('16', 'old', 'C-201 Control RevA.pdf'),
  ]);
  await expect(side(page, 'a').getByTestId('compare-file')).toHaveCount(2);
  await dropOn(side(page, 'b'), [
    corpus('16', 'new', 'C-201 Control RevB.pdf'),
    corpus('01', 'new', 'M-101 Flange RevB.pdf'),
  ]);
  await expect(side(page, 'b').getByTestId('compare-file')).toHaveCount(2);
  await expect(table(page)).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
  expect(await sheets(page)).toEqual([
    [1, 0],
    [2, 1],
    [0, 2],
  ]);
  const first = table(page).getByRole('combobox', { name: 'Document A (old) page of sheet 1' });
  await expect(first.locator('option:checked')).toHaveText('C-201 Control RevA.pdf, page 1');
  await expect(
    table(page)
      .getByRole('combobox', { name: 'Document B (new) page of sheet 3' })
      .locator('option:checked'),
  ).toHaveText('M-101 Flange RevB.pdf, page 1');
});

test('the keyboard reaches the pairing table', async ({ page }) => {
  await pairSet17(page);
  const select = table(page).getByRole('combobox', { name: 'Document B (new) page of sheet 1' });
  await select.focus();
  await page.keyboard.press('Tab');
  await expect(table(page).getByRole('checkbox', { name: 'Compare sheet 1' })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(table(page).getByRole('checkbox', { name: 'Compare sheet 1' })).not.toBeChecked();
  await page.keyboard.press('Tab');
  await expect(
    table(page).getByRole('combobox', { name: 'Document A (old) page of sheet 2' }),
  ).toBeFocused();
});

for (const theme of ['light', 'dark'] as const) {
  test(`the pairing table passes axe (${theme})`, { tag: '@a11y' }, async ({ page }) => {
    if (theme === 'dark') await darkTheme(page);
    await pairSet17(page);
    await table(page).getByRole('checkbox', { name: 'Compare sheet 2' }).uncheck();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
  });
}
