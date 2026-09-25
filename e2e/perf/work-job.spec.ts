import { expect, test } from '../support/fixtures.ts';

// Rule 1 / §12: a 2,000-page Work-worker job (text of every page) with the
// Render worker also holding the document causes no main-thread long task.
test('a full-document Work job leaves the main thread free', async ({ page, pdfs, guard }) => {
  await page.goto('/');
  await page.waitForFunction(() =>
    Boolean(
      (window as unknown as { __pdftoolsTest?: { capabilities: Record<string, unknown> } })
        .__pdftoolsTest?.capabilities.work,
    ),
  );
  const b64 = pdfs.contract(2000).toString('base64');
  await page.evaluate(
    (b) =>
      (
        window as unknown as {
          __pdftoolsTest: {
            capabilities: { work: { openBoth(b: string, mb: number): Promise<unknown> } };
          };
        }
      ).__pdftoolsTest.capabilities.work.openBoth(b, 256),
    b64,
  );
  await guard.startMeasuring();
  const stats = await page.evaluate(() =>
    (
      window as unknown as {
        __pdftoolsTest: {
          capabilities: { work: { textStats(): Promise<{ pages: number; ms: number }> } };
        };
      }
    ).__pdftoolsTest.capabilities.work.textStats(),
  );
  expect(stats.pages).toBe(2000);
  test.info().annotations.push({
    type: 'textStats',
    description: `${String(Math.round(stats.ms))} ms for 2,000 pages`,
  });
});
