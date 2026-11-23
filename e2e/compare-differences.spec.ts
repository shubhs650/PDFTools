import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { cap, darkTheme } from './support/app.ts';
import { openFilters, overlayOf, unfold } from './support/compare.ts';
import { expect, test } from './support/fixtures.ts';
import { skipReviewerPrompt } from './support/shots.ts';

// M12-14 (D-61, Q17, Q22, Q23): differences on drawings. On corpus pair 01
// (a flange, one sheet) the list fills as the sheet is detected, text-aware
// ("Ø120.0 → Ø128.0"), with filters, search on Enter, next and previous
// (F8, Shift+F8), the checked tick and outlines on the overlay; sensitivity,
// minimum size and ignore zones apply live; Make cloud comments adds real
// cloud comments to Document B. On pair 10 (four sheets, sheet 2 an
// identical control page) the sheet list says which sheets are unchanged and
// how much each changed.

const pane = (page: Page) => page.getByTestId('diff-pane');
const count = (page: Page) => page.getByTestId('diff-count');
const rows = (page: Page) => page.getByTestId('diff-list').getByRole('option');

/** Waits until every sheet is detected; the number of differences in scope. */
async function detected(page: Page, sheets: number): Promise<number> {
  await expect(count(page)).toHaveAttribute('data-detected', String(sheets), { timeout: 60_000 });
  return Number(await count(page).getAttribute('data-count'));
}

/** Shows only the entries whose words match (search runs on Enter, rule 3); '' shows all again. */
async function searchFor(page: Page, q: string): Promise<void> {
  const search = page.getByTestId('diff-search');
  await search.fill(q);
  await search.press('Enter');
}

const shownCount = async (page: Page): Promise<number> =>
  Number(await count(page).getAttribute('data-shown'));

interface Listed {
  id: string;
  type: number;
}

test.describe('differences on drawings', () => {
  test('pair 01: text-aware entries, filters, search, next and the checked tick', async ({
    page,
  }) => {
    await overlayOf(page, '01');
    const total = await detected(page, 1);
    // S28 found every manifest change; the flange has more than twenty.
    expect(total).toBeGreaterThan(20);
    // Only the rows in view are drawn: a search brings an entry in.
    await searchFor(page, 'Ø128.0');
    await expect(pane(page).getByRole('option', { name: /Ø120\.0 → Ø128\.0/ })).toHaveCount(1);
    await searchFor(page, 'H6');
    await expect(pane(page).getByRole('option', { name: /H7 \(\+0\.030\/0\) → H6/ })).toHaveCount(
      1,
    );
    await searchFor(page, '');
    await expect.poll(() => shownCount(page)).toBe(total);
    // The sheet list says how much changed.
    await expect(page.getByTestId('sheet-diff').first()).toHaveText(/differences · .*% changed/);

    // Next (F8) selects the first; the overlay outlines it.
    await page.getByTestId('diff-list').focus();
    await page.keyboard.press('F8');
    await expect(rows(page).first()).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.diff-outline[data-selected]')).toHaveCount(1);
    await page.keyboard.press('F8');
    await expect(rows(page).nth(1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Shift+F8');
    await expect(rows(page).first()).toHaveAttribute('aria-selected', 'true');
    // Space ticks it; Hide checked leaves it out.
    await page.getByTestId('diff-list').focus();
    await page.keyboard.press('Space');
    await expect(rows(page).first()).toHaveAttribute('data-checked', 'true');
    await pane(page).getByRole('checkbox', { name: 'Hide checked' }).check();
    expect(await shownCount(page)).toBe(total - 1);
    await pane(page).getByRole('checkbox', { name: 'Hide checked' }).uncheck();

    // Search on Enter only (rule 3).
    const search = page.getByTestId('diff-search');
    await search.fill('Ø128');
    expect(await shownCount(page)).toBe(total);
    await search.press('Enter');
    await expect.poll(() => shownCount(page)).toBe(2);
    await search.press('Escape');
    await expect.poll(() => shownCount(page)).toBe(total);

    // Kinds and types: only text.
    await page.getByTestId('diff-type-geometry').uncheck();
    await page.getByTestId('diff-type-both').uncheck();
    const text = await shownCount(page);
    expect(text).toBeGreaterThan(5);
    expect(text).toBeLessThan(total);
    for (const r of await rows(page).all()) await expect(r).toHaveAttribute('data-type', 'text');
    await page.getByTestId('diff-type-geometry').check();
    await page.getByTestId('diff-type-both').check();

    // Outlines can be switched off.
    await expect(page.locator('.diff-outline').first()).toBeAttached();
    await page.getByTestId('diff-outlines').uncheck();
    await expect(page.locator('.diff-outline')).toHaveCount(0);
    await page.getByTestId('diff-outlines').check();
  });

  test('pair 01: sensitivity, minimum size and ignore zones apply live; named sets', async ({
    page,
  }) => {
    await overlayOf(page, '01');
    const normal = await detected(page, 1);
    // A minimum size of 10 mm drops the small ones (bolt holes, digits).
    await openFilters(page);
    await page.getByTestId('diff-min-size').selectOption('10');
    await expect.poll(() => count(page).getAttribute('data-count')).not.toBe(String(normal));
    const big = Number(await count(page).getAttribute('data-count'));
    expect(big).toBeLessThan(normal);
    await page.getByTestId('diff-min-size').selectOption('0');
    await expect(count(page)).toHaveAttribute('data-count', String(normal));
    // Sensitivity changes what counts as moved.
    await page.getByTestId('diff-sensitivity').selectOption('high');
    await expect.poll(() => count(page).getAttribute('data-count')).not.toBe(String(normal));
    await page.getByTestId('diff-sensitivity').selectOption('normal');
    await expect(count(page)).toHaveAttribute('data-count', String(normal));

    // An ignore zone over the title block and revision table (the bottom of the A3 sheet),
    // typed in millimetres: the revision row and the title's date and letter go.
    await searchFor(page, '8-BOLT');
    await expect(pane(page).getByRole('option', { name: /8-BOLT/ })).toHaveCount(1);
    await unfold(page, 'zones');
    const zones = page.getByTestId('ignore-zones');
    await page.getByTestId('zone-left').fill('0');
    await page.getByTestId('zone-top').fill('260');
    await page.getByTestId('zone-width').fill('420');
    await page.getByTestId('zone-height').fill('37');
    await zones.getByRole('button', { name: 'Add zone' }).click();
    await expect(page.getByTestId('zone-list').getByRole('listitem')).toHaveCount(1);
    await expect(pane(page).getByRole('option', { name: /8-BOLT/ })).toHaveCount(0);
    await searchFor(page, '');
    const zoned = Number(await count(page).getAttribute('data-count'));
    expect(zoned).toBeLessThan(normal);
    await expect(page.locator('.diff-zone')).toHaveCount(1);

    // Saved as a set, removed, then used again.
    await page.getByTestId('zone-set-name').fill('Title block A3');
    await zones.getByRole('button', { name: 'Save as set' }).click();
    await expect(zones.getByRole('status')).toHaveText('Saved “Title block A3”.');
    await zones.getByRole('button', { name: 'Remove zone 1' }).click();
    await expect(count(page)).toHaveAttribute('data-count', String(normal));
    await page.getByTestId('zone-set').selectOption({ label: 'Title block A3' });
    await zones.getByRole('button', { name: 'Use set' }).click();
    await expect(count(page)).toHaveAttribute('data-count', String(zoned));

    // Drawing a zone on the overlay (pointer path).
    await zones.getByRole('button', { name: 'Draw a zone' }).click();
    const layer = page.getByTestId('diff-zone-layer');
    const box = await layer.boundingBox();
    if (!box) throw new Error('no zone layer');
    await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.1);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3, { steps: 4 });
    await page.mouse.up();
    await expect(page.getByTestId('zone-list').getByRole('listitem')).toHaveCount(2);
    await expect(layer).toHaveCount(0);
  });

  test('pair 01: Make cloud comments adds clouds to Document B only', async ({ page }) => {
    await overlayOf(page, '01');
    await skipReviewerPrompt(page);
    await detected(page, 1);
    const b = await page
      .getByTestId('review-window-b')
      .locator('.viewport')
      .getAttribute('data-doc-id');
    const a = await page
      .getByTestId('review-window-a')
      .locator('.viewport')
      .getAttribute('data-doc-id');
    if (!a || !b) throw new Error('no windows');
    const list = async (id: string) =>
      ((await cap(page, 'annotate', 'list', id)) as Listed[] | null) ?? [];
    const before = (await list(b)).length;
    await searchFor(page, 'Ø128.0');
    await pane(page)
      .getByRole('option', { name: /Ø120\.0 → Ø128\.0/ })
      .click();
    await pane(page).getByRole('button', { name: 'Make cloud comments' }).click();
    await page.getByRole('menuitem', { name: 'On the selected difference' }).click();
    await expect(page.getByTestId('diff-notice')).toHaveText(
      '1 cloud comment added to Document B.',
    );
    const after = await list(b);
    expect(after.length).toBe(before + 1);
    // A polygon (cloud) on B; nothing on A.
    expect(after.filter((x) => x.type === 7).length).toBeGreaterThanOrEqual(1);
    expect(await list(a)).toHaveLength(0);
  });

  test('pair 10: unchanged sheets, percent changed and sorting', async ({ page }) => {
    await overlayOf(page, '10');
    await detected(page, 4);
    const sheets = page.getByTestId('overlay-sheets').getByRole('option');
    await expect(sheets).toHaveCount(4);
    // Sheet 2 is the identical control page (manifest): unchanged, no false report.
    await expect(sheets.nth(1).getByTestId('sheet-diff')).toHaveText('Unchanged');
    for (const i of [0, 2, 3])
      await expect(sheets.nth(i).getByTestId('sheet-diff')).toHaveAttribute(
        'data-status',
        'changed',
      );
    // Most changed first: the control page last.
    await page.getByTestId('sheet-sort').check();
    await expect(sheets.last()).toContainText('Sheet 2');
    // This sheet only.
    await page.getByTestId('diff-scope').selectOption('sheet');
    await sheets.filter({ hasText: 'Sheet 2' }).click();
    await expect(count(page)).toHaveAttribute('data-count', '0');
    await expect(pane(page).getByText('No differences found.')).toBeVisible();
    // A difference picked on another sheet moves to it.
    await page.getByTestId('diff-scope').selectOption('all');
    await searchFor(page, 'EF-03');
    await pane(page).getByRole('option', { name: /EF-03/ }).click();
    await expect(page.locator('.overlay-sheet[aria-selected="true"]')).toContainText('Sheet 4');
    await expect(page.locator('.diff-outline[data-selected]')).toHaveCount(1);
  });

  test('axe: the differences pane in light and dark @a11y', async ({ page }) => {
    await overlayOf(page, '01');
    await detected(page, 1);
    const check = async (): Promise<void> => {
      const r = await new AxeBuilder({ page })
        .include('[data-testid="diff-pane"]')
        .include('[data-testid="ignore-zones"]')
        .include('[data-testid="overlay-sheets"]')
        .analyze();
      expect(r.violations).toEqual([]);
    };
    await check();
    await darkTheme(page);
    await overlayOf(page, '01');
    await detected(page, 1);
    await check();
  });
});
