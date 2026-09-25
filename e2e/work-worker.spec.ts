import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures.ts';

// M1-08: the Work worker's read-only copy, scheduled jobs and respawn policy.

interface WorkProbe {
  openBoth(
    b64: string,
    respawnAboveMB: number,
  ): Promise<{ renderPages: number; workPages: number }>;
  textStats(): Promise<{ pages: number; chars: number; ms: number }>;
  docState(): Promise<{ pageCount: number; appliedTailBytes: number }>;
  memory(): Promise<{ wasmBytes: number; peakWasmBytes: number }>;
  respawns(): number;
  lastCheckedBytes(): number;
}

async function work<K extends keyof WorkProbe>(page: Page, method: K, ...args: unknown[]) {
  await page.waitForFunction(() =>
    Boolean(
      (window as unknown as { __pdftoolsTest?: { capabilities: Record<string, unknown> } })
        .__pdftoolsTest?.capabilities.work,
    ),
  );
  return page.evaluate(
    ([m, a]) => {
      const p = (
        window as unknown as {
          __pdftoolsTest: {
            capabilities: Record<string, Record<string, (...x: unknown[]) => unknown>>;
          };
        }
      ).__pdftoolsTest.capabilities.work;
      return p?.[m]?.(...a);
    },
    [method, args] as const,
  ) as Promise<Awaited<ReturnType<WorkProbe[K]>>>;
}

const MB = 1024 * 1024;
// Baseline is ~18 MB after init; one text pass over the stand-in peaks at ~31 MB
// (the real 500 MB contract is an owner run). The production threshold is 256 MB.
const THRESHOLD_MB = 24;

test('a large job pushes the Work worker over the threshold; it respawns when idle and the document still works', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  const opened = await work(page, 'openBoth', pdfs.contract(2000).toString('base64'), THRESHOLD_MB);
  expect(opened).toEqual({ renderPages: 2000, workPages: 2000 });
  const baseline = (await work(page, 'memory')).wasmBytes;

  const stats = await work(page, 'textStats');
  expect(stats.pages).toBe(2000);
  expect(stats.chars).toBeGreaterThan(1_000_000);

  await expect.poll(() => work(page, 'respawns'), { timeout: 20_000 }).toBe(1);
  // What the idle check saw right after the job, before it respawned the worker.
  const peak = await work(page, 'lastCheckedBytes');
  expect(peak).toBeGreaterThan(THRESHOLD_MB * MB);
  const after = (await work(page, 'memory')).wasmBytes;
  test.info().annotations.push({
    type: 'memory',
    description: `baseline ${String(Math.round(baseline / MB))} MB, peak ${String(Math.round(peak / MB))} MB, after respawn ${String(Math.round(after / MB))} MB`,
  });
  expect(after).toBeLessThan(peak);
  expect(after).toBeLessThanOrEqual(baseline + 4 * MB);
  // Reloaded as original (+ tail) without user action.
  expect((await work(page, 'docState')).pageCount).toBe(2000);
});
