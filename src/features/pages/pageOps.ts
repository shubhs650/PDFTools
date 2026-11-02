// Page operations on the main thread (M4-09 … M4-11, §7.8, ADR-016): the
// Render worker does the work (rule 1); here each operation is orchestrated:
// an undo snapshot first, the operation with progress and Cancel (rule 2; a
// cancelled or failed operation is rolled back from the snapshot), then the
// Work worker's copy, the viewer and every per-page cache follow (ADR-016
// decision 6), and the operation becomes one step in the document's undo
// timeline, shared with annotations (M4-Q1). Undo reopens the document from
// its snapshot; redo runs the operation again.
import { refreshPages, setDocumentLoaded } from '@embedpdf/core';
import type { PdfDocumentObject, PdfPageObject } from '@embedpdf/models';
import type { HistoryCapability } from '@embedpdf/plugin-history';
import { createStore, useStore } from 'zustand';
import { recordError } from '../../app/diagnostics';
import { documentStore, securityOf } from '../../app/store/documentStore';
import { isAbortError } from '../../engine/errors';
import type { PageInfo, PageOp } from '../../engine/renderApi';
import type { FlattenCounts, FlattenPage } from '../../workers/render/flatten';
import type { TransferObject } from '../../workers/work/transferJobs';
import { msg, type MessageKey } from '../../i18n';
import { allows, type Capability } from '../../model/permissions';
import { annotationCapability } from '../annotate/selection';
import { phaseOf } from '../save/save';
import { isActive } from '../save/saveMachine';
import { editsSettled, setPageOpProbe } from '../save/pendingEdits';
import { goToPage } from '../view/controller';
import { capability, hostStore, renderEngine, startedWorkClient } from '../view/host';
import { changedPages } from './changed';
import { invalidatePages } from './invalidate';
import { remapPageSelection } from './selection';

/** What one undo step does again on redo: a page operation, or copied objects (M4-20/21). */
export type Change =
  | { kind: 'op'; op: PageOp }
  | {
      kind: 'objects';
      objects: TransferObject[];
      firstNew: number;
      /** What the objects need (rule 9): annotate (comments) or modify (OCR, M5). */
      capability?: Capability;
    };

export interface Busy {
  docId: string;
  label: MessageKey;
  done: number;
  total: number;
  started: number;
}

interface PagesState {
  busy: Busy | null;
  /** Bumped per document after each page change: per-page panes re-read. */
  version: Record<string, number>;
  error: MessageKey | null;
  /** A signed document waits for "change pages anyway?" (signatures show "changed after signing"). */
  signedPrompt: string | null;
  /** Said by the Thumbnails pane's live region (a move's new position, M4-10). */
  announcement: string | null;
}

export const pagesStore = createStore<PagesState>()(() => ({
  busy: null,
  version: {},
  error: null,
  signedPrompt: null,
  announcement: null,
}));

export function usePages<T>(selector: (s: PagesState) => T): T {
  return useStore(pagesStore, selector);
}

export const pagesVersion = (docId: string): number => pagesStore.getState().version[docId] ?? 0;

/** A page operation (or its undo) is running on this document. */
export function pagesBusy(docId?: string): boolean {
  const b = pagesStore.getState().busy;
  return b !== null && (docId === undefined || b.docId === docId);
}

setPageOpProbe((docId) => pagesBusy(docId));

let cancelRunning: (() => void) | null = null;

export function cancelPageOp(): void {
  cancelRunning?.();
}

let announceTimer: ReturnType<typeof setTimeout> | undefined;

/** Said once by the Thumbnails pane's live region, then cleared. */
export function announce(text: string | null): void {
  clearTimeout(announceTimer);
  pagesStore.setState({ announcement: text });
  if (text)
    announceTimer = setTimeout(() => {
      pagesStore.setState({ announcement: null });
    }, 5000);
}

export function dismissPagesError(): void {
  pagesStore.setState({ error: null });
}

// ---- signed documents --------------------------------------------------------------

/** Documents whose "signed" warning was accepted this session. */
const signedAccepted = new Set<string>();
let signedAnswer: ((ok: boolean) => void) | null = null;

function confirmSigned(docId: string): Promise<boolean> {
  if (signedAccepted.has(docId)) return Promise.resolve(true);
  return new Promise((resolve) => {
    signedAnswer = resolve;
    pagesStore.setState({ signedPrompt: docId });
  });
}

export function answerSigned(ok: boolean): void {
  const docId = pagesStore.getState().signedPrompt;
  pagesStore.setState({ signedPrompt: null });
  if (ok && docId) signedAccepted.add(docId);
  signedAnswer?.(ok);
  signedAnswer = null;
}

// ---- the operation -----------------------------------------------------------------

/** Why a page command can't run on the document now (null: it can). */
export function pageOpBlocked(docId: string): MessageKey | null {
  const d = documentStore.getState().docs[docId];
  if (!d) return msg('pages.noDocument');
  if (!allows(securityOf(d.meta), 'assemble')) return msg('pages.restricted');
  if (pagesBusy()) return msg('pages.busy');
  if (isActive(phaseOf(docId))) return msg('pages.saving');
  return null;
}

/**
 * Why comments can't be flattened now (null: they can; M6-09): the page
 * content changes (modify) and comments go (annotate), rule 9.
 */
export function flattenBlocked(docId: string): MessageKey | null {
  const d = documentStore.getState().docs[docId];
  if (!d) return msg('pages.noDocument');
  const sec = securityOf(d.meta);
  if (!allows(sec, 'modify') || !allows(sec, 'annotate')) return msg('flatten.restricted');
  if (pagesBusy()) return msg('pages.busy');
  if (isActive(phaseOf(docId))) return msg('pages.saving');
  return null;
}

const blockedFor = (docId: string, op: PageOp): MessageKey | null =>
  op.kind === 'flatten' ? flattenBlocked(docId) : pageOpBlocked(docId);

/** What a change did in the Render worker. */
interface Applied {
  pages: PageInfo[];
  flattened?: FlattenCounts;
}

/** Pages whose content a change rewrites without changing their identity (a flatten). */
const contentPages = (change: Change): number[] =>
  change.kind === 'op' && change.op.kind === 'flatten' ? change.op.pages.map((p) => p.page) : [];

function historyOf(docId: string) {
  const registry = hostStore.getState().registry;
  return registry ? capability<HistoryCapability>(registry, 'history').forDocument(docId) : null;
}

function coreStore() {
  const registry = hostStore.getState().registry;
  if (!registry) throw new Error('No viewer');
  return registry.getStore();
}

/** Pages either side of the shown one that are refreshed after a change (the rest lazily). */
const REFRESH_WINDOW = 10;

/** Tokens the Render worker dropped for its memory budget (their undo is gone). */
const evicted = new Set<number>();

function setBusy(busy: Busy | null): void {
  pagesStore.setState({ busy });
}

/** Annotation edits still on their way reach the Render worker before the operation. */
async function settleEdits(docId: string): Promise<void> {
  await editsSettled();
  const scope = annotationCapability()?.forDocument(docId);
  if (scope)
    await scope
      .commit()
      .toPromise()
      .catch(() => undefined);
}

/**
 * Runs `op` on the document as one undo step. Resolves true when it was
 * applied (false: blocked, declined, cancelled or failed with a message).
 */
export async function runPageOp(docId: string, op: PageOp, label: MessageKey): Promise<boolean> {
  return (await runOp(docId, op, label)) !== null;
}

/**
 * Flatten Comments as one undo step (M6-09): resolves with what was done, or
 * null when blocked, declined, cancelled or failed with a message.
 */
export async function runFlatten(
  docId: string,
  pages: FlattenPage[],
  label: MessageKey,
): Promise<FlattenCounts | null> {
  const r = await runOp(docId, { kind: 'flatten', pages }, label);
  return r ? (r.flattened ?? { flattened: 0, removed: 0, failed: 0 }) : null;
}

async function runOp(docId: string, op: PageOp, label: MessageKey): Promise<Applied | null> {
  if (blockedFor(docId, op)) return null;
  const meta = documentStore.getState().docs[docId]?.meta;
  if (meta && meta.signatureCount > 0 && !(await confirmSigned(docId))) return null;
  if (blockedFor(docId, op)) return null;
  setBusy({ docId, label, done: 0, total: 0, started: performance.now() });
  try {
    await settleEdits(docId);
    return await applyAsStep(docId, { kind: 'op', op }, label);
  } catch (err) {
    recordError('pages.op', err);
    pagesStore.setState({ error: msg('pages.failed') });
    return null;
  } finally {
    cancelRunning = null;
    setBusy(null);
  }
}

/** Snapshot, the change, everything following it, and one undo step. */
async function applyAsStep(
  docId: string,
  change: Change,
  label: MessageKey,
): Promise<Applied | null> {
  const rpc = renderEngine().rpc;
  const snap = await rpc.call('pagesSnapshot', { docId }).promise;
  for (const t of snap.dropped) evicted.add(t);
  let applied: Applied | null;
  try {
    applied = await apply(docId, change, label);
  } catch (err) {
    // Nothing was applied (copied objects refused): the snapshot is not needed.
    await rpc.call('pagesDrop', { tokens: [snap.token] }).promise;
    throw err;
  }
  if (!applied) {
    // Cancelled or failed part-way: back to the snapshot.
    await restore(docId, snap.token, contentPages(change));
    return null;
  }
  await afterChange(docId, applied.pages, contentPages(change));
  registerStep(docId, change, label, snap.token);
  documentStore.getState().markDirty(docId);
  return applied;
}

/**
 * Why objects can't be added to the document now (null: they can; rule 9):
 * comments need annotate, an OCR text layer modify (M5, ADR-020 d7).
 */
export function transferBlocked(
  docId: string,
  capability: Capability = 'annotate',
  restricted: MessageKey = msg('transfer.restricted'),
): MessageKey | null {
  const d = documentStore.getState().docs[docId];
  if (!d) return msg('pages.noDocument');
  if (!allows(securityOf(d.meta), capability)) return restricted;
  if (pagesBusy()) return msg('pages.busy');
  if (isActive(phaseOf(docId))) return msg('pages.saving');
  return null;
}

/** The Work worker's copy sees the document as it is now (unsaved edits as its live section). */
export async function syncLive(docId: string): Promise<void> {
  const work = startedWorkClient();
  if (!work?.has(docId)) return;
  const { tail } = await renderEngine().rpc.call('snapshotTail', { docId }).promise;
  await work.setLive(docId, tail);
}

export interface TransferProduct {
  objects: TransferObject[];
  firstNew: number;
}

/**
 * Comment transfer as one undo step (M4-20, M4-21, ADR-018): `produce` copies
 * the comments in the Work worker (its copy synced first) with progress and
 * Cancel; the Render worker applies the objects. When the document changed in
 * between (`transfer-stale`), the copy runs once more. Resolves true when
 * applied; null from `produce` (cancelled, nothing to copy) applies nothing.
 */
export async function runTransfer(
  docId: string,
  label: MessageKey,
  produce: (
    progress: (p: { done: number; total: number }) => void,
    onCancel: (cancel: () => void) => void,
  ) => Promise<TransferProduct | null>,
  need: { capability: Capability; restricted: MessageKey } = {
    capability: 'annotate',
    restricted: msg('transfer.restricted'),
  },
): Promise<boolean> {
  if (transferBlocked(docId, need.capability, need.restricted)) return false;
  setBusy({ docId, label, done: 0, total: 0, started: performance.now() });
  const progress = (p: { done: number; total: number }) => {
    const b = pagesStore.getState().busy;
    if (b) setBusy({ ...b, done: p.done, total: p.total });
  };
  const onCancel = (cancel: () => void) => {
    cancelRunning = cancel;
  };
  try {
    for (let attempt = 0; ; attempt++) {
      await settleEdits(docId);
      await syncLive(docId);
      const product = await produce(progress, onCancel);
      cancelRunning = null;
      if (!product || product.objects.length === 0) return false;
      try {
        return (
          (await applyAsStep(
            docId,
            { kind: 'objects', ...product, capability: need.capability },
            label,
          )) !== null
        );
      } catch (err) {
        if ((err as { code?: string }).code !== 'transfer-stale' || attempt > 0) throw err;
      }
    }
  } catch (err) {
    if (isAbortError(err) || (err as { code?: string }).code?.startsWith('cancelled')) return false;
    throw err;
  } finally {
    cancelRunning = null;
    setBusy(null);
  }
}

/** The change in the Render worker; null when cancelled or failed. */
async function apply(docId: string, change: Change, label: MessageKey): Promise<Applied | null> {
  if (change.kind === 'objects') {
    const { objects, firstNew, capability } = change;
    // A structured copy (nothing transferred): a redo sends the same objects again.
    const { pages } = await renderEngine().rpc.call('pagesApply', {
      docId,
      objects,
      firstNew,
      ...(capability === undefined ? {} : { capability }),
    }).promise;
    return { pages };
  }
  const job = renderEngine().rpc.call(
    'pagesOp',
    { docId, op: change.op },
    {
      onProgress: (p) => {
        const b = pagesStore.getState().busy;
        if (b?.docId === docId) setBusy({ ...b, label, done: p.done, total: p.total });
      },
    },
  );
  cancelRunning = () => {
    job.cancel();
  };
  try {
    const r = await job.promise;
    return r.flattened ? { pages: r.pages, flattened: r.flattened } : { pages: r.pages };
  } catch (err) {
    if (!isAbortError(err) && !(err as { code?: string }).code?.startsWith('cancelled')) {
      recordError('pages.op', err);
      pagesStore.setState({ error: msg('pages.failed') });
    }
    return null;
  }
}

async function restore(docId: string, token: number, content: readonly number[]): Promise<void> {
  const { pages } = await renderEngine().rpc.call('pagesRestore', { docId, token }).promise;
  await afterChange(docId, pages, content);
}

/**
 * Everything follows the new page list: the Work worker's copy (unsaved
 * changes as its live section), the viewer (ADR-016 finding 4: empty the
 * annotation store first, then the new document object), the per-page caches,
 * the tab's page count, the selection and the current page. `content`: pages
 * whose drawing changed in place (a flatten), redrawn like changed pages.
 */
async function afterChange(
  docId: string,
  pages: readonly PageInfo[],
  content: readonly number[] = [],
): Promise<void> {
  await syncLive(docId);
  const store = coreStore();
  const old = store.getState().core.documents[docId]?.document as PdfDocumentObject | undefined;
  if (!old) return;
  const after = new Map(pages.map((p) => [p.objectNumber, p.index]));
  const map = old.pages.map((p) => (p.objectNumber > 0 ? (after.get(p.objectNumber) ?? -1) : -1));
  const doc: PdfDocumentObject = {
    ...old,
    pageCount: pages.length,
    pages: pages.map((p) => ({ ...p }) as unknown as PdfPageObject),
  };
  const clearAnnotations: { type: string; payload: unknown } = {
    type: 'ANNOTATION/SET_ANNOTATIONS',
    payload: { documentId: docId, annotations: {} },
  };
  store.dispatch(clearAnnotations);
  if (pages.length === old.pages.length && pages.length > 1) {
    // Same page count, new order: EmbedPDF's scroll plugin compares its old and
    // new layout arrays order-insensitively, O(n²) — 100+ ms for 2,000 pages
    // (M4-10 perf). A one-page layout in between (same task, never painted)
    // makes both comparisons length mismatches.
    store.dispatch(
      setDocumentLoaded(docId, { ...doc, pageCount: 1, pages: doc.pages.slice(0, 1) }),
    );
  }
  store.dispatch(setDocumentLoaded(docId, doc));
  const docs = documentStore.getState();
  const current = docs.docs[docId]?.view.page ?? 0;
  const moved = map[current] ?? -1;
  const page = moved >= 0 ? moved : Math.min(current, pages.length - 1);
  // Only pages whose identity changed (copied comments change none: annotation
  // tiles are drawn from the annotation store, ADR-014). EmbedPDF's selection
  // plugin reloads the text geometry of every refreshed page at once — one
  // Work-worker job each, minutes for a 2,000-page reorder — while tiling only
  // redraws visible pages: so pages near the one shown are refreshed, and the
  // rest only lose their cached geometry (reloaded when text is selected there).
  const changed = [
    ...new Set([...changedPages(old.pages, pages), ...content.filter((i) => i < pages.length)]),
  ].sort((a, b) => a - b);
  const near = changed.filter((i) => Math.abs(i - page) <= REFRESH_WINDOW);
  if (changed.length) {
    const evict: { type: string; payload: unknown } = {
      type: 'SELECTION/EVICT_PAGE_GEOMETRY',
      payload: { documentId: docId, pages: changed },
    };
    store.dispatch(evict);
  }
  if (near.length) store.dispatch(refreshPages(docId, near));
  invalidatePages(docId);
  remapPageSelection(docId, map);
  docs.setPageCount(docId, pages.length);
  pagesStore.setState((s) => ({
    version: { ...s.version, [docId]: (s.version[docId] ?? 0) + 1 },
  }));
  if (docs.activeId === docId) {
    // After the viewer laid the new page list out.
    await new Promise((r) => requestAnimationFrame(r));
    goToPage(page);
  }
}

/** One step in the document's undo timeline (topic "pages"). */
function registerStep(docId: string, change: Change, label: MessageKey, token: number): void {
  const history = historyOf(docId);
  if (!history) return;
  let first = true;
  history.register(
    {
      execute: () => {
        if (first) {
          first = false;
          return;
        }
        void redo(docId, change, label);
      },
      undo: () => {
        void undo(docId, token, contentPages(change));
      },
      metadata: {
        pageOp:
          change.kind === 'op'
            ? change.op.kind
            : change.capability === 'modify'
              ? 'ocr'
              : 'transfer',
      },
    },
    'pages',
  );
}

async function undo(docId: string, token: number, content: readonly number[]): Promise<void> {
  if (evicted.has(token)) {
    pagesStore.setState({ error: msg('pages.undoGone') });
    return;
  }
  setBusy({ docId, label: msg('pages.undoing'), done: 0, total: 0, started: performance.now() });
  try {
    await settleEdits(docId);
    await restore(docId, token, content);
    documentStore.getState().markDirty(docId);
  } catch (err) {
    recordError('pages.undo', err);
    pagesStore.setState({ error: msg('pages.failed') });
  } finally {
    setBusy(null);
  }
}

async function redo(docId: string, change: Change, label: MessageKey): Promise<void> {
  setBusy({ docId, label, done: 0, total: 0, started: performance.now() });
  try {
    await settleEdits(docId);
    const applied = await apply(docId, change, label);
    if (!applied) return;
    await afterChange(docId, applied.pages, contentPages(change));
    documentStore.getState().markDirty(docId);
  } catch (err) {
    recordError('pages.redo', err);
    pagesStore.setState({ error: msg('pages.failed') });
  } finally {
    cancelRunning = null;
    setBusy(null);
  }
}

/**
 * A long page job that is not an operation on one document (Extract, Merge:
 * M4-11): the same progress dialog with Cancel. `job` gets a progress
 * reporter and hands back how to cancel.
 */
export async function runBusy<T>(
  docId: string,
  label: MessageKey,
  job: (
    progress: (p: { done: number; total: number }) => void,
    onCancel: (cancel: () => void) => void,
  ) => Promise<T>,
): Promise<T> {
  setBusy({ docId, label, done: 0, total: 0, started: performance.now() });
  try {
    return await job(
      (p) => {
        const b = pagesStore.getState().busy;
        if (b) setBusy({ ...b, done: p.done, total: p.total });
      },
      (cancel) => {
        cancelRunning = cancel;
      },
    );
  } finally {
    cancelRunning = null;
    setBusy(null);
  }
}

/** Shows a page-operation error (M4-11 jobs outside runPageOp). */
export function showPagesError(key: MessageKey): void {
  pagesStore.setState({ error: key });
}

export { settleEdits };
