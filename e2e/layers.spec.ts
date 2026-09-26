import AxeBuilder from '@axe-core/playwright';
import { drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M2-11: the list-only Layers pane (ADR-012 decision 5, option 1).

test('lists layers with their default visibility; the document stays clean', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await drop(page, [{ name: 'layers.pdf', b64: pdfs.layers().toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await page
    .getByRole('complementary', { name: 'Navigation panes' })
    .getByRole('button', { name: 'Layers' })
    .click();
  const list = page.getByRole('list', { name: 'Layers' });
  await expect(list.getByRole('listitem')).toHaveText(['DimensionsShown', 'Hidden notesHidden']);
  await expect(
    page.getByText("Switching layers on or off isn't available yet.", { exact: false }),
  ).toBeVisible();
  const tab = page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
  await expect(tab).not.toContainText('unsaved');
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
});
