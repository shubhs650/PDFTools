// E2E-only probe for the comparison's workers (M12-07, D-66). Never part of a
// production build. Starts a CompareSession on two open documents through the
// app's own Work and Compare clients and reports what a test needs: progress,
// sheets as they arrive (with the main-thread time), memory and release.
import type { SheetFacts } from '../engine/compareApi';
import { compareClient } from '../features/compare/engine/compareHost';
import { CompareSession } from '../features/compare/engine/session';
import type { QueueProgress } from '../features/compare/engine/jobQueue';
import { workClient } from '../features/view/host';
import type { TestHook } from './hook';

interface Run {
  session: CompareSession;
  t0: number;
  sheets: { sheet: number; ms: number; facts: SheetFacts }[];
  errors: { key: string; code: string }[];
  progress: QueueProgress | null;
  doneMs: number | null;
}

let run: Run | null = null;

export function registerCompareProbe(hook: TestHook): void {
  hook.capabilities['compare'] = {
    /** Compares every page of `aDocId` with `bDocId` (paired in order) in the background. */
    async start(
      aDocId: string,
      aPages: number,
      bDocId: string,
      bPages: number,
      opts: { focus?: number; dpi?: number } = {},
    ) {
      const work = workClient();
      await work.whenAdded(aDocId, 10_000);
      await work.whenAdded(bDocId, 10_000);
      const range = (n: number) => [...Array(n).keys()];
      const t0 = performance.now();
      const r: Run = {
        session: null as unknown as CompareSession,
        t0,
        sheets: [],
        errors: [],
        progress: null,
        doneMs: null,
      };
      r.session = new CompareSession(
        { docId: aDocId, pages: range(aPages) },
        { docId: bDocId, pages: range(bPages) },
        {
          work,
          compare: compareClient(),
          ...(opts.dpi ? { dpi: opts.dpi } : {}),
          onSheet: (sheet, facts) => {
            r.sheets.push({ sheet, ms: performance.now() - t0, facts });
          },
          onProgress: (p) => {
            r.progress = p;
          },
          onError: (key, err) => {
            r.errors.push({ key, code: (err as { code?: string }).code ?? err.name });
          },
        },
      );
      if (opts.focus !== undefined) r.session.focus(opts.focus);
      run = r;
      await r.session.start();
      void r.session.whenDone().then(() => {
        r.doneMs = performance.now() - t0;
      });
      return { id: r.session.id, sheets: r.session.pairs.length };
    },
    status() {
      if (!run) return null;
      return {
        progress: run.progress,
        sheets: run.sheets.map((s) => ({
          sheet: s.sheet,
          ms: s.ms,
          identical: s.facts.identical,
          inkA: s.facts.inkA,
          inkB: s.facts.inkB,
          rows: s.facts.rows,
          height: s.facts.height,
        })),
        errors: run.errors,
        doneMs: run.doneMs,
      };
    },
    focus(sheet: number) {
      run?.session.focus(sheet);
    },
    cancel() {
      run?.session.cancel();
    },
    async memory() {
      const c = compareClient();
      if (!c.running) return { running: false, bytes: 0, comparisons: 0 };
      const m = await c.call('memory', null).promise;
      return { running: true, ...m };
    },
    async close() {
      const r = run;
      run = null;
      await r?.session.close();
      const c = compareClient();
      return { running: c.running, open: c.openCount, starts: c.starts };
    },
  };
}
