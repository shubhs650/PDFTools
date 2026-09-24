import { expect, test } from '@playwright/test';

test('app shell loads with an accessible landmark and makes no cross-origin requests', async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  const foreign: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.protocol.startsWith('http') && url.origin !== origin) foreign.push(req.url());
  });

  await page.goto('/');
  await expect(page.getByRole('main', { name: 'PDFTools application' })).toBeVisible();
  await page.waitForLoadState('networkidle');

  // CLAUDE.md rule 4 / D-22: no third-party network calls.
  expect(foreign).toEqual([]);
});
