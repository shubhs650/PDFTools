import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { cap } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// M1-28 owner pack: timings on the owner's own heavy files (FAR, the ~500 MB
// contract, dense A0 drawings and P&IDs). Report-only (ADR-002): nothing here
// fails on a slow number. The files stay local: the browser reads them from
// disk and they are never copied into the repository; only numbers are
// written, to reports/owner-<n>.json (git-ignored), without file names (rule 10).
//
//   PowerShell: $env:OWNER_PDF="C:\drawings\a0.pdf;C:\contracts\far.pdf"; npm run owner:timings
//
// Each file is first copied into the browser's private storage (OPFS, not
// timed), then opened through its file handle, as Chromium/Edge open a file
// from disk: OPFS stands in for the disk file, and Ctrl+S appends to it with
// the same createWritable path. Skipped when OWNER_PDF is not set (always in CI).

const FILES = (process.env.OWNER_PDF ?? '')
  .split(';')
  .map((f) => f.trim())
  .filter(Boolean);
const LONG = 10 * 60_000;
const view = (page: Page, method: string, ...args: unknown[]) => cap(page, 'view', method, ...args);
const zoomBox = (page: Page) =>
  page.getByRole('contentinfo', { name: 'Status bar' }).getByRole('textbox', { name: 'Zoom' });
const now = (page: Page) => page.evaluate(() => performance.now());
const firstTab = (page: Page) =>
  page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab').first();

test.skip(FILES.length === 0, 'Set OWNER_PDF to one or more local PDF paths (";"-separated).');
test.describe.configure({ mode: 'serial' });

FILES.forEach((file, n) => {
  test(`owner file ${String(n + 1)} of ${String(FILES.length)}`, async ({ page, guard }) => {
    test.setTimeout(30 * 60_000);
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/');
    await expect(page.getByTestId('start-screen')).toBeVisible();
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.type = 'file';
      input.id = 'owner-file';
      input.hidden = true;
      document.body.append(input);
    });
    await page.setInputFiles('#owner-file', file);
    const bytes = (await cap(page, 'open', 'copyFromInput', '#owner-file', 'owner.pdf')) as number;
    await guard.startMeasuring();

    // Open → first page, then sharp.
    const t0 = await now(page);
    const [docId] = (await cap(page, 'open', 'openNamed', 'owner.pdf')) as string[];
    if (!docId) throw new Error('not opened');
    await page.locator('[data-page="0"] img.page-preview').waitFor({ timeout: LONG });
    const firstPageMs = Math.round((await now(page)) - t0);
    await view(page, 'settle', 400, LONG);
    const firstViewSharpMs = Math.round((await now(page)) - t0 - 400);

    // Scroll at 900 and 3,000 px/s (blank page frames, frame gaps).
    await view(page, 'reset');
    const scroll900 = await view(page, 'autoScroll', 900, 5000);
    await view(page, 'settle', 400, LONG);
    const scroll3000 = await view(page, 'autoScroll', 3000, 3000);
    await view(page, 'settle', 400, LONG);
    const renderStats = await view(page, 'stats');

    // Zoom: time until the tiles are sharp.
    const sharpAfterZoomMs: Record<string, number> = {};
    for (const z of ['800', '6400', '100']) {
      const z0 = await now(page);
      await zoomBox(page).fill(z);
      await zoomBox(page).press('Enter');
      await view(page, 'settle', 400, LONG);
      sharpAfterZoomMs[z] = Math.round((await now(page)) - z0 - 400);
    }

    // Ctrl+S with 100 markups (incremental append through the file handle).
    expect(await cap(page, 'save', 'addSquares', docId, 100)).toBeNull();
    await expect(firstTab(page)).toHaveAccessibleName('owner.pdf, unsaved changes');
    await page.locator('#document-panel').focus(); // not the zoom box: no shortcuts while typing
    const s0 = await now(page);
    await page.keyboard.press('Control+S');
    const prompt = page.getByRole('dialog', { name: 'Save optimized instead?' });
    await expect(prompt.or(page.getByRole('tab', { name: 'owner.pdf', exact: true }))).toBeVisible({
      timeout: LONG,
    });
    if (await prompt.isVisible()) await prompt.getByRole('button', { name: 'Just save' }).click();
    await expect(firstTab(page)).toHaveAccessibleName('owner.pdf', { timeout: LONG });
    const save100MarkupsMs = Math.round((await now(page)) - s0);
    const savedBytes = (await cap(page, 'open', 'fileSize', 'owner.pdf')) as number;
    expect(savedBytes).toBeGreaterThan(bytes);

    const result = {
      file: n + 1,
      bytes,
      firstPageMs,
      firstViewSharpMs,
      scroll900,
      scroll3000,
      sharpAfterZoomMs,
      save100MarkupsMs,
      bytesAppended: savedBytes - bytes,
      longTasksOver100ms: await guard.longTasksOverLimit(),
      renderStats,
      userAgent: await page.evaluate(() => navigator.userAgent),
    };
    expect(statSync(file).size).toBe(bytes); // the original on disk is never written
    mkdirSync('reports', { recursive: true });
    writeFileSync(`reports/owner-${String(n + 1)}.json`, `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify({ ...result, renderStats: undefined }, null, 2));
    test.info().annotations.push({ type: 'owner-timings', description: JSON.stringify(result) });
    // Report-only: long tasks are listed, not gated (e2e project); the guard
    // still fails the run on CSP violations or third-party requests (rule 4).
  });
});
