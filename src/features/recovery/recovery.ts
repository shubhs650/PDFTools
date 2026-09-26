// OPFS crash recovery (M1-24, §4.3, D-05, ADR-001 B11, rule 7). After the
// first edit a document's original bytes are stored once; ~5 s after the last
// edit a snapshot of the tail (every committed tail since open + the narrow
// tail of what is unsaved, from the Render worker — never a full
// re-serialization) and the view state goes to OPFS through the storage
// worker. A save or a close clears it. At launch, each snapshot can be
// recovered (reopened dirty, without a handle, or re-linked to its file) or
// discarded. Nothing here ever writes to the user's file.
import { createStore, useStore } from 'zustand';
import { recordError } from '../../app/diagnostics';
import { t } from '../../i18n';
import { documentStore, type DocumentsState } from '../../app/store/documentStore';
import { storageClient } from '../../engine/storageClient';
import type { Snapshot, UiState } from '../../storage/recoveryTypes';
import { appDb } from '../../storage/appDb';
import { ensurePermission } from '../../storage/fileAccess';
import { openFiles, type RecoveredOpen } from '../open/openDocument';
import { originalBlob, sources } from '../open/sources';
import { committedTails, phaseOf } from '../save/save';
import { isActive } from '../save/saveMachine';
import { goToPage, setViewMode, setZoom } from '../view/controller';
import { renderEngine } from '../view/host';
import type { ViewMode, ZoomSetting } from '../../app/store/documentStore';
import {
  Debouncer,
  INITIAL,
  SNAPSHOT_DELAY_MS,
  transition,
  type SnapshotEvent,
  type SnapshotState,
} from './lifecycle';
import { relinkCandidate, verifyRelink } from './relink';

interface RecoveryStoreState {
  /** Snapshots found at launch that wait for Recover / Discard. */
  offers: Snapshot[];
}

export const recoveryStore = createStore<RecoveryStoreState>()(() => ({ offers: [] }));

export function useRecovery<T>(selector: (s: RecoveryStoreState) => T): T {
  return useStore(recoveryStore, selector);
}

const states = new Map<string, SnapshotState>();
/** Fingerprint per document, kept past close so the discard can still find it. */
const fps = new Map<string, string>();
/** Recovered documents → the snapshot they came from (cleared once superseded). */
const recoveredFrom = new Map<string, string>();
const debouncer = new Debouncer(SNAPSHOT_DELAY_MS, (docId) => {
  apply(docId, { type: 'due' });
});

function apply(docId: string, event: SnapshotEvent): void {
  const { state, effects } = transition(states.get(docId) ?? INITIAL, event);
  states.set(docId, state);
  for (const effect of effects) {
    if (effect === 'schedule') debouncer.schedule(docId);
    else if (effect === 'cancel-timer') debouncer.cancel(docId);
    else if (effect === 'write') void writeSnapshot(docId);
    else void discardFor(docId);
  }
  if (state === INITIAL && effects.length > 0) states.delete(docId);
}

/** Small, content-free view state (§4.3: tab order, page, zoom, view mode). */
function uiStateOf(docId: string): UiState {
  const s = documentStore.getState();
  const d = s.docs[docId];
  if (!d) return {};
  return {
    name: d.meta.name,
    tab: s.order.indexOf(docId),
    page: d.view.page,
    zoom: d.view.zoom,
    mode: d.view.mode,
  };
}

async function writeSnapshot(docId: string): Promise<void> {
  const src = sources.get(docId);
  if (!src) {
    apply(docId, { type: 'failed' });
    return;
  }
  // A save in progress would clear the snapshot anyway; try after it.
  if (isActive(phaseOf(docId))) {
    apply(docId, { type: 'failed' });
    return;
  }
  try {
    const storage = storageClient();
    const fp = src.fingerprint;
    fps.set(docId, fp);
    await storage.call('putOriginal', { fp, source: await originalBlob(docId) }).promise;
    const { tail } = await renderEngine().rpc.call('snapshotTail', { docId }).promise;
    const blob = new Blob([...committedTails(docId), tail]);
    await storage.call('writeTail', { fp, tail: blob, ui: uiStateOf(docId) }).promise;
    // A recovered document now has its own snapshot: the one it came from can go.
    const from = recoveredFrom.get(docId);
    if (from && from !== fp) {
      recoveredFrom.delete(docId);
      await storage.call('discard', { fp: from }).promise;
    }
    apply(docId, { type: 'written' });
  } catch (err) {
    recordError('recovery', err);
    apply(docId, { type: 'failed' });
  }
}

async function discardFor(docId: string): Promise<void> {
  const fp = fps.get(docId);
  try {
    if (fp) await storageClient().call('discard', { fp }).promise;
  } catch (err) {
    recordError('recovery', err);
  }
}

/** Nothing unsaved any more: drop its snapshot and the one it was recovered from. */
function clearFor(docId: string): void {
  apply(docId, { type: 'clear' });
  const from = recoveredFrom.get(docId);
  if (!from) return;
  recoveredFrom.delete(docId);
  void storageClient()
    .call('discard', { fp: from })
    .promise.catch((err: unknown) => {
      recordError('recovery', err);
    });
}

/**
 * Follows the document store: an edit (the edit counter rises) schedules a
 * snapshot; a save (dirty → clean) or a close clears it.
 */
export function installRecovery(): () => void {
  let prev = documentStore.getState();
  const onChange = (next: DocumentsState): void => {
    for (const [id, d] of Object.entries(next.docs)) {
      const before = prev.docs[id];
      if (d.edits > (before?.edits ?? 0)) apply(id, { type: 'edit' });
      else if (before?.dirty && !d.dirty) clearFor(id); // saved
    }
    // Closed (after a save, or "Don't save").
    for (const id of Object.keys(prev.docs)) if (!next.docs[id]) clearFor(id);
    prev = next;
  };
  const off = documentStore.subscribe(onChange);
  // §4.3: leaving the page asks only while something is unsaved.
  const beforeUnload = (e: BeforeUnloadEvent): void => {
    if (!hasUnsaved()) return;
    e.preventDefault();
  };
  window.addEventListener('beforeunload', beforeUnload);
  return () => {
    off();
    window.removeEventListener('beforeunload', beforeUnload);
  };
}

export function hasUnsaved(): boolean {
  return Object.values(documentStore.getState().docs).some((d) => d.dirty);
}

/** At launch: offer every snapshot not belonging to an open document. */
export async function findSnapshots(): Promise<Snapshot[]> {
  let list: Snapshot[];
  try {
    list = await storageClient().call('list', null).promise;
  } catch (err) {
    recordError('recovery', err);
    return [];
  }
  const open = new Set([...sources.values()].map((s) => s.fingerprint));
  const offers = list
    .filter((s) => !open.has(s.fp))
    .sort((a, b) => Number(a.ui?.['tab'] ?? 0) - Number(b.ui?.['tab'] ?? 0));
  recoveryStore.setState({ offers });
  return offers;
}

function dropOffer(fp: string): void {
  recoveryStore.setState((s) => ({ offers: s.offers.filter((o) => o.fp !== fp) }));
}

export async function discardSnapshot(fp: string): Promise<void> {
  dropOffer(fp);
  await storageClient().call('discard', { fp }).promise;
}

const MODES = new Set<string>(['single', 'continuous', 'facing', 'continuousFacing']);

/** Reopens original + tail as a dirty tab and restores its view (§4.3). */
export async function recoverSnapshot(fp: string): Promise<string | undefined> {
  const { original, tail, ui } = await storageClient().call('read', { fp }).promise;
  const name = typeof ui?.['name'] === 'string' && ui['name'] ? ui['name'] : t('recovery.untitled');
  const file = new File([original, tail], name, { type: 'application/pdf' });
  const handle = await relink(fp);
  const req: RecoveredOpen = {
    file,
    recordRecent: false,
    ...(handle ? { handle, pendingPrefix: { bytes: tail, at: original.byteLength } } : {}),
  };
  const [id] = await openFiles([req]);
  dropOffer(fp);
  if (!id) return undefined;
  recoveredFrom.set(id, fp);
  documentStore.getState().markDirty(id);
  await restoreView(id, ui);
  return id;
}

/** The recent list's handle for this snapshot's file, if unchanged on disk and writable. */
async function relink(fp: string): Promise<FileSystemFileHandle | undefined> {
  try {
    const handle = relinkCandidate(await (await appDb()).listRecent(), fp);
    if (!handle || !(await ensurePermission(handle, 'readwrite'))) return undefined;
    return await verifyRelink(
      handle,
      fp,
      (file) => storageClient().call('fingerprint', { file }).promise,
    );
  } catch {
    return undefined;
  }
}

async function restoreView(docId: string, ui: UiState | undefined): Promise<void> {
  if (!ui) return;
  // Wait until the tab's first page is on screen (the view controller acts on it).
  for (let i = 0; i < 100; i++) {
    const ready =
      documentStore.getState().activeId === docId &&
      document.querySelector('#document-panel [data-page="0"]') !== null;
    if (ready) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (typeof ui['mode'] === 'string' && MODES.has(ui['mode'])) setViewMode(ui['mode'] as ViewMode);
  const zoom = ui['zoom'] as ZoomSetting | null | undefined;
  const current = documentStore.getState().docs[docId]?.view.zoom;
  if (zoom !== current) {
    if (typeof zoom === 'number') await setZoom(zoom);
    else if (zoom === 'fitPage' || zoom === 'fitWidth' || zoom === 'fitVisible')
      await setZoom(zoom);
  }
  const page = ui['page'];
  if (typeof page !== 'number') return;
  // Layout and zoom settle asynchronously and can move the view: re-assert the page.
  for (let i = 0; i < 20; i++) {
    if (documentStore.getState().activeId !== docId) return;
    goToPage(page);
    await new Promise((r) => setTimeout(r, 100));
    if (documentStore.getState().docs[docId]?.view.page === page) return;
  }
}
