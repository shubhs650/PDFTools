import { drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';
import { savedFiles, stubSavePicker } from '../support/savePicker.ts';

// M2-11: listing 20 attachments and saving the 20 MB one (read in the Work
// worker, transferred once, written in chunks) never blocks the main thread.

test('attachments: list and save a 20 MB file, no long tasks', async ({ page, pdfs, guard }) => {
  await page.goto('/');
  await drop(page, [{ name: 'with-files.pdf', b64: pdfs.attachments().toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await stubSavePicker(page);
  await guard.startMeasuring();
  await page
    .getByRole('complementary', { name: 'Navigation panes' })
    .getByRole('button', { name: 'Attachments' })
    .click();
  const list = page.getByRole('list', { name: 'Embedded files' });
  await expect(list.getByRole('listitem')).toHaveCount(20);
  await list
    .getByRole('listitem')
    .filter({ has: page.getByText('big.bin', { exact: true }) })
    .getByRole('button', { name: 'Save…' })
    .click();
  await expect.poll(() => savedFiles(page)).toEqual([{ name: 'big.bin', bytes: 20 * 1024 * 1024 }]);
});
