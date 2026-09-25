// Visible-first ordering of queued renders (ADR-004 decision 3, ADR-011).
// EmbedPDF's engine queue (concurrency 1) orders by priority (previews are
// CRITICAL, tiles HIGH) and then by a pluggable rank: we rank the active
// document's pages by distance from the page in view, so the queue serves
// what is on screen first. Stale tiles are aborted by the stock TilingLayer
// when they leave the visible set; renderStats counts those aborts.

export interface ViewFocus {
  docId: string | null;
  /** 0-based page in view. */
  pageIndex: number;
}

export interface RankedTask {
  meta?: { docId?: string; pageIndex?: number } | undefined;
}

const OTHER_DOC = -1e9;

/** Higher runs first. */
export function rankTask(task: RankedTask, focus: ViewFocus): number {
  const { docId, pageIndex } = task.meta ?? {};
  if (docId === undefined || pageIndex === undefined) return 0;
  const distance = Math.abs(pageIndex - focus.pageIndex);
  return docId === focus.docId ? -distance : OTHER_DOC - distance;
}

export const viewFocus: ViewFocus = { docId: null, pageIndex: 0 };

export function setViewFocus(docId: string | null, pageIndex: number): void {
  viewFocus.docId = docId;
  viewFocus.pageIndex = pageIndex;
}

interface RankableQueue {
  setRanker?: (ranker: (task: RankedTask) => number) => void;
}

/**
 * Installs the ranker on the engine's queue. The queue is an internal of
 * @embedpdf/engines 2.15.1 (pinned, ADR-011): without it, renders keep the
 * stock FIFO order within a priority, which is still correct.
 */
export function installRanker(engine: object): boolean {
  const queue = (engine as { workerQueue?: RankableQueue }).workerQueue;
  if (typeof queue?.setRanker !== 'function') return false;
  queue.setRanker((task) => rankTask(task, viewFocus));
  return true;
}
