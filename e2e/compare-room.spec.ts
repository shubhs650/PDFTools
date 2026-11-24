import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { darkTheme, drop } from './support/app.ts';
import { overlayOf, textOf } from './support/compare.ts';
import { expect, test } from './support/fixtures.ts';
import { simplePdf } from './fixtures/generate.ts';

// M12-25 (ADR-033, D-62): room to work. Comparison panes fold and resize, Maximise hides
// everything but the windows until Esc, the app's left pane closes on comparison tabs, the
// header buttons carry text, the floating bar has a colour key, the left pane's sections
// fold to one line, and the differences list uses plain words.

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
const result = (page: Page) => page.getByTestId('compare-result');
const leftPane = (page: Page) => page.getByTestId('left-pane');
const width = async (page: Page, testId: string): Promise<number> =>
  Math.round((await page.getByTestId(testId).boundingBox())?.width ?? 0);

test.describe('room to work', () => {
  test("the app's left pane closes on a comparison tab and comes back on a document", async ({
    page,
  }) => {
    await overlayOf(page, '01');
    // On the comparison tab the pane area is closed: the Thumbnails pane has nothing to show.
    await expect(leftPane(page)).toHaveCount(0);
    // A document of its own: the pane is back as it was.
    await drop(page, [{ name: 'notes.pdf', b64: Buffer.from(simplePdf(2)).toString('base64') }]);
    await expect(tabs(page)).toHaveCount(2);
    await expect(leftPane(page)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Thumbnails' })).toBeVisible();
    // Back to the comparison: closed again; the rail still opens it there.
    await tabs(page).first().click();
    await expect(result(page)).toBeVisible();
    await expect(leftPane(page)).toHaveCount(0);
    await page
      .getByRole('complementary', { name: 'Navigation panes' })
      .getByRole('button', { name: 'Bookmarks' })
      .click();
    await expect(leftPane(page)).toBeVisible();
  });

  test('panes fold to a strip and open again; a drag edge resizes them, per comparison @smoke', async ({
    page,
  }) => {
    await overlayOf(page, '01');
    const sheets = page.getByTestId('cmp-pane-sheets');
    const diffs = page.getByTestId('cmp-pane-diffs');
    const before = await width(page, 'overlay-view');

    // Fold the Sheets pane: only its strip stays and the windows get its room.
    await page.getByRole('button', { name: 'Fold the Sheets pane' }).click();
    await expect(sheets).toHaveAttribute('data-folded', 'true');
    await expect(page.getByTestId('overlay-sheets')).toHaveCount(0);
    expect(await width(page, 'cmp-pane-sheets')).toBeLessThan(16);
    await expect(page.getByTestId('overlay-view')).toHaveAttribute('data-complete', 'true');
    await expect.poll(() => width(page, 'overlay-view')).toBeGreaterThan(before);

    // The Differences pane too; its strip opens it again, with focus kept on the arrow.
    await page.getByRole('button', { name: 'Fold the Differences pane' }).click();
    await expect(diffs).toHaveAttribute('data-folded', 'true');
    await expect(page.getByTestId('diff-pane')).toHaveCount(0);
    const open = page.getByRole('button', { name: 'Open the Differences pane' });
    await expect(open).toHaveAttribute('aria-expanded', 'false');
    await open.click();
    await expect(page.getByTestId('diff-pane')).toBeVisible();

    // Resize from the keyboard: the splitter on the pane's inner edge (ArrowLeft widens a
    // right-hand pane), Home and End go to the narrowest and widest.
    const splitter = page.getByRole('separator', { name: 'Resize the Differences pane' });
    await expect(splitter).toHaveAttribute('aria-valuenow', '320');
    await splitter.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(splitter).toHaveAttribute('aria-valuenow', '336');
    await page.keyboard.press('End');
    await expect(splitter).toHaveAttribute('aria-valuenow', '480');
    expect(await width(page, 'diff-pane')).toBe(480);
    // And with the pointer: dragging the edge right narrows it.
    const box = await splitter.boundingBox();
    if (!box) throw new Error('no splitter');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 3, { steps: 5 });
    await page.mouse.up();
    await expect(splitter).toHaveAttribute('aria-valuenow', '380');

    // Kept while away from the tab.
    await drop(page, [{ name: 'notes.pdf', b64: Buffer.from(simplePdf(1)).toString('base64') }]);
    await expect(tabs(page)).toHaveCount(2);
    await tabs(page).first().click();
    await expect(sheets).toHaveAttribute('data-folded', 'true');
    await expect(
      page.getByRole('separator', { name: 'Resize the Differences pane' }),
    ).toHaveAttribute('aria-valuenow', '380');
  });

  test('Maximise hides the ribbon, the tabs, the panes and the status bar until Esc @smoke', async ({
    page,
  }) => {
    await overlayOf(page, '01');
    const max = result(page).getByRole('button', { name: 'Maximise', exact: true });
    await max.click();
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-maximised', 'true');
    await expect(max).toHaveAttribute('aria-pressed', 'true');
    for (const name of ['Navigation panes', 'Properties pane'])
      await expect(page.getByRole('complementary', { name, exact: true })).toBeHidden();
    await expect(page.getByRole('banner')).toBeHidden();
    await expect(page.getByRole('contentinfo', { name: 'Status bar' })).toBeHidden();
    await expect(page.getByTestId('cmp-pane-sheets')).toHaveCount(0);
    await expect(page.getByTestId('diff-pane')).toHaveCount(0);
    // The windows and the floating bar stay, and the overlay is drawn again for its room.
    await expect(page.getByRole('toolbar', { name: 'Overlay controls' })).toBeVisible();
    await expect(page.getByTestId('overlay-view')).toHaveAttribute('data-complete', 'true');

    // Esc in a dialog closes the dialog only.
    await page.getByRole('button', { name: 'Colours' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await page.waitForTimeout(100);
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-maximised', 'true');
    // Esc brings everything back.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('app-shell')).not.toHaveAttribute('data-maximised', 'true');
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByTestId('diff-pane')).toBeVisible();
    // The button does too.
    await max.click();
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-maximised', 'true');
    await max.click();
    await expect(page.getByTestId('app-shell')).not.toHaveAttribute('data-maximised', 'true');
  });

  test('header buttons say what they do; icons only on a narrow window', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 800 });
    await overlayOf(page, '01');
    const head = result(page).locator('header');
    for (const name of ['Side by side', 'Overlay only', 'Link views', 'Differences', 'Close-out'])
      await expect(head.getByRole('button', { name, exact: true }).getByText(name)).toBeVisible();
    // With the app's left pane open the header is narrower: icons only, the names stay.
    await page
      .getByRole('complementary', { name: 'Navigation panes' })
      .getByRole('button', { name: 'Thumbnails' })
      .click();
    await expect(leftPane(page)).toBeVisible();
    const label = head
      .getByRole('button', { name: 'Side by side', exact: true })
      .getByText('Side by side');
    await expect.poll(async () => (await label.boundingBox())?.width ?? 0).toBeLessThan(2);
    await expect(head.getByRole('button', { name: 'Close-out', exact: true })).toBeVisible();
  });

  test('the floating bar has a colour key that follows the colours chosen', async ({ page }) => {
    await overlayOf(page, '01');
    const key = page.getByTestId('overlay-key');
    await expect(key).toHaveText(/Red: only in old.*Green: only in new.*Black: same/);
    await page.getByRole('button', { name: 'Colours' }).click();
    await page.getByRole('menuitemradio', { name: 'Red and blue' }).click();
    await expect(key).toHaveText(/Red: only in old.*Blue: only in new.*Black: same/);
    await page.getByRole('button', { name: 'Fade unchanged' }).click();
    await expect(key).toContainText('Grey: same');
  });

  test('left-pane sections fold to one line; plain words and Filters in the differences', async ({
    page,
  }) => {
    await overlayOf(page, '01');
    const align = page.getByTestId('fold-align');
    await expect(align).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('fold-summary-align')).toHaveText(/lined up|As is|aligned/i);
    await expect(page.getByTestId('fold-summary-zones')).toHaveText('No ignore zones.');
    await expect(page.getByTestId('fold-summary-comments')).toHaveText(
      'Comments of both documents shown',
    );
    await align.click();
    await expect(align).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('align-panel').getByRole('button').nth(1)).toBeVisible();
    // Sheets never folds.
    await expect(page.getByTestId('overlay-sheets')).toBeVisible();

    // Differences: Drawing, not Geometry; Sensitivity and Minimum size under Filters.
    const pane = page.getByTestId('diff-pane');
    await expect(pane.getByText('Drawing', { exact: true })).toBeVisible();
    await expect(pane.getByText(/Geometry/)).toHaveCount(0);
    await expect(page.getByTestId('diff-sensitivity')).toHaveCount(0);
    await expect(page.getByTestId('diff-filters-summary')).toHaveText('Normal · Any size');
    await page.getByTestId('diff-filters').click();
    await expect(page.getByTestId('diff-sensitivity')).toBeVisible();
    await expect(page.getByTestId('diff-min-size')).toBeVisible();
  });

  test('text comparison: the Changes pane folds and Maximise leaves the two windows', async ({
    page,
  }) => {
    await textOf(page, '01');
    await expect(
      result(page).getByRole('button', { name: 'Link views', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Fold the Changes pane' }).click();
    await expect(page.getByTestId('cmp-pane-changes')).toHaveAttribute('data-folded', 'true');
    await page.getByRole('button', { name: 'Open the Changes pane' }).click();
    await expect(page.locator('.text-side')).toBeVisible();
    await result(page).getByRole('button', { name: 'Maximise', exact: true }).click();
    await expect(page.locator('.text-side')).toHaveCount(0);
    await expect(page.getByTestId('text-view-a')).toBeVisible();
    await expect(page.getByTestId('text-view-b')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.text-side')).toBeVisible();
  });

  for (const dark of [false, true])
    test(`folded, open and maximised states pass axe (${dark ? 'dark' : 'light'}) @a11y`, async ({
      page,
    }) => {
      if (dark) await darkTheme(page);
      await overlayOf(page, '01');
      const axe = async (): Promise<void> => {
        const r = await new AxeBuilder({ page })
          .include('[data-testid="compare-result"]')
          .analyze();
        expect(r.violations).toEqual([]);
      };
      await axe();
      await page.getByTestId('fold-align').click();
      await page.getByTestId('diff-filters').click();
      await page.getByRole('button', { name: 'Fold the Sheets pane' }).click();
      await axe();
      await result(page).getByRole('button', { name: 'Maximise', exact: true }).click();
      await axe();
    });
});
