import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { corpusFile, dropOn, overlayDrawn } from '../support/compare.ts';
import { expect, test } from '../support/fixtures.ts';

// M12-23 (D-66, ADR-032 "The acceptance numbers"): the time limits of a PDF
// overlay, measured in the app from Compare to what the user sees:
// - first result: the first sheet aligned and drawn within 3 s;
// - a typical sheet (A1, CAD-like) aligned and its differences listed within
//   2 s (the time until every sheet is listed, divided by the sheets);
// - the dense A1 pair (14, 85,000 segments) is measured and reported.
// No main-thread task over 100 ms throughout (perf guard). The 500-page text
// contract's numbers come from perf/compare-text.spec.ts. scripts/acceptance.ts
// reads the `m12-overlay-acceptance` annotation.

const PAIRS = [
  { id: '18', what: 'A1 sheet, title block changed' },
  { id: '17', what: 'set of six A3 sheets, one removed, two swapped' },
  { id: '10', what: 'four sheets on A4, A3 and 11x17' },
  { id: '14', what: 'dense A1 plot plan (reported)' },
] as const;

interface PairTimes {
  sheets: number;
  firstSheetMs: number;
  allListedMs: number;
  perSheetMs: number;
}

const now = (page: Page): Promise<number> => page.evaluate(() => performance.now());

test('PDF overlay time limits: first sheet < 3 s, typical sheet < 2 s; dense A1 reported', async ({
  page,
  guard,
}) => {
  test.setTimeout(300_000);
  const out: Record<string, PairTimes> = {};
  // One page load: each pair opens in its own comparison tab, so the guard
  // sees every pair's main-thread tasks.
  await page.goto('/');
  let measuring = false;
  for (const { id } of PAIRS) {
    await page.getByRole('tab', { name: 'Compare', exact: true }).click();
    await page.getByRole('button', { name: 'PDF Overlay' }).click();
    const input = page.locator('[data-testid="compare-input"]:visible');
    await dropOn(input.getByTestId('compare-side-a'), [
      corpusFile(id, 'old', `Pair ${id} RevA.pdf`),
    ]);
    await expect(input.getByTestId('compare-side-a').getByTestId('compare-file')).toHaveCount(1);
    await dropOn(input.getByTestId('compare-side-b'), [
      corpusFile(id, 'new', `Pair ${id} RevB.pdf`),
    ]);
    await expect(input.getByTestId('compare-pairing')).toHaveAttribute('data-status', 'done', {
      timeout: 60_000,
    });
    if (!measuring) {
      await guard.startMeasuring();
      measuring = true;
    }
    const t0 = await now(page);
    await input.getByRole('button', { name: 'Compare', exact: true }).click();
    await overlayDrawn(page);
    const firstSheetMs = Math.round((await now(page)) - t0);
    // Every paired sheet listed: its differences counted (changed or unchanged).
    const paired = page.locator('.overlay-sheet[data-kind="pair"]:visible');
    const sheets = await paired.count();
    expect(sheets).toBeGreaterThan(0);
    await expect(
      paired.locator('[data-testid="sheet-diff"]:not([data-status="pending"])'),
    ).toHaveCount(sheets, { timeout: 120_000 });
    const allListedMs = Math.round((await now(page)) - t0);
    out[id] = { sheets, firstSheetMs, allListedMs, perSheetMs: Math.round(allListedMs / sheets) };
  }
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/m12-overlay-acceptance.json', JSON.stringify(out, null, 2));
  test
    .info()
    .annotations.push({ type: 'm12-overlay-acceptance', description: JSON.stringify(out) });
});
