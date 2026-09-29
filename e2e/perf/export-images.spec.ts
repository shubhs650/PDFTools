import { mkdirSync, writeFileSync } from 'node:fs';
import { imageHeavyPdf } from '../fixtures/extraction.ts';
import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';
import { stubFolderPicker, folderFiles } from '../support/savePicker.ts';

// M4-06 (rules 1 and 2): Export Images on a self-made 200-page file with two
// images per page and a logo on every page — decoding, PNG encoding and
// de-duplication in the Work worker, the files written from the main thread.
// The guard fails any main-thread task over 100 ms. Numbers → test-results/m4-images.json.

test('200 pages, 401 distinct images: exported without a long task', async ({ page, guard }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await drop(page, [
    { name: 'photos.pdf', b64: Buffer.from(imageHeavyPdf(200)).toString('base64') },
  ]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  const docId = ((await cap(page, 'open', 'state')) as { activeId: string }).activeId;
  await stubFolderPicker(page);
  await guard.startMeasuring();
  const t0 = Date.now();
  await cap(page, 'extract', 'openDialog', docId, 'images');
  const dialog = page.getByRole('dialog', { name: 'Export Images' });
  await dialog.getByRole('button', { name: 'Export' }).click();
  await expect(dialog).toBeHidden({ timeout: 120_000 });
  const ms = Date.now() - t0;
  const files = await folderFiles(page);
  mkdirSync('test-results', { recursive: true });
  writeFileSync(
    'test-results/m4-images.json',
    JSON.stringify({ ms, files: files.length }, null, 2),
  );
  test.info().annotations.push({ type: 'm4-images', description: JSON.stringify({ ms }) });
  expect(files).toHaveLength(401);
});
