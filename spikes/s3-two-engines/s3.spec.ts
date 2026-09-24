import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// M0-S3 checks (docs/plan/M0.md §S3, ADR-004). Inputs are the public PDFs in
// corpus/: a 1,152-page catalogue stands in for the FAR (contract profile) and
// an A1 pressure-vessel sheet for deep zoom. The FAR, the 500 MB contract and
// dense A0 drawings are run by the owner with the same harness.

const CONTRACT = 'bearing catalogue.pdf';
const DRAWING = 'PRESSURE-VESSEL-SAMPLE.pdf';
const corpusUrl = (f: string): string => `/corpus/${encodeURIComponent(f)}`;
const results: Record<string, unknown> = {};

async function boot(page: Page, mode: 'hosted' | 'stock'): Promise<void> {
  await page.goto(`/?mode=${mode}`);
  await expect(page.locator('#status')).toHaveText(/ready|error/, { timeout: 60_000 });
  await expect(page.locator('#status')).toHaveText('ready');
}

const s3 = <T>(page: Page, expr: string): Promise<T> => page.evaluate(expr);

test.beforeAll(() => {
  for (const f of [CONTRACT, DRAWING]) {
    test.skip(!existsSync(`../corpus/${f}`) && !existsSync(`corpus/${f}`), `missing corpus/${f}`);
  }
});

test.afterAll(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/s3-results.json', JSON.stringify(results, null, 2));
});

for (const mode of ['hosted', 'stock'] as const) {
  test(`${mode}: both engines open the contract stand-in; Work job does not block tiles; no long tasks`, async ({
    page,
  }) => {
    await page.request.delete('/__csp-reports');
    await boot(page, mode);
    const load = await s3<{ pageCount: number; longTasks: number[] }>(
      page,
      `window.__s3.load(${JSON.stringify(corpusUrl(CONTRACT))})`,
    );
    expect(load.pageCount).toBe(1152);

    const c = await s3<{
      warmTile: { p50: number; p95: number };
      duringWorkTile: { p50: number; p95: number };
      extractAlone: { pages: number; chars: number };
      extractPassesDuringBench: unknown[];
      longTasks: number[];
    }>(page, 'window.__s3.concurrency({ firstPage: 100 })');
    results[`${mode}.load`] = load;
    results[`${mode}.concurrency`] = c;

    expect(c.extractAlone.pages).toBe(1152);
    expect(c.extractAlone.chars).toBeGreaterThan(1_000_000);
    expect(c.extractPassesDuringBench.length).toBeGreaterThanOrEqual(1);
    // Informative bound: the Work worker may slow tiles a little, not a lot.
    expect(c.duringWorkTile.p95).toBeLessThan(c.warmTile.p95 * 1.5 + 20);
    // ARCHITECTURE §11: no main-thread task > 100 ms in open/scroll/zoom.
    expect(load.longTasks.filter((d) => d > 100)).toEqual([]);
    expect(c.longTasks.filter((d) => d > 100)).toEqual([]);

    const cancel = await s3<{ cancelled: boolean; latencyMs: number }>(
      page,
      'window.__s3.cancelWork(300)',
    );
    results[`${mode}.cancelWork`] = cancel;
    expect(cancel.cancelled).toBe(true);
    expect(cancel.latencyMs).toBeLessThan(100);

    const reports = (await (await page.request.get('/__csp-reports')).json()) as unknown[];
    expect(reports).toEqual([]);
  });
}

test('hosted: memory per worker before/after open, close and respawn', async ({ page }) => {
  await boot(page, 'hosted');
  const boot0 = await s3<Record<string, number>>(page, 'window.__s3.memory()');
  const load = await s3<{ memory: Record<string, number> }>(
    page,
    `window.__s3.load(${JSON.stringify(corpusUrl(CONTRACT))})`,
  );
  await s3(page, 'window.__s3.concurrency({ firstPage: 100, scrollSteps: 5, zoomSteps: 2 })');
  const afterWork = await s3<Record<string, number>>(page, 'window.__s3.memory()');
  const closed = await s3<Record<string, number>>(page, 'window.__s3.closeDoc()');
  const respawn = await s3<{ memory: Record<string, number> }>(page, 'window.__s3.respawn()');
  results.memory = {
    boot: boot0,
    afterOpen: load.memory,
    afterWork,
    afterClose: closed,
    afterRespawn: respawn.memory,
  };

  // WASM memory never shrinks on close…
  expect(closed.workWasm).toBeGreaterThanOrEqual(load.memory.workWasm ?? 0);
  // …but terminating and respawning the worker returns it to the boot size.
  expect(respawn.memory.renderWasm).toBe(boot0.renderWasm);
  expect(respawn.memory.workWasm).toBe(boot0.workWasm);
});

test('hosted: deep zoom tiles, render cancellation and progressive rendering on an A1 sheet', async ({
  page,
}) => {
  await boot(page, 'hosted');
  await s3(page, `window.__s3.load(${JSON.stringify(corpusUrl(DRAWING))})`);
  const zoom = await s3<Record<string, unknown>>(page, 'window.__s3.deepZoom(0, [1, 8, 64], 7)');
  const cancel = await s3<{
    inflightAbortEffective: boolean;
    queuedExecutedInWorker: number;
    heavyAloneMs: number;
    smallAfterAbortMs: number;
  }>(page, 'window.__s3.cancelRender(0, 1.5)');
  const prog = await s3<{ finalStatus: number; slices: number; maxSliceMs: number }>(
    page,
    'window.__s3.progressive(0, 1, 8)',
  );
  const progCancel = await s3<{ cancelled: boolean; closeMs: number }>(
    page,
    'window.__s3.progressive(0, 1, 8, 20)',
  );
  results.deepZoom = zoom;
  results.cancelRender = cancel;
  results.progressive = { full: prog, cancelled: progCancel };

  expect(Object.keys(zoom)).toEqual(expect.arrayContaining(['100%', '800%', '6400%']));
  // Queued EmbedPDF renders are dropped before reaching the worker…
  expect(cancel.queuedExecutedInWorker).toBeLessThanOrEqual(2);
  // …an in-flight one is not (documented limitation, ADR-004).
  expect(cancel.inflightAbortEffective).toBe(false);
  // Direct progressive rendering is reachable, pauses, and can be abandoned.
  expect(prog.finalStatus).toBe(2); // FPDF_RENDER_DONE
  expect(prog.slices).toBeGreaterThan(1);
  expect(progCancel.cancelled).toBe(true);
  expect(progCancel.closeMs).toBeLessThan(50);
});
