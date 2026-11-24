// Spike S33 (M13-06), browser part: the template fill in a module worker
// under the §10.1 CSP (served verbatim). Writes test-results/s33-results.json.
//   PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium SPIKE=s33 npm run spikes -- --project=s33
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const results: Record<string, unknown> = {};
test.afterAll(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/s33-results.json', JSON.stringify(results, null, 2));
});

const jobs = [
  { name: '40 rows', rows: 40, snapEvery: 3, sheets: 1 },
  { name: '2000 rows, 200 pictures', rows: 2000, snapEvery: 10, sheets: 1 },
  { name: '2000 rows, 2000 pictures', rows: 2000, snapEvery: 1, sheets: 1 },
  { name: '2000 rows over 50 sheets', rows: 2000, snapEvery: 10, sheets: 50 },
];

test('S33: load, fill and write a template in a worker under the CSP', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('S33 ready');
  for (const job of jobs) {
    const r = await page.evaluate(
      (j) =>
        (
          window as unknown as { __s33: { run: (x: unknown) => Promise<Record<string, unknown>> } }
        ).__s33.run(j),
      job,
    );
    expect(r.zipMagic).toEqual([0x50, 0x4b]);
    results[job.name] = r;
  }
  const probe = await page.evaluate(() => {
    const p = (
      window as unknown as {
        __s33: { probe: { longTasks: { duration: number }[]; cspViolations: unknown[] } };
      }
    ).__s33.probe;
    return { longTasks: p.longTasks.map((t) => Math.round(t.duration)), csp: p.cspViolations };
  });
  results.probe = probe;
  expect(probe.csp).toEqual([]);
  expect(probe.longTasks.filter((d) => d > 100)).toEqual([]);
});
