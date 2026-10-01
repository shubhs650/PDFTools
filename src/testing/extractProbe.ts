// E2E-only probe for PDF Oxide and the export framework (M4-04, M4-05). Tests
// reach the Work worker's extraction directly through here, and read back what
// the dialog produced. Never shipped.
import { lastExport, openExport, type ExportFormat } from '../features/extract/exportJob';
import {
  expressStore,
  lastTableExport,
  openExpressExtract,
} from '../features/tables/expressExtract';
import { dispatchReview, selectTable } from '../features/tables/reviewStore';
import { workClient } from '../features/view/host';
import { makeGrid } from '../model/tableGrid';
import type { ExtractFormat, ExtractOptions } from '../workers/work/extract';
import type { TestHook } from './hook';

const options = (format: ExtractFormat, images = false): ExtractOptions => ({
  format,
  images,
  baseName: 'probe',
  title: 'probe',
  lang: 'en',
  labels: { page: 'Page %P', image: 'Image %N on page %P', noText: 'Page %P has no text' },
});

export function registerExtractProbe(hook: TestHook): void {
  hook.capabilities['extract'] = {
    /** Opens the export dialog for a format, as its command does. */
    openDialog: (docId: string, format: ExportFormat) => {
      openExport(docId, format);
    },
    /** The last output: packaging and each file's path, size and (for text files) text. */
    lastExport: async (which: 'export' | 'tables' = 'export') => {
      const last = which === 'tables' ? lastTableExport : lastExport;
      if (!last) return null;
      const files = await Promise.all(
        last.files.map(async (f) => {
          const text = /\.(txt|md|html|csv)$/.test(f.path) ? await f.blob.text() : null;
          let b64: string | null = null;
          if (text === null && f.blob.size < 4_000_000) {
            let bin = '';
            for (const b of new Uint8Array(await f.blob.arrayBuffer()))
              bin += String.fromCharCode(b);
            b64 = btoa(bin);
          }
          return { path: f.path, size: f.blob.size, text, b64 };
        }),
      );
      return { packaging: last.packaging, files };
    },
    /** The Work worker's warm-up (ADR-009 d2), timed on the main thread. */
    warm: async () => {
      const t0 = performance.now();
      const r = await workClient().run('oxideWarm', null).promise;
      return { ...r, mainMs: performance.now() - t0 };
    },
    /** An extraction straight through the Work worker, with its time and progress steps. */
    run: async (docId: string, pages: number[], format: ExtractFormat = 'text', images = false) => {
      const t0 = performance.now();
      let steps = 0;
      try {
        const r = await workClient().run(
          'extract',
          { docId, pages, options: options(format, images), packaging: 'folder' },
          {
            onProgress: () => {
              steps++;
            },
          },
        ).promise;
        const files = await Promise.all(
          (r.files ?? []).map(async (f) => ({
            path: f.path,
            size: f.blob.size,
            type: f.blob.type,
            text: f.blob.type.startsWith('text/') ? await f.blob.text() : null,
          })),
        );
        return {
          ok: true,
          text: files[0]?.text ?? '',
          files,
          pages: r.pages,
          images: r.images,
          ms: performance.now() - t0,
          steps,
        };
      } catch (err) {
        return { ok: false, code: (err as { code?: string }).code ?? String(err) };
      }
    },
    /**
     * As `run`, for perf scenarios: time, pages and output sizes only. Reading a
     * 2,000-page output back as text and returning it through page.evaluate is
     * test-harness work on the main thread (a 400 ms task on CI), not the app's.
     */
    runTimed: async (docId: string, pages: number[], format: ExtractFormat = 'text') => {
      const t0 = performance.now();
      try {
        const r = await workClient().run('extract', {
          docId,
          pages,
          options: options(format),
          packaging: 'folder',
        }).promise;
        const ms = performance.now() - t0;
        return { ok: true, ms, pages: r.pages, bytes: (r.files ?? []).map((f) => f.blob.size) };
      } catch (err) {
        return { ok: false, code: (err as { code?: string }).code ?? String(err) };
      }
    },
    /** Opens Express Extract (M4-13) for the given pages, as if they were selected. */
    openExpress: (docId: string, pages: number[]) => {
      openExpressExtract(docId);
      expressStore.setState({ pages });
    },
    /** Adds a cols × rows table over `box` to Review & Extract and selects it (perf, M4-14). */
    reviewAdd: (
      page: number,
      box: [number, number, number, number],
      cols: number,
      rows: number,
    ) => {
      const id = `probe-${String(page)}-${String(cols)}x${String(rows)}`;
      dispatchReview({
        type: 'add',
        table: { id, grid: makeGrid(page, box, cols, rows), accepted: true },
      });
      selectTable(id);
    },
    /** Starts an extraction and cancels it after `afterMs`: how long until it stops. */
    cancelAfter: async (docId: string, pages: number[], afterMs: number) => {
      const controller = new AbortController();
      let done = 0;
      const job = workClient().run(
        'extract',
        { docId, pages, options: options('text'), packaging: 'single' },
        {
          signal: controller.signal,
          onProgress: (p) => {
            done = p.done;
          },
        },
      );
      await new Promise((r) => setTimeout(r, afterMs));
      const t = performance.now();
      controller.abort();
      const outcome = await job.promise.then(
        () => 'finished',
        () => 'cancelled',
      );
      return { outcome, stopMs: performance.now() - t, done };
    },
  };
}
