// Each file's last view (M11-08·O3, D-53, §10.3): the page, zoom, layout and
// view rotation, kept on this device by the fingerprint of the file as it is
// on disk (never its name or content) and restored when that file is opened
// again. A view is written about a second after it last changed, when the tab
// closes and when the page is hidden; a save moves it to the saved file's new
// fingerprint, so an edited and saved file still opens where it was left.
//
// Restoring waits for the tab to be shown (a file opened in the background is
// restored when its tab is first selected); the pages stay transparent until
// the view is in place, so the first page does not flash before the jump.
import { createStore, useStore } from 'zustand';
import { recordError } from '../../app/diagnostics';
import {
  DEFAULT_VIEW,
  documentStore,
  type DocumentsState,
  type ViewState,
} from '../../app/store/documentStore';
import { storageClient } from '../../engine/storageClient';
import { appDb } from '../../storage/appDb';
import { goToPage, setViewMode, setViewRotation, setZoom } from './controller';
import { fitToDocument, lastViewOf, parseLastView, sameView, type LastView } from './lastViewModel';

/** A view is written this long after it last changed. */
export const WRITE_DELAY_MS = 1000;
/** How long a restore may wait for the tab's pages to be laid out. */
const LAYOUT_WAIT_MS = 5000;

/** docId → fingerprint of the file as it is on disk now (the key its view is kept under). */
const keys = new Map<string, string>();
/** docId → the record last written or read, so an unchanged view is not written again. */
const written = new Map<string, LastView>();
/** docId → the view to restore when its tab is shown. */
const pending = new Map<string, LastView>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const running = new Set<string>();

/** Documents whose last view is still to be put in place (their pages are hidden meanwhile). */
const restoringStore = createStore<{ ids: ReadonlySet<string> }>()(() => ({ ids: new Set() }));

function setRestoring(docId: string, on: boolean): void {
  const ids = new Set(restoringStore.getState().ids);
  if (on === ids.has(docId)) return;
  if (on) ids.add(docId);
  else ids.delete(docId);
  restoringStore.setState({ ids });
}

/** True while the document's last view is being restored. */
export function useRestoringView(docId: string): boolean {
  return useStore(restoringStore, (s) => s.ids.has(docId));
}

/** The view stored for a file, or null (none, unreadable, or the store is unavailable). */
export async function readLastView(fp: string): Promise<LastView | null> {
  try {
    return parseLastView(await (await appDb()).getLastView(fp));
  } catch (err) {
    recordError('lastView', err);
    return null;
  }
}

/**
 * A document has opened (before its tab is shown): its views are kept under `fp`, and
 * `last` (read with readLastView) is restored when the tab is first shown.
 */
export function trackView(
  docId: string,
  fp: string,
  last: LastView | null,
  pageCount: number,
): void {
  keys.set(docId, fp);
  if (!last) return;
  written.set(docId, last);
  const view = fitToDocument(last, pageCount);
  if (sameView(DEFAULT_VIEW, view)) return; // nothing to restore
  pending.set(docId, view);
  setRestoring(docId, true);
}

/**
 * The document's tab is shown (DocumentView mounted): put its last view in place.
 * If the user switches tabs before it is done, it is finished the next time.
 */
export async function restorePending(docId: string): Promise<void> {
  const view = pending.get(docId);
  if (!view || running.has(docId)) return;
  running.add(docId);
  try {
    const shown = await waitForPages(docId);
    if (shown === 'gone') return;
    if (shown === 'timeout') {
      pending.delete(docId); // never laid out: show the document as it is
      return;
    }
    if (await applyView(docId, view)) pending.delete(docId);
  } catch (err) {
    recordError('lastView', err);
    pending.delete(docId);
  } finally {
    running.delete(docId);
    if (!pending.has(docId)) setRestoring(docId, false);
  }
}

/** Shown in its own tab (a comparison's windows keep their own place, S27 change 7). */
const isShown = (docId: string): boolean => documentStore.getState().activeTab === docId;

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function waitForPages(docId: string): Promise<'ready' | 'gone' | 'timeout'> {
  const selector = `#document-panel .viewport[data-doc-id="${docId}"] [data-page]`;
  for (let waited = 0; waited < LAYOUT_WAIT_MS; waited += 50) {
    if (!isShown(docId)) return 'gone';
    if (document.querySelector(selector)) return 'ready';
    await pause(50);
  }
  return 'timeout';
}

/** Layout, rotation, zoom, then the page (re-asserted while layout and zoom settle). */
async function applyView(docId: string, view: LastView): Promise<boolean> {
  const current = (): ViewState | undefined => documentStore.getState().docs[docId]?.view;
  if (current()?.mode !== view.mode) setViewMode(view.mode);
  if (current()?.rotation !== view.rotation) setViewRotation(view.rotation);
  if (current()?.zoom !== view.zoom) await setZoom(view.zoom);
  let settled = 0;
  for (let i = 0; i < 30 && settled < 2; i++) {
    if (!isShown(docId)) return false;
    if (current()?.page === view.page) settled++;
    else {
      settled = 0;
      goToPage(view.page);
    }
    await pause(100);
  }
  return isShown(docId);
}

async function write(docId: string): Promise<void> {
  const fp = keys.get(docId);
  const view = documentStore.getState().docs[docId]?.view;
  // Not restored yet: the store still holds the default view, not the user's.
  if (!fp || !view || pending.has(docId)) return;
  const record = lastViewOf(view, Date.now());
  if (sameView(written.get(docId), record)) return;
  written.set(docId, record);
  try {
    await (await appDb()).putLastView(fp, record);
  } catch (err) {
    recordError('lastView', err);
  }
}

function flush(docId: string): void {
  const timer = timers.get(docId);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(docId);
  void write(docId);
}

/** The tab is closing: write its view now and forget it. Call before the store drops it. */
export function forgetView(docId: string): void {
  flush(docId);
  keys.delete(docId);
  written.delete(docId);
  pending.delete(docId);
  setRestoring(docId, false);
}

/**
 * The document's file was written (Ctrl+S, Save As, Save Optimized): the file on disk
 * has a new fingerprint, so its view is kept under that from now on.
 */
export async function fileWritten(docId: string, file: File): Promise<void> {
  if (!keys.has(docId)) return;
  try {
    const fp = await storageClient().call('fingerprint', { file }).promise;
    if (!keys.has(docId)) return; // closed meanwhile
    keys.set(docId, fp);
    written.delete(docId);
    flush(docId);
  } catch (err) {
    recordError('lastView', err);
  }
}

/** Follows the document store: a changed view is written WRITE_DELAY_MS later. */
export function installLastViews(): () => void {
  let prev = documentStore.getState();
  const onChange = (next: DocumentsState): void => {
    for (const [id, d] of Object.entries(next.docs)) {
      const before = prev.docs[id]?.view;
      if (!keys.has(id) || before === d.view) continue;
      if (sameView(before, d.view)) continue; // only the resolved scale of a fit mode changed
      const timer = timers.get(id);
      if (timer !== undefined) clearTimeout(timer);
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          void write(id);
        }, WRITE_DELAY_MS),
      );
    }
    prev = next;
  };
  const off = documentStore.subscribe(onChange);
  // Leaving or hiding the app: write what is waiting.
  const onHide = (): void => {
    for (const id of [...timers.keys()]) flush(id);
  };
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') onHide();
  };
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    off();
    window.removeEventListener('pagehide', onHide);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
