import type { Page } from '@playwright/test';
import { cap } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// M1-22 / §12: 100 markups on a small file save (Ctrl+S: save, verify, write)
// in < 1 s with no main-thread long task. The markups come from the e2e probe
// before measuring starts.

const tab = (page: Page) =>
  page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab').first();

test('Ctrl+S with 100 markups: < 1 s, no long tasks', async ({ page, pdfs, guard }) => {
  await page.goto('/');
  const [id] = (await cap(page, 'open', 'openHandles', [
    { name: 'markups.pdf', b64: pdfs.simple(3).toString('base64') },
  ])) as string[];
  if (!id) throw new Error('not opened');
  expect(await cap(page, 'save', 'addSquares', id, 100)).toBeNull();
  await expect(tab(page)).toHaveAccessibleName(/unsaved changes/);
  await cap(page, 'view', 'settle', 300);

  await guard.startMeasuring();
  const t0 = await page.evaluate(() => performance.now());
  await page.keyboard.press('Control+S');
  await expect(tab(page)).toHaveAccessibleName('markups.pdf');
  const ms = Math.round((await page.evaluate(() => performance.now())) - t0);
  test.info().annotations.push({ type: 'save-100-markups-ms', description: String(ms) });
  expect(ms).toBeLessThan(1000);
});
