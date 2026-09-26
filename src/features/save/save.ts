// Ctrl+S and Save As (M1-22, §4.2, D-06, rule 7). Ctrl+S appends the verified
// incremental tail (M1-21) to the file's own handle; without a handle (a
// dropped file, Firefox/Safari) it acts as Save As. Save As writes original +
// every tail since open to a new file, which then becomes the document's file
// (on the fallback path it downloads a copy). Nothing is written until the
// tail verified; an abort before commit leaves the file untouched.
import { createStore, useStore } from 'zustand';
import { recordError } from '../../app/diagnostics';
import { documentStore } from '../../app/store/documentStore';
import { isAbortError, RpcError } from '../../engine/errors';
import { finishSave, prepareSave, SaveVerifyError, type PreparedSave } from '../../engine/saveFlow';
import {
  accessStrategy,
  appendToHandle,
  downloadBytes,
  ensurePermission,
  FileChangedError,
  pickSaveTarget,
  writeToHandle,
} from '../../storage/fileAccess';
import { originalBlob, sources } from '../open/sources';
import { saveDeps } from './deps';
import {
  IDLE,
  isActive,
  transition,
  type SaveErrorKind,
  type SaveEvent,
  type SavePhase,
} from './saveMachine';

interface SaveStoreState {
  phases: Record<string, SavePhase>;
  /** The last failure, for the error dialog (one at a time). */
  failure: { docId: string; kind: SaveErrorKind } | null;
}

export const saveStore = createStore<SaveStoreState>()(() => ({ phases: {}, failure: null }));

export function useSave<T>(selector: (s: SaveStoreState) => T): T {
  return useStore(saveStore, selector);
}

export const phaseOf = (docId: string): SavePhase => saveStore.getState().phases[docId] ?? IDLE;

const controllers = new Map<string, AbortController>();
/** Tails committed since open, per document: Save As copies original + these. */
const committed = new Map<string, ArrayBuffer[]>();

/** A failure with a known user-facing reason. */
class SaveFailure extends Error {
  readonly kind: SaveErrorKind;
  constructor(kind: SaveErrorKind) {
    super(kind);
    this.kind = kind;
  }
}

function emit(docId: string, event: SaveEvent): SavePhase {
  const next = transition(phaseOf(docId), event);
  saveStore.setState((s) => ({
    phases: { ...s.phases, [docId]: next },
    failure: next.phase === 'error' ? { docId, kind: next.kind } : s.failure,
  }));
  const docs = documentStore.getState();
  if (isActive(next)) docs.setSaveState(docId, 'saving');
  else if (next.phase === 'error') docs.setSaveState(docId, 'error');
  else docs.setSaveState(docId, 'idle');
  return next;
}

function errorKind(err: unknown): SaveErrorKind | 'cancelled' {
  if (err instanceof SaveFailure) return err.kind;
  if (isAbortError(err) || (err as DOMException | undefined)?.name === 'AbortError') {
    return 'cancelled';
  }
  if (err instanceof FileChangedError) return 'file-changed';
  if (err instanceof SaveVerifyError) return 'verify-failed';
  if (err instanceof RpcError && err.code === 'save-needs-rewrite') return 'needs-rewrite';
  const name = (err as DOMException | undefined)?.name;
  if (name === 'NotFoundError') return 'missing';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission-denied';
  recordError('save', err);
  return 'write-failed';
}

type Writer = (prepared: PreparedSave | null, signal: AbortSignal) => Promise<void>;

/**
 * prepare (save + verify) → write → commit. `write` receives null when nothing
 * changed (Ctrl+S then does nothing; Save As still writes a copy).
 */
async function run(docId: string, write: Writer, writeWhenUnchanged: boolean): Promise<SavePhase> {
  if (isActive(phaseOf(docId))) return phaseOf(docId);
  const ac = new AbortController();
  controllers.set(docId, ac);
  const editsAtStart = documentStore.getState().docs[docId]?.edits ?? 0;
  emit(docId, { type: 'start' });
  try {
    const deps = saveDeps();
    const prepared = await prepareSave(docId, deps, {
      signal: ac.signal,
      onVerify: () => emit(docId, { type: 'verifying' }),
    });
    if (!prepared && !writeWhenUnchanged) {
      documentStore.getState().markSaved(docId, 0, editsAtStart);
      return emit(docId, { type: 'nothing-to-save' });
    }
    ac.signal.throwIfAborted();
    emit(docId, { type: 'writing' });
    await write(prepared, ac.signal);
    // Written: from here on the save cannot be cancelled.
    const appended = prepared?.tail.byteLength ?? 0;
    if (prepared) {
      await finishSave(prepared, deps);
      committed.set(docId, [...(committed.get(docId) ?? []), prepared.tail]);
    }
    documentStore.getState().markSaved(docId, appended, editsAtStart);
    return emit(docId, { type: 'written', appended });
  } catch (err) {
    const kind = errorKind(err);
    return emit(docId, kind === 'cancelled' ? { type: 'cancel' } : { type: 'fail', kind });
  } finally {
    controllers.delete(docId);
  }
}

/** Everything saved so far plus `tail`: the whole file, as a Blob (no main-thread copy). */
async function wholeFile(docId: string, tail: ArrayBuffer | undefined): Promise<Blob> {
  const parts: BlobPart[] = [await originalBlob(docId), ...(committed.get(docId) ?? [])];
  if (tail) parts.push(tail);
  return new Blob(parts, { type: 'application/pdf' });
}

/** Ctrl+S (§4.2). */
export async function save(docId: string): Promise<SavePhase> {
  const src = sources.get(docId);
  if (!src) return phaseOf(docId);
  const { handle } = src;
  if (!handle || accessStrategy() !== 'fsa') return saveAs(docId);
  return run(
    docId,
    async (p, signal) => {
      if (!p) return;
      if (!(await ensurePermission(handle, 'readwrite')))
        throw new SaveFailure('permission-denied');
      await appendToHandle(handle, p.baseLength, new Uint8Array(p.tail), signal);
      src.written = true;
    },
    false,
  );
}

/** Save As (§4.2): a full incremental copy to a new file, which becomes the document's file. */
export async function saveAs(docId: string): Promise<SavePhase> {
  const src = sources.get(docId);
  const name = documentStore.getState().docs[docId]?.meta.name;
  if (!src || name === undefined || isActive(phaseOf(docId))) return phaseOf(docId);
  if (accessStrategy() !== 'fsa') {
    return run(
      docId,
      async (p) => {
        downloadBytes(await wholeFile(docId, p?.tail), name);
      },
      true,
    );
  }
  // The picker first: it needs the user's gesture (Ctrl+Shift+S, a click).
  let target: FileSystemFileHandle | undefined;
  try {
    target = await pickSaveTarget(name);
  } catch (err) {
    recordError('save', err);
  }
  if (!target) return phaseOf(docId);
  const handle = target;
  return run(
    docId,
    async (p, signal) => {
      await writeToHandle(handle, await wholeFile(docId, p?.tail), signal);
      src.handle = handle;
      src.written = true;
      documentStore.getState().rename(docId, handle.name);
    },
    true,
  );
}

/** Cancels a save that has not committed yet (the file stays untouched). */
export function cancelSave(docId: string): void {
  controllers.get(docId)?.abort();
}

export function dismissSaveFailure(): void {
  saveStore.setState({ failure: null });
}

/** Called when a document closes. */
export function forgetSaveState(docId: string): void {
  cancelSave(docId);
  committed.delete(docId);
  saveStore.setState((s) => {
    const phases = Object.fromEntries(Object.entries(s.phases).filter(([k]) => k !== docId));
    return { phases, failure: s.failure?.docId === docId ? null : s.failure };
  });
}
