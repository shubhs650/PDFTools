import { mkdirSync, writeFileSync } from 'node:fs';
import { tablesPdf } from '../fixtures/tables.ts';
import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// M4-14 (§7.7, rule 1): dragging dividers of a 60 × 20 grid in Review &
// Extract — the outline follows the pointer once per frame, the preview's text
// comes from the Work worker — with no main-thread task over 100 ms (the guard).
// Numbers → test-results/m4-tables-review.json.

test('Review & Extract: drag dividers on a 60 × 20 grid', async ({ page, guard }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto('/');
  await drop(page, [{ name: 'tables.pdf', b64: Buffer.from(tablesPdf()).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await page.getByRole('tab', { name: 'Convert' }).click();
  await page
    .getByRole('toolbar', { name: 'Convert commands' })
    .getByRole('button', { name: 'Review & Extract' })
    .click();
  const panel = page.getByRole('complementary', { name: 'Review & Extract (Beta)' });
  await expect(panel.getByRole('status')).toHaveText('2 tables found.', { timeout: 20_000 });
  // 20 columns × 60 rows over most of page 1 (landscape, 842 × 595).
  await cap(page, 'extract', 'reviewAdd', 0, [30, 20, 812, 575], 20, 60);
  await expect(
    panel.getByRole('button', { name: 'Page 1, table 1: 60 × 20', exact: true }),
  ).toBeVisible();
  const col = page.getByRole('separator', { name: 'Column divider 10 of 21' });
  const row = page.getByRole('separator', { name: 'Row divider 30 of 61' });
  await col.scrollIntoViewIfNeeded();
  await guard.startMeasuring();

  const t0 = Date.now();
  let moves = 0;
  // Grab each divider between two crossing ones (where it is on top).
  const mid = async (a: string, b: string, axis: 'x' | 'y') => {
    const [ba, bb] = await Promise.all(
      [a, b].map((name) => page.getByRole('separator', { name }).boundingBox()),
    );
    if (!ba || !bb) throw new Error('divider not laid out');
    return axis === 'x'
      ? (ba.x + ba.width / 2 + bb.x + bb.width / 2) / 2
      : (ba.y + ba.height / 2 + bb.y + bb.height / 2) / 2;
  };
  for (const [el, dx, dy, other] of [
    [col, 60, 0, () => mid('Row divider 10 of 61', 'Row divider 11 of 61', 'y')],
    [row, 0, 80, () => mid('Column divider 5 of 21', 'Column divider 6 of 21', 'x')],
  ] as const) {
    const before = Number(await el.getAttribute('aria-valuenow'));
    const b = await el.boundingBox();
    if (!b) throw new Error('divider not laid out');
    const x = dx ? b.x + b.width / 2 : await other();
    const y = dx ? await other() : b.y + b.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 60; i++) {
      await page.mouse.move(x + (dx * i) / 60, y + (dy * i) / 60);
      moves++;
    }
    await page.mouse.up();
    await expect(el).not.toHaveAttribute('aria-valuenow', String(before));
  }
  const ms = Date.now() - t0;
  // The preview shows the grid's cells (60 rows).
  await expect(panel.getByRole('grid').getByRole('row')).toHaveCount(60);

  const result = { moves, ms };
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/m4-tables-review.json', JSON.stringify(result, null, 2));
  test.info().annotations.push({ type: 'm4-tables-review', description: JSON.stringify(result) });
});
