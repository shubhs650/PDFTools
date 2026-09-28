import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// M3-14: placing 50 dynamic stamps (each drawn in the encoder worker, written
// by PDFium in the Render worker) leaves the main thread free (rule 1).

test('placing 50 dynamic stamps: no long tasks', async ({ page, pdfs, guard }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Perf');
  await drop(page, [{ name: 'contract.pdf', b64: pdfs.contract(20).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await page.getByRole('tab', { name: 'Comment' }).click();
  await page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name: 'Stamp', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Stamp' })
    .getByRole('button', { name: 'Place stamp' })
    .click();
  await cap(page, 'view', 'settle', 400);
  await guard.startMeasuring();
  await page.getByTestId('document-view').focus();
  for (let i = 0; i < 50; i++) await page.keyboard.press('Enter');
  await expect
    .poll(async () => ((await cap(page, 'annotate', 'list', id)) as unknown[] | null)?.length, {
      timeout: 60_000,
    })
    .toBe(50);
  await cap(page, 'view', 'settle', 400);
});
