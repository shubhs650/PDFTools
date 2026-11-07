import { simplePdf } from '../fixtures/generate.ts';
import { drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// M9-05 (ADR-026 D-46): opening Help (F1, a new window) costs the app no
// main-thread long task; Help's page loads in its own window.
test('F1 opens Help with no long task in the app @smoke', async ({ page, context, guard }) => {
  await page.goto('/');
  await drop(page, [{ name: 'plan.pdf', b64: Buffer.from(simplePdf(3)).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  await page.getByTestId('document-view').focus();
  await guard.startMeasuring();
  const [help] = await Promise.all([context.waitForEvent('page'), page.keyboard.press('F1')]);
  await expect(help.locator('article.help-topic')).toBeVisible();
  await page.bringToFront();
  await page.waitForTimeout(500);
});
