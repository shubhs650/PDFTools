// E2E-only probe for PDF Oxide and the export framework (M4-04). The ribbon
// commands ship with their formats (M4-05 on); until then tests reach the
// dialog and the Work worker's extraction through here. Never shipped.
import { lastExport, openExport } from '../features/extract/exportJob';
import { workClient } from '../features/view/host';
import type { TestHook } from './hook';

export function registerExtractProbe(hook: TestHook): void {
  hook.capabilities['extract'] = {
    /** Opens the export dialog for a format, as its command will. */
    openDialog: (docId: string, format: 'text') => {
      openExport(docId, format);
    },
    /** The last exported file: name and text. */
    lastExport: async () =>
      lastExport ? { name: lastExport.name, text: await lastExport.blob.text() } : null,
    /** The Work worker's warm-up (ADR-009 d2), timed on the main thread. */
    warm: async () => {
      const t0 = performance.now();
      const r = await workClient().run('oxideWarm', null).promise;
      return { ...r, mainMs: performance.now() - t0 };
    },
    /** An extraction straight through the Work worker, with its time and progress steps. */
    run: async (docId: string, pages: number[]) => {
      const t0 = performance.now();
      let steps = 0;
      try {
        const r = await workClient().run(
          'extract',
          { docId, pages, format: 'text' },
          {
            onProgress: () => {
              steps++;
            },
          },
        ).promise;
        return {
          ok: true,
          text: await r.blob.text(),
          pages: r.pages,
          ms: performance.now() - t0,
          steps,
        };
      } catch (err) {
        return { ok: false, code: (err as { code?: string }).code ?? String(err) };
      }
    },
    /** Starts an extraction and cancels it after `afterMs`: how long until it stops. */
    cancelAfter: async (docId: string, pages: number[], afterMs: number) => {
      const controller = new AbortController();
      let done = 0;
      const job = workClient().run(
        'extract',
        { docId, pages, format: 'text' },
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
