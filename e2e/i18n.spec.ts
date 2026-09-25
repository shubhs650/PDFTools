import { expect, test } from './support/fixtures.ts';

test('strings come from en.json, including the document title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('PDFTools');
  await expect(page.getByRole('main', { name: 'Document area' })).toBeVisible();
});

test('?locale=pseudo renders the pseudo-locale (dev and e2e builds only)', async ({ page }) => {
  await page.goto('/?locale=pseudo');
  const label = await page.getByRole('main').getAttribute('aria-label');
  expect(label?.startsWith('[Ðóçúɱéñţ')).toBe(true);
  expect(label?.length ?? 0).toBeGreaterThanOrEqual(Math.ceil('Document area'.length * 1.4));
});
