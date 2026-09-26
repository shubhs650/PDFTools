import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { PdfDocumentObject } from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { NEEDLE, contractPdf } from '../../e2e/fixtures/generate';
import { AbortError } from '../../src/engine/errors';
import { Activity, indexDocument } from '../../src/workers/work/indexer';
import { Scheduler, type JobSlice } from '../../src/workers/work/scheduler';
import { SearchEngine } from '../../src/workers/work/search';

// M2-06: background text indexing in the Work worker (ADR-006 decision 3).

const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
let seq = 0;

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
});

const open = (bytes: Uint8Array): Promise<PdfDocumentObject> =>
  native
    .openDocumentBuffer(
      { id: `i${String(++seq)}`, content: bytes.slice().buffer },
      { normalizeRotation: true },
    )
    .toPromise();

const freeSlice = (): JobSlice => ({
  signal: new AbortController().signal,
  checkpoint: () => Promise.resolve(),
});

const engine = () =>
  new SearchEngine(
    () => mod,
    () => native,
  );

describe('Activity', () => {
  it('is busy for the quiet period after the last poke', () => {
    let t = 0;
    const a = new Activity(() => t);
    expect(a.busy()).toBe(false);
    a.poke(300);
    t = 299;
    expect(a.busy()).toBe(true);
    a.poke(300); // extends
    t = 500;
    expect(a.busy()).toBe(true);
    t = 600;
    expect(a.busy()).toBe(false);
  });
});

describe('indexDocument', () => {
  it('extracts every page once, in viewport order, and reports progress', async () => {
    const doc = await open(contractPdf(12));
    const e = engine();
    const seen: number[] = [];
    const r = await indexDocument(e, doc.id, doc, [5], freeSlice(), new Activity(), (p) =>
      seen.push(p.done),
    );
    expect(r).toMatchObject({ pages: 12, extracted: 12 });
    expect(e.cache.pages(doc.id)).toBe(12);
    expect(seen).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    // A second run finds everything cached.
    const again = await indexDocument(
      e,
      doc.id,
      doc,
      [0],
      freeSlice(),
      new Activity(),
      () => undefined,
    );
    expect(again.extracted).toBe(0);
    await native.closeDocument(doc).toPromise();
  });

  it('pauses while the user scrolls, napping through checkpoints', async () => {
    const doc = await open(contractPdf(4));
    let t = 0;
    const activity = new Activity(() => t);
    activity.poke(300);
    let naps = 0;
    let checkpoints = 0;
    const slice: JobSlice = {
      signal: new AbortController().signal,
      checkpoint: () => {
        checkpoints++;
        return Promise.resolve();
      },
    };
    const r = await indexDocument(
      engine(),
      doc.id,
      doc,
      [0],
      slice,
      activity,
      () => undefined,
      () => {
        naps++;
        t += 50; // time passes while napping
        return Promise.resolve();
      },
      Number.POSITIVE_INFINITY, // no duty-cycle naps here
    );
    expect(naps).toBe(6); // 300 ms quiet period / 50 ms naps
    expect(checkpoints).toBe(4 + 6); // one per page, one per nap
    expect(r.extracted).toBe(4);
    await native.closeDocument(doc).toPromise();
  });

  it('naps as long as it worked after each ~8 ms of extraction (idle priority)', async () => {
    const doc = await open(contractPdf(40));
    const naps: number[] = [];
    await indexDocument(
      engine(),
      doc.id,
      doc,
      [0],
      freeSlice(),
      new Activity(),
      () => undefined,
      (ms) => {
        naps.push(ms);
        return Promise.resolve();
      },
      0.001, // nap after every page
    );
    expect(naps.length).toBeGreaterThanOrEqual(39);
    expect(naps.every((ms) => ms > 0)).toBe(true);
    await native.closeDocument(doc).toPromise();
  });

  it('stops at a page boundary when cancelled', async () => {
    const doc = await open(contractPdf(10));
    const e = engine();
    let n = 0;
    const slice: JobSlice = {
      signal: new AbortController().signal,
      checkpoint: () => (n++ >= 3 ? Promise.reject(new AbortError()) : Promise.resolve()),
    };
    await expect(
      indexDocument(e, doc.id, doc, [0], slice, new Activity(), () => undefined),
    ).rejects.toBeInstanceOf(AbortError);
    expect(e.cache.pages(doc.id)).toBe(3);
    await native.closeDocument(doc).toPromise();
  });

  it('a search preempts indexing (scheduler) and searches cached pages first', async () => {
    const doc = await open(contractPdf(1100)); // needle on pages 7 and 1,000
    const e = engine();
    const scheduler = new Scheduler();
    const ac = new AbortController();
    const order: string[] = [];
    const indexing = scheduler
      .run('background', ac.signal, (slice) =>
        indexDocument(e, doc.id, doc, [0], slice, new Activity(), (p) => {
          if (p.done === 200) {
            // Mid-index: a search arrives.
            void scheduler
              .run('interactive', ac.signal, async (s) => {
                order.push(`search at ${String(e.cache.pages(doc.id))} cached`);
                const hits: number[] = [];
                await e.search(
                  { docId: doc.id, searchId: 1, query: NEEDLE, options: {}, visible: [900] },
                  doc,
                  s,
                  (b) => hits.push(...b.hits.map((h) => h.page)),
                );
                order.push(`hits ${hits.join(',')}`);
              })
              .catch(() => undefined);
          }
        }),
      )
      .then((r) => order.push(`indexed ${String(r.pages)}`));
    await indexing;
    expect(order[0]).toMatch(/^search at 20\d cached$/);
    // Visible page first (900), then the cached pages (so page 7 before 1,000).
    expect(order[1]).toBe('hits 6,999');
    expect(order[2]).toBe('indexed 1100');
    expect(e.order(doc.id, 10, [4]).slice(0, 1)).toEqual([4]);
    await native.closeDocument(doc).toPromise();
  });
});
