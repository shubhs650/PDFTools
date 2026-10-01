import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';
import { stubSavePicker } from '../support/savePicker.ts';

// M4-08: 10,000 comments to CSV (built in pieces on the main thread with
// yields) and to XLSX (built in the Work worker), no long tasks.

for (const [format, ext] of [
  ['CSV (.csv)', 'csv'],
  ['Excel workbook (.xlsx)', 'xlsx'],
] as const) {
  test(`Export Annotations: 10,000 comments to ${ext}, no long tasks`, async ({
    page,
    pdfs,
    guard,
  }) => {
    test.setTimeout(240_000);
    await page.goto('/');
    await cap(page, 'annotate', 'setProfile', 'Perf');
    await drop(page, [
      { name: 'contract.pdf', b64: pdfs.markedContract(2000, 5).toString('base64') },
    ]);
    await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
    const id = (await cap(page, 'view', 'activeDocId')) as string;
    await expect
      .poll(
        async () => ((await cap(page, 'annotate', 'list', id)) as unknown[] | null)?.length ?? 0,
        { timeout: 120_000 },
      )
      .toBe(10_000);
    await stubSavePicker(page);
    await cap(page, 'view', 'settle', 400);
    await page.getByRole('tab', { name: 'Comment' }).click();
    await page
      .getByRole('toolbar', { name: 'Comment commands' })
      .getByRole('button', { name: 'Export Comments (CSV / XLSX / JSON)' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Export Annotations' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(format).check();
    await guard.startMeasuring();
    const t0 = Date.now();
    await dialog.getByRole('button', { name: 'Export' }).click();
    await expect(dialog).toBeHidden({ timeout: 180_000 });
    test.info().annotations.push({
      type: `annot-export-10000-${ext}-ms`,
      description: String(Date.now() - t0),
    });
    const f = (await cap(page, 'annotate', 'lastAnnotationExport')) as { name: string } | null;
    expect(f?.name).toBe(`contract (annotations).${ext}`);
  });
}
