import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { darkTheme, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M12-21·O4 (D-58): dropping one document tab on another offers "Compare these two". The
// lifted tab held still over another document tab for half a second takes it as its
// target; let go there, a menu offers PDF Overlay or Text Comparison, and the comparison
// opens on its input window with the first of the two tabs as Document A (old). Moving on
// lets the target go and the reorder goes on. The keyboard path is Compare with… on the
// tab's menu, then "Use an open file" on Document B.

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
// The tabs' names, also while a menu hides the rest of the page from the accessibility tree.
const names = (page: Page) =>
  page
    .locator('.tab-list .tab-button')
    .evaluateAll((els) => els.map((el) => el.querySelector('.tab-name')?.textContent));
const input = (page: Page) => page.getByTestId('compare-input');
const side = (page: Page, s: 'a' | 'b') => page.getByTestId(`compare-side-${s}`);
const offer = (page: Page) => page.getByRole('menu', { name: /^Compare .* \(old\) with / });
const hint = (page: Page) => page.locator('.tab-drop-hint');

async function openTabs(page: Page, pdfs: { simple(n: number): Buffer }, list: string[]) {
  // One at a time, so the tabs are in this order; each a different file.
  for (const [i, name] of list.entries()) {
    await drop(page, [{ name, b64: pdfs.simple(i + 1).toString('base64') }]);
    await expect(tabs(page)).toHaveCount(i + 1);
  }
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
}

const box = async (page: Page, i: number) => {
  const b = await tabs(page).nth(i).boundingBox();
  if (!b) throw new Error(`tab ${String(i)} has no box`);
  return b;
};

/**
 * Lifts tab `from` and holds it over the middle of tab `on` (its leading part covering
 * about a third of it, before that tab slides away), the button still down.
 */
async function holdOver(page: Page, from: number, on: number): Promise<void> {
  const a = await box(page, from);
  const b = await box(page, on);
  const y = a.y + a.height / 2;
  await page.mouse.move(a.x + 20, y);
  await page.mouse.down();
  // The lifted tab's left edge moves by dx: a third of the target covered.
  const dx = on > from ? b.x - (a.x + a.width) + b.width / 3 : b.x + (2 * b.width) / 3 - a.x;
  await page.mouse.move(a.x + 20 + dx, y, { steps: 12 });
}

const FOUR = ['RevA.pdf', 'RevB.pdf', 'notes.pdf', 'spec.pdf'];

test('a tab held on another and let go offers Compare these two; PDF Overlay fills both sides @smoke', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await openTabs(page, pdfs, FOUR);
  // RevB (the second tab) dragged back onto RevA: RevA, first in the strip, is Document A.
  await holdOver(page, 1, 0);
  await expect(tabs(page).nth(0)).toHaveClass(/tab--drop-target/);
  await expect(hint(page)).toHaveText('Compare these two');
  await expect(page.locator('.tab-strip .tab-moved')).toHaveText('Let go to compare with RevA.pdf');
  await page.mouse.up();
  await expect(offer(page)).toBeVisible();
  await expect(offer(page)).toHaveAccessibleName('Compare RevA.pdf (old) with RevB.pdf (new)');
  await expect(offer(page)).toContainText('Compare these two');
  await expect(offer(page).getByRole('menuitem')).toHaveText(['PDF Overlay', 'Text Comparison']);
  // The tabs kept their order, and nothing is left lifted or marked.
  expect(await names(page)).toEqual(FOUR);
  await expect(page.locator('.tab--drop-target, .tab--dragging')).toHaveCount(0);
  await expect(hint(page)).toHaveCount(0);

  await offer(page).getByRole('menuitem', { name: 'PDF Overlay' }).click();
  await expect(input(page)).toBeVisible();
  await expect(side(page, 'a').getByTestId('compare-file')).toContainText('RevA.pdf');
  await expect(side(page, 'b').getByTestId('compare-file')).toContainText('RevB.pdf');
  const cmpTab = page.getByRole('tab', { name: 'RevA ↔ RevB' });
  await expect(cmpTab).toHaveAttribute('aria-selected', 'true');
  await expect(cmpTab).toBeFocused();
  // Both documents keep their own tabs; the comparison opened right after the pair.
  expect(await names(page)).toEqual([
    'RevA.pdf',
    'RevB.pdf',
    'RevA ↔ RevB',
    'notes.pdf',
    'spec.pdf',
  ]);
  await expect(input(page).getByRole('button', { name: 'Compare', exact: true })).toBeEnabled();
});

test('Text Comparison from the offer; dragging the first tab right makes it Document A', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await openTabs(page, pdfs, FOUR);
  await holdOver(page, 0, 2);
  await expect(tabs(page).nth(2)).toHaveClass(/tab--drop-target/);
  await page.mouse.up();
  await offer(page).getByRole('menuitem', { name: 'Text Comparison' }).click();
  await expect(input(page)).toBeVisible();
  await expect(side(page, 'a').getByTestId('compare-file')).toContainText('RevA.pdf');
  await expect(side(page, 'b').getByTestId('compare-file')).toContainText('notes.pdf');
  await expect(page.getByRole('tab', { name: 'RevA ↔ notes' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('moving on lets the target go and reorders; Esc on the offer changes nothing', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await openTabs(page, pdfs, FOUR);
  // Held over notes.pdf, then carried on to the end: an ordinary move.
  await holdOver(page, 0, 2);
  await expect(tabs(page).nth(2)).toHaveClass(/tab--drop-target/);
  const last = await box(page, 3);
  await page.mouse.move(last.x + last.width - 10, last.y + last.height / 2, { steps: 12 });
  await expect(page.locator('.tab--drop-target')).toHaveCount(0);
  await page.mouse.up();
  await expect.poll(() => names(page)).toEqual(['RevB.pdf', 'notes.pdf', 'spec.pdf', 'RevA.pdf']);
  await expect(offer(page)).toHaveCount(0);

  // A quick drag over a tab (no hold) only reorders, as before.
  const first = await box(page, 0);
  const b = await box(page, 3);
  await page.mouse.move(b.x + 20, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x - 30, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => names(page)).toEqual(['RevA.pdf', 'RevB.pdf', 'notes.pdf', 'spec.pdf']);

  // Esc on the offer: no comparison, the order as it was, focus on the dragged tab.
  await holdOver(page, 3, 1);
  await expect(tabs(page).nth(1)).toHaveClass(/tab--drop-target/);
  await page.mouse.up();
  await expect(offer(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(offer(page)).toHaveCount(0);
  expect(await names(page)).toEqual(FOUR);
  await expect(tabs(page).nth(3)).toBeFocused();
  // The tab's own menu is back on a right-click.
  await tabs(page).nth(1).click({ button: 'right' });
  await expect(page.getByRole('menu', { name: 'RevB.pdf tab' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('a comparison tab is no drop target, and is not dropped on a document', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await openTabs(page, pdfs, FOUR.slice(0, 2));
  await page.getByRole('tab', { name: 'Compare', exact: true }).click();
  await page.getByRole('button', { name: 'PDF Overlay' }).click();
  await expect(input(page)).toBeVisible();
  await expect(tabs(page)).toHaveCount(3); // RevA, RevB, PDF Overlay
  // A document held on the comparison tab.
  await holdOver(page, 1, 2);
  await page.waitForTimeout(800);
  await expect(page.locator('.tab--drop-target')).toHaveCount(0);
  await expect(hint(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  // The comparison tab held on a document.
  await holdOver(page, 2, 1);
  await page.waitForTimeout(800);
  await expect(page.locator('.tab--drop-target')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(offer(page)).toHaveCount(0);
  expect(await names(page)).toEqual(['RevA.pdf', 'RevB.pdf', 'PDF Overlay']);
});

test('the keyboard path: Compare with… on the tab menu, then an open file on Document B', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await openTabs(page, pdfs, FOUR.slice(0, 2));
  await tabs(page).nth(0).click();
  await tabs(page).nth(0).press('Shift+F10');
  await expect(page.getByRole('menu', { name: 'RevA.pdf tab' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Compare with…' }).focus();
  await page.keyboard.press('Enter');
  await expect(input(page)).toBeVisible();
  await expect(side(page, 'a').getByTestId('compare-file')).toContainText('RevA.pdf');
  const useOpen = side(page, 'b').getByRole('button', { name: 'Use an open file' });
  await useOpen.focus();
  // The menu opens on the first open file (RevA.pdf could go on B too); RevB.pdf is next.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'RevA.pdf' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  const revB = page.getByRole('menuitem', { name: 'RevB.pdf' });
  await expect(revB).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(side(page, 'b').getByTestId('compare-file')).toContainText('RevB.pdf');
  await expect(page.getByRole('tab', { name: 'RevA ↔ RevB' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

for (const theme of ['light', 'dark'] as const)
  test(`the drop target, its hint and the offer pass axe (${theme})`, async ({ page, pdfs }) => {
    await page.goto('/');
    if (theme === 'dark') await darkTheme(page);
    await openTabs(page, pdfs, FOUR.slice(0, 2));
    await holdOver(page, 1, 0);
    await expect(hint(page)).toBeVisible();
    // The lifted tab is a see-through ghost over its target while held (not text to read).
    const held = await new AxeBuilder({ page }).exclude('.tab--dragging').analyze();
    expect(held.violations.map((v) => v.id)).toEqual([]);
    await page.mouse.up();
    await expect(offer(page)).toBeVisible();
    const open = await new AxeBuilder({ page }).include('[role="menu"]').analyze();
    expect(open.violations.map((v) => v.id)).toEqual([]);
    await page.keyboard.press('Escape');
  });
