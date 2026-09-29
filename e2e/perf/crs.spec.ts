import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';
import { stubSavePicker } from '../support/savePicker.ts';

// M3-19 (ADR-015): a 1,000-comment CRS with snapshots, built in the Work
// worker with progress shown; the main thread only gets the file's bytes.

test('CRS: 1,000 comments with snapshots on the contract stand-in, no long tasks', async ({
  page,
  pdfs,
  guard,
}) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Perf');
  await drop(page, [{ name: 'contract.pdf', b64: pdfs.markedContract(200, 5).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect
    .poll(
      async () => ((await cap(page, 'annotate', 'list', id)) as unknown[] | null)?.length ?? 0,
      {
        timeout: 30_000,
      },
    )
    .toBe(1000);
  await stubSavePicker(page);
  await cap(page, 'view', 'settle', 400);
  await page.getByRole('tab', { name: 'Comment' }).click();
  await page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name: 'Export CRS' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Export Comment Review Sheet' });
  await expect(dialog).toBeVisible();
  await guard.startMeasuring();
  const t0 = Date.now();
  await dialog.getByRole('button', { name: 'Export' }).click();
  await expect(dialog.getByRole('status')).toHaveText(/Row [\d,]+ of 1,000/, { timeout: 20_000 });
  await expect(dialog).toBeHidden({ timeout: 120_000 });
  test.info().annotations.push({ type: 'crs-1000-ms', description: String(Date.now() - t0) });
  const f = (await cap(page, 'annotate', 'lastCrs')) as { name: string; b64: string } | null;
  expect(f?.name).toBe('contract (CRS).xlsx');
});
