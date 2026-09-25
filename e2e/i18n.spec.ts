import { expect, test } from './support/fixtures.ts';

test('strings come from en.json, including the document title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('PDFTools');
  await expect(page.getByRole('main', { name: 'PDFTools application' })).toBeVisible();
});

test('?locale=pseudo renders the pseudo-locale (dev and e2e builds only)', async ({ page }) => {
  await page.goto('/?locale=pseudo');
  const label = await page.getByTestId('app-shell').getAttribute('aria-label');
  expect(label).toMatch(/^\[ÞĎ|^\[Þ/);
  expect(label?.length ?? 0).toBeGreaterThanOrEqual(Math.ceil('PDFTools application'.length * 1.4));
});
