// Background text indexing (§6, ADR-006 decision 3, M2-06). After a document
// opens, the Work worker extracts every page's text into the search engine's
// session cache at background priority, in viewport order, so a later search
// finds rare terms anywhere in under a second. It yields to searches and
// save verification at every page (scheduler checkpoint), and backs off while
// the user scrolls or zooms (ADR-006 risk: CPU contention with the Render
// worker). Nothing is persisted (decision 4).
import type { PdfDocumentObject } from '@embedpdf/models';
import type { JobSlice } from './scheduler';
import type { SearchEngine } from './search';
import { searchOrder } from './searchCore';

/** How long the indexer stays paused after the last scroll or zoom. */
export const QUIET_MS = 300;
/** Nap while paused; each wake-up is a checkpoint, so searches still get in. */
export const NAP_MS = 50;
/**
 * Idle priority, not just low priority: after about this much extraction the
 * indexer naps as long as it worked, so it takes at most half a core and the
 * Render worker and the main thread keep theirs (CI saw a 410 ms main-thread
 * task on a small runner while indexing ran flat out, M2-07).
 */
export const DUTY_MS = 8;

/** "The user is scrolling or zooming": the main thread pokes it (throttled there). */
export class Activity {
  private until = -Infinity;
  private readonly now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  poke(quietMs = QUIET_MS): void {
    this.until = Math.max(this.until, this.now() + quietMs);
  }

  busy(): boolean {
    return this.now() < this.until;
  }
}

export interface IndexResult {
  pages: number;
  /** Pages extracted by this run (the rest were cached already). */
  extracted: number;
  /** Time spent paused for scrolling or zooming. */
  pausedMs: number;
  ms: number;
}

export async function indexDocument(
  engine: SearchEngine,
  docId: string,
  first: PdfDocumentObject,
  visible: readonly number[],
  slice: JobSlice,
  activity: Activity,
  onProgress: (p: { done: number; total: number }) => void,
  nap: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  dutyMs = DUTY_MS,
  /** The document now: after a reload (unsaved page changes) indexing starts over on it. */
  current: () => Promise<PdfDocumentObject> = () => Promise.resolve(first),
): Promise<IndexResult> {
  const t0 = performance.now();
  let extracted = 0;
  let pausedMs = 0;
  let worked = 0;
  let doc = first;
  let done = 0;
  restart: for (;;) {
    done = 0;
    for (const page of searchOrder(doc.pageCount, visible)) {
      if (worked >= dutyMs) {
        await nap(worked);
        worked = 0;
      }
      await slice.checkpoint();
      if (activity.busy()) {
        const p0 = performance.now();
        while (activity.busy()) {
          await nap(NAP_MS);
          await slice.checkpoint();
        }
        pausedMs += performance.now() - p0;
      }
      const now = await current();
      if (now.id !== doc.id) {
        doc = now;
        continue restart;
      }
      if (engine.cache.get(docId, page) === undefined) {
        const w0 = performance.now();
        engine.text(docId, doc, page);
        worked += performance.now() - w0;
        extracted++;
      }
      done++;
      onProgress({ done, total: doc.pageCount });
    }
    break;
  }
  return { pages: doc.pageCount, extracted, pausedMs, ms: performance.now() - t0 };
}
