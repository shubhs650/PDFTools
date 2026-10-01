import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// M4-20 (rule 1): Import Comments of 1,000 comments from a 200-page PDF into
// the 2,000-page stand-in — the summary, the preview and the object copy run
// in the Work worker, the reopen in the Render worker; the main thread only
// sends options and receives counts. No main-thread task > 100 ms.

test('import 1,000 comments into the 2,000-page stand-in: no long tasks', async ({
  page,
  pdfs,
  guard,
}) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await drop(page, [{ name: 'contract.pdf', b64: pdfs.contract(2000).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  const source = pdfs.markedContract(200, 5).toString('base64');
  // The file is built in the page before measuring (decoding test data is not app work).
  await page.evaluate((data) => {
    const bin = atob(data);
    const file = new File([Uint8Array.from(bin, (c) => c.charCodeAt(0))], 'marked.pdf', {
      type: 'application/pdf',
    });
    const w = window as unknown as { showOpenFilePicker: () => Promise<unknown[]> };
    w.showOpenFilePicker = () =>
      Promise.resolve([{ kind: 'file', name: 'marked.pdf', getFile: () => Promise.resolve(file) }]);
  }, source);
  await cap(page, 'view', 'settle', 400);
  await guard.startMeasuring();
  const t0 = Date.now();
  await page.getByRole('tab', { name: 'Comment' }).click();
  await page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name: 'Import Comments' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Import Comments' });
  await dialog.getByRole('button', { name: 'Choose PDF or JSON…' }).click();
  await expect(dialog.getByRole('status')).toContainText('1,000 comments will be imported', {
    timeout: 60_000,
  });
  const previewMs = Date.now() - t0;
  const t1 = Date.now();
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect.poll(() => cap(page, 'pages', 'busy'), { timeout: 60_000 }).toBe(false);
  const appliedMs = Date.now() - t1;
  await expect
    .poll(async () => ((await cap(page, 'annotate', 'list', id)) as unknown[] | null)?.length, {
      timeout: 120_000,
    })
    .toBe(1000);
  await expect.poll(() => cap(page, 'pages', 'busy')).toBe(false);
  test
    .info()
    .annotations.push(
      { type: 'transfer-preview-ms', description: String(previewMs) },
      { type: 'transfer-applied-ms', description: String(appliedMs) },
      { type: 'transfer-import-1000-ms', description: String(Date.now() - t1) },
    );
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await cap(page, 'view', 'settle', 400);
});
