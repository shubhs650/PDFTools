// M1-01 spike checks (ADR-011). Numbers go to test-results/s9-results.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

type S9 = Record<string, (...a: unknown[]) => Promise<unknown>>;
const call = <T>(page: Page, fn: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([f, a]) => (window as unknown as { __s9: S9 }).__s9[f]?.(...a), [
    fn,
    args,
  ] as const) as Promise<T>;

const results: Record<string, unknown> = {};

async function boot(page: Page, query = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`/${query}`);
  await page
    .waitForFunction(() => '__s9' in window, undefined, { timeout: 15_000 })
    .catch(() => {
      throw new Error(`page did not boot: ${errors.join(' | ')}`);
    });
  return errors;
}

test.afterAll(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/s9-results.json', JSON.stringify(results, null, 2));
});

test('contract: open, scroll, multi-document', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (r) => {
    if (!/^(blob:)?http:\/\/localhost[:/]/.test(r.url())) outside.push(r.url());
  });
  const errors = await boot(page);
  results.contractOpen = await call(page, 'open', '/corpus/contract-2000.pdf', 'contract');
  await call(page, 'settle');
  results.scroll900 = await call(page, 'scroll', 900, 6000);
  results.scroll3000 = await call(page, 'scroll', 3000, 4000);

  // Second and third documents in the same registry (tabs).
  results.a0Open = await call(page, 'open', '/corpus/a0-20k.pdf', 'a0-20k');
  results.denseOpen = await call(page, 'open', '/corpus/a0-200k.pdf', 'a0-200k');
  results.openIds = await call(page, 'openIds');
  await call(page, 'activate', 'contract');
  results.backToContract = await call(page, 'settle');
  results.memory3docs = await call(page, 'report');

  // Facing mode + rotation on the contract.
  await call(page, 'spread', 'odd');
  results.facing = await call(page, 'settle');
  await call(page, 'rotate');
  results.rotated = await call(page, 'report');

  results.pageErrors = errors;
  expect(outside).toEqual([]);
  const r = results.scroll900 as { csp: number };
  expect(r.csp).toBe(0);
});

test('A0: deep zoom to 6400 % and zoom thrash', async ({ page }) => {
  await boot(page);
  for (const [file, id] of [
    ['a0-20k.pdf', 'a0-20k'],
    ['a0-200k.pdf', 'a0-200k'],
  ] as const) {
    results[`${id}:open`] = await call(page, 'open', `/corpus/${file}`, id);
    await call(page, 'settle');
    const levels: Record<string, unknown> = {};
    for (const z of [1, 8, 64, 'fit-page'] as const) {
      levels[String(z)] = await call(page, 'zoom', z);
      levels[`${String(z)}:state`] = await call(page, 'zoomState');
    }
    results[`${id}:zoom`] = levels;
    results[`${id}:zoomState`] = await call(page, 'zoomState');
    // Thrash: many zoom changes quickly; stale tiles must be aborted.
    await call(page, 'reset');
    for (const z of [2, 4, 8, 16, 32, 64, 32, 16, 8, 4, 2, 1]) {
      await page.evaluate((lv) => {
        void (window as unknown as { __s9: S9 }).__s9.zoomNoWait?.(lv);
      }, z);
      await page.waitForTimeout(40);
    }
    await call(page, 'settle');
    results[`${id}:thrash`] = await call(page, 'report');
  }
});

test('tile encoding: main-thread canvas vs encoder worker, png vs webp', async ({ page }) => {
  const out: Record<string, unknown> = {};
  for (const q of ['?enc=main&type=png', '?enc=worker&type=png', '?enc=worker&type=webp']) {
    await boot(page, q);
    const r: Record<string, unknown> = {};
    r.open = await call(page, 'open', '/corpus/contract-2000.pdf', 'contract');
    await call(page, 'settle');
    r.scroll900 = await call(page, 'scroll', 900, 6000);
    r.denseOpen = await call(page, 'open', '/corpus/a0-200k.pdf', 'a0-200k');
    await call(page, 'settle');
    r.zoomFit = await call(page, 'zoom', 'fit-page');
    r.zoom8 = await call(page, 'zoom', 8);
    out[q] = r;
  }
  results.encoding = out;
});
