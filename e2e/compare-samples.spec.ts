import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { darkTheme } from './support/app.ts';
import { compareSide, overlayDrawn } from './support/compare.ts';
import { expect, test } from './support/fixtures.ts';
import { savedFiles, stubSavePicker } from './support/savePicker.ts';
import { skipReviewerPrompt } from './support/shots.ts';

// M13-01 (D-67, ADR-034): sample comparisons. Under the two drop boxes of the
// input window, "No files to hand? Try a sample" offers that type's two samples
// (corpus pairs shipped with the app, served from our origin). One click fills
// Document A and B with a Sample tag and a line saying what to look for; the
// person presses Compare as usual, and the result matches the corpus manifest.
// A sample has no file handle, so Save review saves it with Save As.

const input = (page: Page) => page.getByTestId('compare-input');
const look = (page: Page) => page.getByTestId('compare-sample-look');

async function startCompare(page: Page, type: 'PDF Overlay' | 'Text Comparison'): Promise<void> {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Compare', exact: true }).click();
  await page.getByRole('button', { name: type }).click();
  await expect(input(page)).toBeVisible();
}

/** Try a sample → the sample called `title`; waits for both sides to hold their file. */
async function trySample(page: Page, title: string): Promise<void> {
  await expect(input(page).getByTestId('compare-sample')).toContainText('No files to hand?');
  await input(page).getByRole('button', { name: 'Try a sample' }).click();
  await page.getByRole('menuitem', { name: title }).click();
  for (const s of ['a', 'b'] as const)
    await expect(compareSide(page, s).getByTestId('compare-file')).toHaveCount(1);
}

async function sideHolds(page: Page, side: 'a' | 'b', name: string): Promise<void> {
  const file = compareSide(page, side).getByTestId('compare-file');
  await expect(file.locator('.compare-file-name')).toHaveText(name);
  await expect(file.locator('.compare-file-tag')).toHaveText('Sample');
  // Page pictures, as for any file.
  await expect(file.locator('.compare-thumb img').first()).toBeVisible();
}

async function compare(page: Page): Promise<void> {
  await input(page).getByRole('button', { name: 'Compare', exact: true }).click();
}

test.describe('sample comparisons', () => {
  test('the PDF Overlay menu offers its two samples, each with a line saying what it shows', async ({
    page,
  }) => {
    await startCompare(page, 'PDF Overlay');
    await expect(look(page)).toHaveCount(0);
    await input(page).getByRole('button', { name: 'Try a sample' }).click();
    const items = page.getByRole('menuitem');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toHaveAccessibleName('Flange drawing, Rev A → Rev B');
    await expect(items.nth(0)).toHaveAccessibleDescription(/bigger bolt circle/);
    await expect(items.nth(1)).toHaveAccessibleName('Checked print with review comments');
    await page.keyboard.press('Escape');
    // The text comparison's menu has its own two.
    await input(page).getByRole('radio', { name: 'Text Comparison' }).check();
    await input(page).getByRole('button', { name: 'Try a sample' }).click();
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toHaveAccessibleName('EPC tender, 6 pages');
    await expect(items.nth(1)).toHaveAccessibleName('Commercial invoice, 1 page');
  });

  test('flange drawing (overlay pair 01): the bolt circle Ø120 → Ø128 is found @smoke', async ({
    page,
  }) => {
    await startCompare(page, 'PDF Overlay');
    await trySample(page, 'Flange drawing, Rev A → Rev B');
    await sideHolds(page, 'a', 'Flange drawing Rev A.pdf');
    await sideHolds(page, 'b', 'Flange drawing Rev B.pdf');
    await expect(look(page)).toContainText('What to look for: The bolt circle Ø120 → Ø128');
    await expect(page.getByTestId('compare-pairing')).toHaveAttribute('data-status', 'done', {
      timeout: 30_000,
    });
    await compare(page);
    await overlayDrawn(page);
    const diff = page.getByTestId('diff-pane');
    await expect(page.getByTestId('diff-count')).toHaveAttribute('data-detected', '1', {
      timeout: 60_000,
    });
    // The manifest: bolt circle Ø120 → Ø128 (found as text), among the other changes.
    await expect(diff.getByRole('option', { name: /Ø120\.0 → Ø128\.0/ })).toHaveCount(1);
    expect(Number(await page.getByTestId('diff-count').getAttribute('data-count'))).toBeGreaterThan(
      3,
    );
  });

  test('checked print (overlay pair 19): the checker’s comments are there to close out; Save review saves with Save As', async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize({ width: 1600, height: 1000 });
    await startCompare(page, 'PDF Overlay');
    await skipReviewerPrompt(page);
    await trySample(page, 'Checked print with review comments');
    await sideHolds(page, 'a', 'Checked print Rev A.pdf');
    await sideHolds(page, 'b', 'Checked print Rev B.pdf');
    await expect(look(page)).toContainText('open Close-out');
    await expect(page.getByTestId('compare-pairing')).toHaveAttribute('data-status', 'done', {
      timeout: 30_000,
    });
    await compare(page);
    await overlayDrawn(page);
    // The manifest: four checker comments (C1 a cloud with its callout), all open.
    await page.getByRole('button', { name: 'Close-out', exact: true }).click();
    const pane = page.getByTestId('closeout-pane');
    await expect(pane.locator('.closeout-row')).toHaveCount(5);
    await expect(pane.getByTestId('closeout-counts')).toHaveText('5 open, 0 closed');

    // Close one out: Document A changes. It has no file handle, so Save review asks where.
    await pane.locator('.closeout-row[data-id="C1-cloud"]').click();
    await page
      .getByTestId('closeout-actions')
      .getByRole('button', { name: 'Close Out As…', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Addressed', exact: true }).click();
    await expect(pane.getByTestId('closeout-counts')).toHaveText('4 open, 1 closed');
    await stubSavePicker(page);
    await page.keyboard.press('Control+s');
    await expect
      .poll(async () => (await savedFiles(page)).map((f) => f.name))
      .toEqual(['Checked print Rev A.pdf']);
    expect((await savedFiles(page))[0]?.bytes).toBeGreaterThan(11_000);
  });

  test('EPC tender (text pair 05): inserted clauses, renumbering, the cap and the missing “not” @smoke', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await startCompare(page, 'Text Comparison');
    await trySample(page, 'EPC tender, 6 pages');
    await sideHolds(page, 'a', 'EPC tender Rev A.pdf');
    await sideHolds(page, 'b', 'EPC tender Rev B.pdf');
    await expect(look(page)).toContainText('the damages cap 5 % → 10 %');
    await compare(page);
    await expect(page.getByTestId('compare-result')).toHaveAttribute('data-status', 'done', {
      timeout: 60_000,
    });
    const rows = page.getByTestId('text-list-rows');
    const entry = (name: RegExp) => rows.getByRole('option', { name }).first();
    await expect(page.getByTestId('text-list-count')).toHaveAttribute('data-count', '7');
    await expect(entry(/^Inserted, B page 3, → Clause 3\.4: ESG/)).toBeVisible();
    await expect(entry(/^Clauses renumbered, .*3\.4–3\.9, → 3\.6–3\.11/)).toBeVisible();
    await expect(entry(/^Replaced, A page 4 · B page 4, \+100 %, 5%, → 10%/)).toBeVisible();
    await expect(entry(/^Deleted, A page 5, not$/)).toBeVisible();
  });

  test('commercial invoice (text pair 01): quantity, price, the added item, tax and totals', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await startCompare(page, 'Text Comparison');
    await trySample(page, 'Commercial invoice, 1 page');
    await sideHolds(page, 'a', 'Commercial invoice Rev A.pdf');
    await sideHolds(page, 'b', 'Commercial invoice Rev B.pdf');
    await expect(look(page)).toContainText('an added line item');
    await compare(page);
    await expect(page.getByTestId('compare-result')).toHaveAttribute('data-status', 'done', {
      timeout: 60_000,
    });
    const rows = page.getByTestId('text-list-rows');
    const entry = (name: RegExp) => rows.getByRole('option', { name }).first();
    // The manifest: item 3 qty 12 → 15 and price 1,450 → 1,520, item 5 added,
    // GST 18 % → 12 %, PO R1 → R2, Net 30 → Net 45, totals recalculated.
    await expect(entry(/\+25 %, Row 3 .*column Qty, 12, → 15$/)).toBeVisible();
    await expect(
      entry(/\+4\.8 %, Row 3 .*column Unit Price.*1,450\.00, → 1,520\.00$/),
    ).toBeVisible();
    await expect(entry(/^Inserted, B page 1, Row 5 · On-Site Commissioning/)).toBeVisible();
    await expect(entry(/GST \/ VAT \(18%\):, → GST \/ VAT \(12%\):$/)).toBeVisible();
    await expect(entry(/PO-88412-R1, → PO-88412-R2$/)).toBeVisible();
    await expect(entry(/\+50 %, 30, → 45$/)).toBeVisible();
    await expect(entry(/Row TOTAL DUE \(USD\):.*52,085\.20, → 59,068\.80$/)).toBeVisible();
  });

  test('a sample replaces what was on the sides; changing a side ends the hint', async ({
    page,
  }) => {
    await startCompare(page, 'Text Comparison');
    await trySample(page, 'Commercial invoice, 1 page');
    await expect(look(page)).toBeVisible();
    await trySample(page, 'EPC tender, 6 pages');
    await sideHolds(page, 'a', 'EPC tender Rev A.pdf');
    await expect(look(page)).toContainText('damages cap');
    // Swapped: no longer the sample as shipped.
    await input(page).getByRole('button', { name: 'Swap Document A and Document B' }).click();
    await expect(look(page)).toHaveCount(0);
    await expect(compareSide(page, 'a').locator('.compare-file-name')).toHaveText(
      'EPC tender Rev B.pdf',
    );
  });

  test('the start screen offers “Try comparing two revisions”: Compare opens with the flange sample filled in (O5) @smoke', async ({
    page,
  }) => {
    await page.goto('/');
    const action = page
      .getByTestId('start-screen')
      .getByRole('list', { name: 'Quick actions' })
      .getByRole('button', { name: 'Try comparing two revisions' });
    await expect(action).toHaveAccessibleDescription('A sample drawing, ready in Compare');
    // Keyboard reachable, as every quick action.
    await action.focus();
    await page.keyboard.press('Enter');
    await expect(input(page)).toBeVisible();
    await expect(page.getByTestId('start-screen')).toHaveCount(0);
    await expect(input(page).getByRole('radio', { name: 'PDF Overlay' })).toBeChecked();
    for (const s of ['a', 'b'] as const)
      await expect(compareSide(page, s).getByTestId('compare-file')).toHaveCount(1);
    await sideHolds(page, 'a', 'Flange drawing Rev A.pdf');
    await sideHolds(page, 'b', 'Flange drawing Rev B.pdf');
    await expect(look(page)).toContainText('What to look for: The bolt circle Ø120 → Ø128');
    // The person presses Compare as usual: nothing is compared yet.
    await expect(input(page).getByRole('button', { name: 'Compare', exact: true })).toBeVisible();
  });

  for (const dark of [false, true])
    test(`the input window with a sample passes axe (${dark ? 'dark' : 'light'}) and is keyboard reachable @a11y`, async ({
      page,
    }) => {
      if (dark) await darkTheme(page);
      await startCompare(page, 'PDF Overlay');
      const axe = async (): Promise<void> => {
        const r = await new AxeBuilder({ page }).include('[data-testid="compare-input"]').analyze();
        expect(r.violations).toEqual([]);
      };
      await axe();
      // Keyboard: the button opens the menu, arrows and Enter pick a sample.
      const button = input(page).getByRole('button', { name: 'Try a sample' });
      await button.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('menuitem').first()).toBeFocused();
      const menu = await new AxeBuilder({ page }).include('[role="menu"]').analyze();
      expect(menu.violations).toEqual([]);
      await page.keyboard.press('Enter');
      for (const s of ['a', 'b'] as const)
        await expect(compareSide(page, s).getByTestId('compare-file')).toHaveCount(1);
      await expect(look(page)).toBeVisible();
      await axe();
    });
});
