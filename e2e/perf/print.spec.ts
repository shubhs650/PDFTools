import { drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';
import { printCalls, stubFramePrint } from '../support/printStub.ts';
import { savedFiles, stubSavePicker } from '../support/savePicker.ts';

// M2-15: a 50-page print job (renders in the Work worker, PNG encoding in the
// encoder worker, a hidden frame of band images) has no main-thread long task
// up to the print() call (the native dialog itself is exempt, ADR-001 B4).

test('print: 50 pages at standard quality up to print(), no long tasks', async ({
  page,
  pdfs,
  guard,
}, testInfo) => {
  await stubFramePrint(page);
  await page.goto('/');
  await drop(page, [{ name: 'fifty.pdf', b64: pdfs.contract(50).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await guard.startMeasuring();
  const t0 = Date.now();
  await page.keyboard.press('Control+P');
  const dialog = page.getByRole('dialog', { name: 'Print' });
  await expect(dialog.getByTestId('print-count')).toHaveText('50 pages will print.');
  await dialog.getByRole('button', { name: 'Print', exact: true }).click();
  await expect.poll(() => printCalls(page), { timeout: 60_000 }).toBe(1);
  testInfo.annotations.push({ type: 'm2-print-50-ms', description: String(Date.now() - t0) });
});

// M2-16: Export Print-Ready PDF of 50 pages (flatten a Work-worker copy, full
// rewrite, prune) with no main-thread long task up to the saved file.
test('export print-ready: 50 pages, no long tasks', async ({ page, pdfs, guard }, testInfo) => {
  await page.goto('/');
  await drop(page, [{ name: 'fifty.pdf', b64: pdfs.contract(50).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await stubSavePicker(page);
  await guard.startMeasuring();
  const t0 = Date.now();
  await page.getByTestId('file-tab').click();
  const backstage = page.getByTestId('backstage');
  await backstage.getByRole('button', { name: 'Export Print-Ready PDF' }).first().click();
  await backstage
    .getByRole('region')
    .getByRole('button', { name: 'Export Print-Ready PDF' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Export Print-Ready PDF' });
  await dialog.getByRole('button', { name: 'Export…' }).click();
  await expect.poll(() => savedFiles(page), { timeout: 60_000 }).toHaveLength(1);
  testInfo.annotations.push({ type: 'm2-export-50-ms', description: String(Date.now() - t0) });
});
