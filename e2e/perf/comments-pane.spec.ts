import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// M3-11: the Comments pane on the 2,000-page stand-in with 10,000 markups —
// first rows in < 1 s once the comments are loaded, no long task while it
// opens, scrolls and filters (rule 1, the list is virtualized).

test('comments pane: 10,000 comments, first rows < 1 s, no long tasks', async ({
  page,
  pdfs,
  guard,
}) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await drop(page, [{ name: 'marked.pdf', b64: pdfs.markedContract(2000, 5).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect
    .poll(
      async () => ((await cap(page, 'annotate', 'list', id)) as unknown[] | null)?.length ?? 0,
      { timeout: 30_000 },
    )
    .toBe(10_000);
  await cap(page, 'view', 'settle', 400);
  await guard.startMeasuring();
  const t0 = await page.evaluate(() => performance.now());
  await page
    .getByRole('complementary', { name: 'Navigation panes' })
    .getByRole('button', { name: 'Comments' })
    .click();
  await page.getByTestId('comments-list').getByRole('option').first().waitFor();
  const firstRowsMs = Math.round((await page.evaluate(() => performance.now())) - t0);
  await expect(page.getByTestId('comments-pane').getByRole('status')).toHaveText(
    '10,000 of 10,000 comments',
  );
  const list = page.getByTestId('comments-list');
  await list.focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press('PageDown');
  await page.keyboard.press('End');
  await page
    .getByTestId('comments-pane')
    .getByLabel('Sort by')
    .selectOption({ label: 'Date (newest first)' });
  await page.getByTestId('comments-pane').getByLabel('Sort by').selectOption({ label: 'Page' });
  test
    .info()
    .annotations.push({ type: 'm3-comments-first-rows-ms', description: String(firstRowsMs) });
  expect(firstRowsMs).toBeLessThan(1000);
});
