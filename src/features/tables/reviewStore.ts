// Review & Extract (M4-14, §7.7): the mode's state on the main thread — the
// tables (reviewModel.ts), the selected one, the tool, a divider being dragged,
// the keyboard rectangle (M4-Q10) — and its jobs in the Work worker: detection
// per page (progress, Cancel; rule 2), the text of the selected table for the
// preview (cached per grid, at most one request in flight so a drag never
// queues stale work), and the export (M4-13's writers).
import { createStore, useStore } from 'zustand';
import { notify } from '../../app/commands/dispatch';
import { setUndoOverride } from '../../app/commands/undoOverride';
import { recordError } from '../../app/diagnostics';
import { documentStore } from '../../app/store/documentStore';
import { RpcError } from '../../engine/errors';
import { msg, t } from '../../i18n';
import { makeGrid, type TableData, type TableGrid } from '../../model/tableGrid';
import { DENIED } from '../../workers/work/permissionGate';
import type { TableFormat } from '../../workers/work/tables/job';
import { baseNameOf } from '../extract/exportJob';
import { targetPages } from '../pages/selection';
import { workClient } from '../view/host';
import { writeTables } from './expressExtract';
import { emptyReview, ordered, review, type ReviewAction, type ReviewDoc } from './reviewModel';

export type ReviewError = 'denied' | 'failed';
export type Box = [number, number, number, number];

interface ReviewState {
  docId: string | null;
  doc: ReviewDoc;
  selectedId: string | null;
  tool: 'adjust' | 'draw';
  /** The selected table while a divider is dragged (not yet an undo step). */
  drag: { id: string; grid: TableGrid } | null;
  /** The keyboard rectangle for a new table (M4-Q10): user space. */
  keyRect: { page: number; box: Box } | null;
  detecting: { done: number; total: number } | null;
  /** Cells of the selected table's current grid. */
  preview: { id: string; key: string; data: TableData } | null;
  exporting: boolean;
  error: ReviewError | null;
  /** Said once by the panel's live region. */
  announcement: string | null;
}

const CLOSED: ReviewState = {
  docId: null,
  doc: emptyReview(),
  selectedId: null,
  tool: 'adjust',
  drag: null,
  keyRect: null,
  detecting: null,
  preview: null,
  exporting: false,
  error: null,
  announcement: null,
};

export const reviewStore = createStore<ReviewState>()(() => CLOSED);

export function useReview<T>(selector: (s: ReviewState) => T): T {
  return useStore(reviewStore, selector);
}

export const reviewActive = (docId: string): boolean => reviewStore.getState().docId === docId;

let seq = 0;
const newId = (): string => `t${String(++seq)}`;
let detectJob: AbortController | null = null;
let exportJob: AbortController | null = null;
let offDocs: (() => void) | null = null;

function announce(text: string): void {
  reviewStore.setState({ announcement: text });
}

/** Said by the panel's live region. */
export const announceReview = announce;

export function dispatchReview(a: ReviewAction): void {
  const s = reviewStore.getState();
  const doc = review(s.doc, a);
  if (doc === s.doc) return;
  const selected = doc.tables.some((x) => x.id === s.selectedId) ? s.selectedId : null;
  reviewStore.setState({ doc, selectedId: selected });
  notify();
  requestPreview();
}

/** Turns the mode on for `docId`; it detects tables on the selected pages unless `detectNow` is false. */
export function enterReview(docId: string, detectNow = true): void {
  if (reviewStore.getState().docId === docId) return;
  exitReview();
  reviewStore.setState({ ...CLOSED, doc: emptyReview(), docId });
  setUndoOverride({
    canUndo: () => reviewStore.getState().doc.past.length > 0,
    canRedo: () => reviewStore.getState().doc.future.length > 0,
    undo: () => {
      dispatchReview({ type: 'undo' });
    },
    redo: () => {
      dispatchReview({ type: 'redo' });
    },
    nothingToUndo: msg('tables.review.nothingToUndo'),
    nothingToRedo: msg('tables.review.nothingToRedo'),
  });
  // The document closed: the mode ends with it.
  offDocs = documentStore.subscribe((d) => {
    if (!d.docs[docId]) exitReview();
  });
  if (detectNow) void detect(targetPages(docId));
}

/** Adds grids (a template applied to pages) as accepted tables, one undo step. */
export function addGrids(grids: readonly TableGrid[]): void {
  const tables = grids.map((grid) => ({ id: newId(), grid, accepted: true }));
  dispatchReview({ type: 'addMany', tables });
  const first = tables[0];
  if (first) selectTable(first.id);
}

export function exitReview(): void {
  detectJob?.abort();
  exportJob?.abort();
  offDocs?.();
  offDocs = null;
  if (reviewStore.getState().docId) setUndoOverride(null);
  reviewStore.setState(CLOSED);
  notify();
}

export function selectTable(id: string | null): void {
  reviewStore.setState({ selectedId: id });
  requestPreview();
}

export function setReviewTool(tool: 'adjust' | 'draw'): void {
  reviewStore.setState({ tool, ...(tool === 'adjust' ? { keyRect: null } : {}) });
}

// ---- detection ------------------------------------------------------------------

export function cancelDetect(): void {
  detectJob?.abort();
}

/** Detects tables on `pages` and proposes those not overlapping one already there. */
export async function detect(pages: number[]): Promise<void> {
  const { docId, detecting } = reviewStore.getState();
  if (!docId || detecting || !pages.length) return;
  const controller = new AbortController();
  detectJob = controller;
  reviewStore.setState({ detecting: { done: 0, total: pages.length }, error: null });
  try {
    const r = await workClient().run(
      'detectTables',
      { docId, pages },
      {
        signal: controller.signal,
        onProgress: (p) => {
          if (!controller.signal.aborted) reviewStore.setState({ detecting: p });
        },
      },
    ).promise;
    controller.signal.throwIfAborted();
    const before = reviewStore.getState().doc.tables.length;
    for (const p of r.pages) {
      const grids = p.tables.map((x) => x.grid);
      dispatchReview({ type: 'detected', page: p.page, grids, ids: grids.map(newId) });
    }
    const added = reviewStore.getState().doc.tables.length - before;
    const first = ordered(reviewStore.getState().doc.tables)[0];
    if (!reviewStore.getState().selectedId && first) selectTable(first.id);
    reviewStore.setState({ detecting: null });
    announce(
      added
        ? t('tables.review.found', { count: added })
        : t('tables.review.none', { count: pages.length }),
    );
  } catch (err) {
    fail(err, controller, 'tables.review.detect');
    reviewStore.setState({ detecting: null });
  } finally {
    if (detectJob === controller) detectJob = null;
  }
}

function fail(err: unknown, controller: AbortController, where: string): void {
  if (controller.signal.aborted) return;
  const denied = err instanceof RpcError && err.code.startsWith(DENIED);
  // Content-free (rule 10): the error's code and message are ours.
  if (!denied) recordError(where, err);
  reviewStore.setState({ error: denied ? 'denied' : 'failed' });
}

// ---- the selected table, dragging --------------------------------------------------

/** The grid shown for a table: the drag in progress, else its committed grid. */
export function gridOf(s: ReviewState, id: string): TableGrid | null {
  if (s.drag?.id === id) return s.drag.grid;
  return s.doc.tables.find((x) => x.id === id)?.grid ?? null;
}

/** A divider is being dragged: shown and previewed, committed on release. */
export function dragGrid(id: string, grid: TableGrid): void {
  reviewStore.setState({ drag: { id, grid } });
  requestPreview();
}

export function endDrag(commit: boolean): void {
  const { drag } = reviewStore.getState();
  reviewStore.setState({ drag: null });
  if (drag && commit) dispatchReview({ type: 'edit', id: drag.id, grid: drag.grid });
  else requestPreview();
}

/** An edit of a table's grid (keyboard, menus): one undo step. */
export function editGrid(id: string, grid: TableGrid): void {
  dispatchReview({ type: 'edit', id, grid });
}

/** Focuses the selected table's first divider (the panel's "Edit Dividers"). */
export function focusDividers(): void {
  document.querySelector<HTMLElement>('[data-table-divider]')?.focus();
}

// ---- drawing ----------------------------------------------------------------------

/** Smallest table drawn (points). */
export const MIN_DRAWN = 8;

export function addDrawn(page: number, box: Box): void {
  const [x0, y0, x1, y1] = box;
  if (x1 - x0 < MIN_DRAWN || y1 - y0 < MIN_DRAWN) return;
  const id = newId();
  dispatchReview({ type: 'add', table: { id, grid: makeGrid(page, box, 1, 1), accepted: true } });
  reviewStore.setState({ keyRect: null, tool: 'adjust' });
  selectTable(id);
  announce(t('tables.review.drawn'));
}

/** Starts the keyboard rectangle at the page's centre (M4-Q10). */
export function startKeyRect(
  page: number,
  size: { width: number; height: number },
  origin: { x: number; y: number },
): void {
  const w = Math.min(200, size.width / 2);
  const h = Math.min(120, size.height / 2);
  const cx = origin.x + size.width / 2;
  const cy = origin.y + size.height / 2;
  reviewStore.setState({
    tool: 'draw',
    keyRect: { page, box: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2] },
  });
}

/** Moves (or with `resize`, grows) the keyboard rectangle by (dx, dy) points. */
export function nudgeKeyRect(dx: number, dy: number, resize: boolean): void {
  const r = reviewStore.getState().keyRect;
  if (!r) return;
  const [x0, y0, x1, y1] = r.box;
  const box: Box = resize
    ? [x0, Math.min(y0 - dy, y1 - MIN_DRAWN), Math.max(x1 + dx, x0 + MIN_DRAWN), y1]
    : [x0 + dx, y0 + dy, x1 + dx, y1 + dy];
  reviewStore.setState({ keyRect: { page: r.page, box } });
}

export function commitKeyRect(): void {
  const r = reviewStore.getState().keyRect;
  if (r) addDrawn(r.page, r.box);
}

export function cancelKeyRect(): void {
  reviewStore.setState({ keyRect: null, tool: 'adjust' });
}

// ---- preview ------------------------------------------------------------------------

const CACHED = 64;
const cache = new Map<string, TableData>();
let inFlight = false;

/** Fetches the cells of the selected table's current grid, unless cached. */
export function requestPreview(): void {
  const s = reviewStore.getState();
  const id = s.selectedId;
  const grid = id ? gridOf(s, id) : null;
  if (!s.docId || !id || !grid) {
    if (s.preview) reviewStore.setState({ preview: null });
    return;
  }
  const key = JSON.stringify(grid);
  const hit = cache.get(key);
  if (hit) {
    if (s.preview?.key !== key) reviewStore.setState({ preview: { id, key, data: hit } });
    return;
  }
  // One request at a time; when it returns, the then-current grid is asked for.
  if (inFlight) return;
  inFlight = true;
  const docId = s.docId;
  workClient()
    .run('tableCells', { docId, grids: [grid] })
    .promise.then(
      (r) => {
        const data = r.tables[0];
        if (data) {
          cache.set(key, data);
          while (cache.size > CACHED) {
            const first = cache.keys().next().value;
            if (first === undefined) break;
            cache.delete(first);
          }
        }
      },
      (err: unknown) => {
        if (reviewStore.getState().docId === docId) recordError('tables.review.preview', err);
      },
    )
    .finally(() => {
      inFlight = false;
      if (reviewStore.getState().docId === docId) requestPreview();
    });
}

/** Forgets cached cells (the document changed). */
export function clearPreviewCache(): void {
  cache.clear();
}

// ---- export ---------------------------------------------------------------------------

export function cancelReviewExport(): void {
  exportJob?.abort();
}

/** Exports the accepted tables in reading order. */
export async function exportReview(format: TableFormat): Promise<void> {
  const { docId, doc, exporting } = reviewStore.getState();
  const d = docId ? documentStore.getState().docs[docId] : undefined;
  const grids = ordered(doc.tables.filter((x) => x.accepted)).map((x) => x.grid);
  if (!docId || !d || exporting || !grids.length) return;
  const controller = new AbortController();
  exportJob = controller;
  reviewStore.setState({ exporting: true, error: null });
  try {
    const written = await writeTables(
      docId,
      baseNameOf(d.meta.name),
      { grids },
      format,
      controller.signal,
    );
    if (written) announce(t('tables.review.exported', { count: grids.length }));
  } catch (err) {
    fail(err, controller, 'tables.review.export');
  } finally {
    if (exportJob === controller) exportJob = null;
    reviewStore.setState({ exporting: false });
  }
}
