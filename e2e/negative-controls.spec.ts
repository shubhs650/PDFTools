// Negative controls for the shared guard (M1-02): each test does something
// forbidden on purpose and checks that `guard.problems()`, the same check the
// fixture teardown runs, reports it. Then it acknowledges the finding so the
// teardown passes.
import { expect, test } from './support/fixtures.ts';

test('a blocked CDN fetch is reported as a CSP violation, in the page and by report', async ({
  page,
  guard,
}) => {
  await page.goto('/');
  // The EmbedPDF font default would do exactly this (ADR-003 finding 2).
  await page.evaluate(() =>
    fetch('https://cdn.jsdelivr.net/npm/@embedpdf/fonts-sc/package.json').catch(() => undefined),
  );
  await expect
    .poll(async () => Object.keys(await guard.problems(false)).sort())
    .toEqual([
      'CSP violations in the document',
      'CSP violations reported (page, workers, service worker)',
    ]);
  expect((await guard.documentCspViolations())[0]?.directive).toBe('connect-src');
  await guard.acknowledge();
});

test('a request to another origin is reported', async ({ page, guard }) => {
  await page.goto('/');
  // Navigation is not governed by connect-src, so the request is really made.
  await page.goto('http://127.0.0.1:9/').catch(() => undefined);
  expect(Object.keys(await guard.problems(false))).toContain('third-party requests (rule 4)');
  await guard.acknowledge();
});
