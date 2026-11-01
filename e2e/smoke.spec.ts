import { expect, test } from './support/fixtures.ts';

// The shared `guard` fixture fails this test on any CSP violation or any
// request that leaves the app origin (CLAUDE.md rule 4, D-22).
test('app shell loads with an accessible landmark @smoke', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('main', { name: 'Document area' })).toBeVisible();
  await page.waitForLoadState('networkidle');
});
