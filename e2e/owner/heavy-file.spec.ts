import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { cap } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';
import { stubSavePicker } from '../support/savePicker.ts';

// M1-28 owner pack: timings on the owner's own heavy files (FAR, the ~500 MB
// contract, dense A0 drawings and P&IDs). Report-only (ADR-002): nothing here
// fails on a slow number. The files stay local: the browser reads them from
// disk and they are never copied into the repository; only numbers are
// written, to reports/owner-<n>.json (git-ignored), without file names (rule 10).
//
//   PowerShell: $env:OWNER_PDF="C:\drawings\a0.pdf;C:\contracts\far.pdf"; npm run owner:timings
//
// M2-19 adds search (§12: first hits < 1 s, complete < 15 s on typical files):
// a cold search for OWNER_SEARCH (default "the"), then the same search warm.
// The search word is not written to the report.
//
// M3-20 adds snapping (ADR-008): page 1's geometry prepared (extraction and
// index, the "Preparing snapping…" time), then pointer query round trips.
//
// M4-22 adds the M4 jobs: a Markdown export of every page, Express Extract on
// the first OWNER_TABLE_PAGES pages (default 50; tables found, not saved), a
// redaction mark over the middle of page 1 applied and verified (the verified
// file goes to a stubbed picker, never to disk), and a merge of the file with
// itself. Only times, counts and the check names are written, never content.
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
const SEARCH_TERM = process.env.OWNER_SEARCH ?? 'the';
const TABLE_PAGES = Number(process.env.OWNER_TABLE_PAGES ?? '50');
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

    // Search (M2-19): cold (text extracted on the way), then warm (cached).
    const searchRun = async () => {
      const r = (await cap(page, 'search', 'run', docId, SEARCH_TERM)) as {
        firstHitMs: number | null;
        totalMs: number;
        summary: { totalHits: number };
      };
      return {
        firstHitMs: r.firstHitMs === null ? null : Math.round(r.firstHitMs),
        totalMs: Math.round(r.totalMs),
        hits: r.summary.totalHits,
      };
    };
    const searchCold = await searchRun();
    const searchWarm = await searchRun();

    // Snapping (M3-20, ADR-008): the index of the page in view (after the zooms
    // that need not be page 1, M4-22), then 300 pointer moves over the page.
    const p0 = await now(page);
    await page.getByTestId('snap-toggle').click();
    await expect
      .poll(
        async () =>
          Object.values(
            ((await cap(page, 'annotate', 'snap')) as { pages: Record<string, string> }).pages,
          ).find((st) => st === 'ready' || st === 'failed') ?? 'preparing',
        { timeout: LONG },
      )
      .toMatch(/ready|failed/);
    const snapPrepareMs = Math.round((await now(page)) - p0);
    // A profile, so the tool doesn't stop at the reviewer prompt (M3-07).
    await cap(page, 'annotate', 'setProfile', 'Owner timings');
    await page.getByRole('tab', { name: 'Measure' }).click();
    await page
      .getByRole('toolbar', { name: 'Measure commands' })
      .getByRole('button', { name: 'Distance', exact: true })
      .click();
    // Over the middle of the view (whichever page is there): its index first, then 300 moves.
    const area = await page.getByTestId('document-view').boundingBox();
    const cx = (area?.x ?? 0) + (area?.width ?? 800) / 2;
    const cy = (area?.y ?? 0) + (area?.height ?? 600) / 2;
    await page.mouse.move(cx, cy);
    await expect
      .poll(
        async () =>
          Object.values(
            ((await cap(page, 'annotate', 'snap')) as { pages: Record<string, string> }).pages,
          ).includes('preparing'),
        { timeout: LONG },
      )
      .toBe(false);
    const before = ((await cap(page, 'annotate', 'snap')) as { rtts: number[] }).rtts.length;
    for (let i = 0; i < 300; i++) {
      const t = i / 10;
      await page.mouse.move(cx + Math.cos(t) * 200, cy + Math.sin(t) * 150);
    }
    const rtts = ((await cap(page, 'annotate', 'snap')) as { rtts: number[] }).rtts
      .slice(before)
      .sort((a, b) => a - b);
    const snapRttP95Ms = rtts.length
      ? Number((rtts[Math.floor(rtts.length * 0.95)] ?? 0).toFixed(2))
      : null;
    await page.keyboard.press('Escape');

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

    // M4 (M4-22): Markdown export of every page.
    const pageCount = ((await cap(page, 'pages', 'info', docId)) as unknown[]).length;
    await cap(page, 'extract', 'warm');
    const md = (await cap(
      page,
      'extract',
      'runTimed',
      docId,
      [...Array(pageCount).keys()],
      'markdown',
    )) as {
      ok: boolean;
      ms?: number;
      pages?: number;
      code?: string;
    };
    const markdownExport = md.ok
      ? { ms: Math.round(md.ms ?? 0), pages: md.pages }
      : { failed: md.code ?? 'error' };

    // Express Extract on the first pages: tables found (not saved).
    const tablePages = [...Array(Math.min(TABLE_PAGES, pageCount)).keys()];
    await cap(page, 'extract', 'openExpress', docId, tablePages);
    const express = page.getByRole('dialog', { name: 'Express Extract (Beta)' });
    const e0 = await now(page);
    await express.getByRole('button', { name: 'Find Tables' }).click();
    const found = express.locator('div[role="status"]');
    await expect(found).toBeVisible({ timeout: LONG });
    const expressExtract = {
      pages: tablePages.length,
      ms: Math.round((await now(page)) - e0),
      // The first number in the status ("n tables found."), separators removed.
      tables: Number.parseInt(
        (/\d[\d,.\u00a0\u202f ]*/u.exec(await found.innerText())?.[0] ?? '0').replace(/\D/gu, ''),
        10,
      ),
    };
    await express.getByRole('button', { name: 'Close' }).first().click();

    // A redaction mark over the middle of page 1, applied and verified.
    const [p1] = (await cap(page, 'pages', 'info', docId)) as { w: number; h: number }[];
    const redactArea = {
      origin: { x: (p1?.w ?? 600) / 4, y: (p1?.h ?? 800) / 4 },
      size: { width: (p1?.w ?? 600) / 2, height: (p1?.h ?? 800) / 2 },
    };
    await cap(page, 'annotate', 'create', docId, 0, {
      type: 28,
      rect: redactArea,
      segmentRects: [redactArea],
      color: '#000000',
      strokeColor: '#D93025',
    });
    await stubSavePicker(page);
    await page.getByRole('tab', { name: 'Protect' }).click();
    await page
      .getByRole('toolbar', { name: 'Protect commands' })
      .getByRole('button', { name: 'Apply Redactions' })
      .click();
    const apply = page.getByRole('dialog', { name: 'Apply Redactions' });
    const r0 = await now(page);
    await apply.getByRole('button', { name: 'Apply and Save As…' }).click();
    const verified = apply.getByTestId('redact-result');
    const refused = apply.getByRole('alert');
    await expect(verified.or(refused)).toBeVisible({ timeout: LONG });
    const redaction = {
      ms: Math.round((await now(page)) - r0),
      verified: await verified.isVisible(),
      // "page n: <check>" only: page numbers and check names, no content (rule 10).
      unverified: (await refused.isVisible())
        ? await refused.getByRole('listitem').allInnerTexts()
        : [],
    };
    await apply.getByRole('button', { name: 'Close' }).first().click();

    // Merge the file with itself (Organize → Merge Files).
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('e2e-files');
      const handle = await dir.getFileHandle('owner.pdf');
      const w = window as unknown as { showOpenFilePicker: () => Promise<unknown[]> };
      w.showOpenFilePicker = () => Promise.resolve([handle, handle]);
    });
    await page.getByRole('tab', { name: 'Organize' }).click();
    await page
      .getByRole('toolbar', { name: 'Organize commands' })
      .getByRole('button', { name: 'Merge Files' })
      .click();
    const merge = page.getByRole('dialog', { name: 'Merge Files' });
    await merge.getByRole('button', { name: 'Add Files…' }).click();
    await expect(merge.getByText(/owner\.pdf: /u).nth(1)).toBeVisible({ timeout: LONG });
    const docTabs = page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
    const tabsBefore = await docTabs.count();
    const m0 = await now(page);
    await merge.getByRole('button', { name: 'Merge' }).click();
    await expect(docTabs).toHaveCount(tabsBefore + 1, { timeout: LONG });
    // The new tab becomes active a moment after it appears.
    await expect.poll(() => cap(page, 'view', 'activeDocId'), { timeout: LONG }).not.toBe(docId);
    const mergedId = (await cap(page, 'view', 'activeDocId')) as string;
    await expect
      .poll(async () => ((await cap(page, 'pages', 'info', mergedId)) as unknown[]).length, {
        timeout: LONG,
      })
      .toBe(pageCount * 2);
    await page.locator('[data-page="0"] img.page-preview').waitFor({ timeout: LONG });
    const mergeSelfMs = Math.round((await now(page)) - m0);

    const result = {
      file: n + 1,
      bytes,
      firstPageMs,
      firstViewSharpMs,
      scroll900,
      scroll3000,
      sharpAfterZoomMs,
      searchCold,
      searchWarm,
      snapPrepareMs,
      snapRttP95Ms,
      snapQueries: rtts.length,
      save100MarkupsMs,
      bytesAppended: savedBytes - bytes,
      pages: pageCount,
      markdownExport,
      expressExtract,
      redaction,
      mergeSelfMs,
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
