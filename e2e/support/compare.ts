// Shared steps of the comparison e2e tests (M12-11, M12-12): open a PDF
// overlay of a corpus pair and wait until its overlay is drawn.
import type { Locator, Page } from '@playwright/test';
import { corpusBytes, corpusPair } from '../fixtures/comparison-corpus/index.ts';
import type { DropFile } from './app.ts';
import { expect } from './fixtures.ts';

export const compareSide = (page: Page, s: 'a' | 'b') => page.getByTestId(`compare-side-${s}`);
export const overlayView = (page: Page) => page.getByTestId('overlay-view');
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

export const corpusFile = (id: string, s: 'old' | 'new', name: string): DropFile => ({
  name,
  b64: b64(corpusBytes(corpusPair('overlay', id), s)),
});

export async function dropOn(target: Locator, files: DropFile[]): Promise<void> {
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
export async function overlayOf(page: Page, id: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Compare', exact: true }).click();
  await page.getByRole('button', { name: 'PDF Overlay' }).click();
  await dropOn(compareSide(page, 'a'), [corpusFile(id, 'old', `Pair ${id} RevA.pdf`)]);
  await expect(compareSide(page, 'a').getByTestId('compare-file')).toHaveCount(1);
  await dropOn(compareSide(page, 'b'), [corpusFile(id, 'new', `Pair ${id} RevB.pdf`)]);
  await expect(page.getByTestId('compare-pairing')).toHaveAttribute('data-status', 'done', {
    timeout: 30_000,
  });
  await page
    .getByTestId('compare-input')
    .getByRole('button', { name: 'Compare', exact: true })
    .click();
  await overlayDrawn(page);
}

/**
 * A PDF overlay whose one sheet needs checking (M12-26): two different
 * drawings (pair 01's old flange against pair 18's new framing plan) paired by
 * hand, so the automatic alignment finds nothing it can trust ("Check
 * alignment"). Waits for the sheet's status.
 */
export async function uncertainOverlay(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Compare', exact: true }).click();
  await page.getByRole('button', { name: 'PDF Overlay' }).click();
  await dropOn(compareSide(page, 'a'), [corpusFile('01', 'old', 'Flange RevA.pdf')]);
  await expect(compareSide(page, 'a').getByTestId('compare-file')).toHaveCount(1);
  await dropOn(compareSide(page, 'b'), [corpusFile('18', 'new', 'Framing RevD.pdf')]);
  const table = page.getByTestId('compare-pairing');
  await expect(table).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
  await table
    .getByRole('combobox', { name: 'Document B (new) page of sheet 1' })
    .selectOption({ label: 'Page 1' });
  await page
    .getByTestId('compare-input')
    .getByRole('button', { name: 'Compare', exact: true })
    .click();
  await expect(
    page.locator('.overlay-sheet[aria-selected="true"] .overlay-sheet-align'),
  ).toHaveAttribute('data-status', 'low', { timeout: 30_000 });
}

/**
 * Hides the differences pane (M12-14), for tests that measure the overlay at
 * the width it had before the pane, and waits for the drawing again.
 */
export async function hideDifferences(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Differences', exact: true }).click();
  await expect(page.getByTestId('diff-pane')).toHaveCount(0);
  await overlayDrawn(page);
}

/**
 * Opens a folded section of the overlay's left pane (M12-25): align, area, comments,
 * layers or zones.
 */
export async function unfold(
  page: Page,
  section: 'align' | 'area' | 'comments' | 'layers' | 'zones',
): Promise<void> {
  const button = page.getByTestId(`fold-${section}`);
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
}

/** Opens the Differences pane's Filters (Sensitivity, Minimum size; M12-25). */
export async function openFilters(page: Page): Promise<void> {
  const button = page.getByTestId('diff-filters');
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  await expect(page.getByTestId('diff-sensitivity')).toBeVisible();
}

/**
 * Waits until the sheet shown is aligned (its overlay is then drawn through the
 * alignment, M12-10) and every visible tile of the current state is on screen.
 */
export async function overlayDrawn(page: Page): Promise<void> {
  await expect(
    page.locator('.overlay-sheet[aria-selected="true"] .overlay-sheet-align'),
  ).toBeVisible({ timeout: 30_000 });
  await expect(overlayView(page)).toHaveAttribute('data-complete', 'true', { timeout: 30_000 });
}

export const textFile = (id: string, s: 'old' | 'new', name: string): DropFile => ({
  name,
  b64: b64(corpusBytes(corpusPair('text', id), s)),
});

/** Opens a text comparison of text corpus pair `id` and waits until it is complete (M12-19). */
export async function textOf(page: Page, id: string, timeout = 60_000): Promise<void> {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Compare', exact: true }).click();
  await page.getByRole('button', { name: 'Text Comparison' }).click();
  await dropOn(compareSide(page, 'a'), [textFile(id, 'old', `Pair ${id} RevA.pdf`)]);
  await expect(compareSide(page, 'a').getByTestId('compare-file')).toHaveCount(1);
  await dropOn(compareSide(page, 'b'), [textFile(id, 'new', `Pair ${id} RevB.pdf`)]);
  await expect(compareSide(page, 'b').getByTestId('compare-file')).toHaveCount(1);
  await page
    .getByTestId('compare-input')
    .getByRole('button', { name: 'Compare', exact: true })
    .click();
  await expect(page.getByTestId('compare-result')).toHaveAttribute('data-status', 'done', {
    timeout,
  });
  // Both windows laid out, with the list filled.
  await expect(page.getByTestId('text-view-a').locator('.page').first()).toBeVisible();
  await expect(page.getByTestId('text-view-b').locator('.page').first()).toBeVisible();
}

/**
 * Lets this test see Compare's first-time tips (M12-26): the device starts as
 * if it never saw them (the guard fixture marks them seen otherwise). Call
 * before `page.goto`; a reload keeps what the app recorded.
 */
export async function showCompareTips(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('e2e.compareTips')) return;
    sessionStorage.setItem('e2e.compareTips', '1');
    localStorage.removeItem('pdftools.compareTipsSeen');
  });
}
