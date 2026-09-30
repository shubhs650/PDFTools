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
import { msg, type MessageKey } from '../../i18n';
import { allows } from '../../model/permissions';
import { annotationCapability } from '../annotate/selection';
import { phaseOf } from '../save/save';
import { isActive } from '../save/saveMachine';
import { editsSettled, setPageOpProbe } from '../save/pendingEdits';
import { goToPage } from '../view/controller';
import { capability, hostStore, renderEngine, startedWorkClient } from '../view/host';
import { invalidatePages } from './invalidate';
import { remapPageSelection } from './selection';

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

function historyOf(docId: string) {
  const registry = hostStore.getState().registry;
  return registry ? capability<HistoryCapability>(registry, 'history').forDocument(docId) : null;
}

function coreStore() {
  const registry = hostStore.getState().registry;
  if (!registry) throw new Error('No viewer');
  return registry.getStore();
}

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
  if (pageOpBlocked(docId)) return false;
  const meta = documentStore.getState().docs[docId]?.meta;
  if (meta && meta.signatureCount > 0 && !(await confirmSigned(docId))) return false;
  if (pageOpBlocked(docId)) return false;
  setBusy({ docId, label, done: 0, total: 0, started: performance.now() });
  try {
    await settleEdits(docId);
    const rpc = renderEngine().rpc;
    const snap = await rpc.call('pagesSnapshot', { docId }).promise;
    for (const t of snap.dropped) evicted.add(t);
    const applied = await apply(docId, op, label);
    if (!applied) {
      // Cancelled or failed part-way: back to the snapshot.
      await restore(docId, snap.token);
      return false;
    }
    await afterChange(docId, applied);
    registerStep(docId, op, label, snap.token);
    documentStore.getState().markDirty(docId);
    return true;
  } catch (err) {
    recordError('pages.op', err);
    pagesStore.setState({ error: msg('pages.failed') });
    return false;
  } finally {
    cancelRunning = null;
    setBusy(null);
  }
}

/** The operation in the Render worker; null when cancelled or failed. */
async function apply(docId: string, op: PageOp, label: MessageKey): Promise<PageInfo[] | null> {
  const job = renderEngine().rpc.call(
    'pagesOp',
    { docId, op },
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
    return (await job.promise).pages;
  } catch (err) {
    if (!isAbortError(err) && !(err as { code?: string }).code?.startsWith('cancelled')) {
      recordError('pages.op', err);
      pagesStore.setState({ error: msg('pages.failed') });
    }
    return null;
  }
}

async function restore(docId: string, token: number): Promise<void> {
  const { pages } = await renderEngine().rpc.call('pagesRestore', { docId, token }).promise;
  await afterChange(docId, pages);
}

/**
 * Everything follows the new page list: the Work worker's copy (unsaved
 * changes as its live section), the viewer (ADR-016 finding 4: empty the
 * annotation store first, then the new document object), the per-page caches,
 * the tab's page count, the selection and the current page.
 */
async function afterChange(docId: string, pages: readonly PageInfo[]): Promise<void> {
  const rpc = renderEngine().rpc;
  const work = startedWorkClient();
  if (work?.has(docId)) {
    const { tail } = await rpc.call('snapshotTail', { docId }).promise;
    await work.setLive(docId, tail);
  }
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
  store.dispatch(
    refreshPages(
      docId,
      pages.map((p) => p.index),
    ),
  );
  invalidatePages(docId);
  remapPageSelection(docId, map);
  const docs = documentStore.getState();
  const current = docs.docs[docId]?.view.page ?? 0;
  const moved = map[current] ?? -1;
  docs.setPageCount(docId, pages.length);
  const page = moved >= 0 ? moved : Math.min(current, pages.length - 1);
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
function registerStep(docId: string, op: PageOp, label: MessageKey, token: number): void {
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
        void redo(docId, op, label);
      },
      undo: () => {
        void undo(docId, token);
      },
      metadata: { pageOp: op.kind },
    },
    'pages',
  );
}

async function undo(docId: string, token: number): Promise<void> {
  if (evicted.has(token)) {
    pagesStore.setState({ error: msg('pages.undoGone') });
    return;
  }
  setBusy({ docId, label: msg('pages.undoing'), done: 0, total: 0, started: performance.now() });
  try {
    await settleEdits(docId);
    await restore(docId, token);
    documentStore.getState().markDirty(docId);
  } catch (err) {
    recordError('pages.undo', err);
    pagesStore.setState({ error: msg('pages.failed') });
  } finally {
    setBusy(null);
  }
}

async function redo(docId: string, op: PageOp, label: MessageKey): Promise<void> {
  setBusy({ docId, label, done: 0, total: 0, started: performance.now() });
  try {
    await settleEdits(docId);
    const pages = await apply(docId, op, label);
    if (!pages) return;
    await afterChange(docId, pages);
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
