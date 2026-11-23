// Ctrl+S, Save As and Save Optimized (M1-22, M1-23, §4.2, D-06, rule 7).
// - Ctrl+S appends the verified incremental tail (M1-21) to the file's own
//   handle; without a handle (a dropped file, Firefox/Safari) it acts as
//   Save As. Once the file grew by > 30 % since open it first offers Save
//   Optimized (growth.ts).
// - Save As writes original + every tail since open to a new file, which then
//   becomes the document's file (on the fallback path it downloads a copy).
// - Save Optimized writes a full rewrite, to a new file by default or over the
//   original after confirmation; the rewritten file becomes the save base.
// Nothing is written until the bytes are final; an abort before the commit
// leaves the file untouched.
import { createStore, useStore } from 'zustand';
import { recordError } from '../../app/diagnostics';
import { documentStore, type DocumentSource } from '../../app/store/documentStore';
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
import { renderEngine, workClient } from '../view/host';
import { fileWritten } from '../view/lastView';
import { saveDeps } from './deps';
import { GrowthMemory, shouldOfferOptimize } from './growth';
import {
  IDLE,
  isActive,
  transition,
  type SaveErrorKind,
  type SaveEvent,
  type SavePhase,
} from './saveMachine';
import { editsSettled, pageOpRunning } from './pendingEdits';
import { annotationsSettled } from '../annotate/selection';

interface SaveStoreState {
  phases: Record<string, SavePhase>;
  /** Write progress 0…1 of the running save, when it is known (large writes). */
  progress: Record<string, number>;
  /** The last failure, for the error dialog (one at a time). */
  failure: { docId: string; kind: SaveErrorKind } | null;
  /** Ctrl+S is waiting on "Save Optimized instead?" for this document. */
  growthPrompt: string | null;
  /** The Save Optimized dialog is open for this document. */
  optimizePrompt: string | null;
}

export const saveStore = createStore<SaveStoreState>()(() => ({
  phases: {},
  progress: {},
  failure: null,
  growthPrompt: null,
  optimizePrompt: null,
}));

export function useSave<T>(selector: (s: SaveStoreState) => T): T {
  return useStore(saveStore, selector);
}

export const phaseOf = (docId: string): SavePhase => saveStore.getState().phases[docId] ?? IDLE;

const controllers = new Map<string, AbortController>();
/** Tails committed since open (or since the last optimized save), per document. */
const committed = new Map<string, ArrayBuffer[]>();
const growth = new GrowthMemory();

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
    progress: isActive(next) && next.phase === 'writing' ? s.progress : without(s.progress, docId),
    failure: next.phase === 'error' ? { docId, kind: next.kind } : s.failure,
  }));
  const docs = documentStore.getState();
  if (isActive(next)) docs.setSaveState(docId, 'saving');
  else if (next.phase === 'error') docs.setSaveState(docId, 'error');
  else docs.setSaveState(docId, 'idle');
  return next;
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

function reportProgress(docId: string): (done: number, total: number) => void {
  return (done, total) => {
    saveStore.setState((s) => ({
      progress: { ...s.progress, [docId]: total > 0 ? done / total : 1 },
    }));
  };
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

interface JobContext {
  signal: AbortSignal;
  editsAtStart: number;
}

/** One save job: state machine, cancel, error mapping. `job` returns the final event. */
async function runJob(
  docId: string,
  job: (ctx: JobContext) => Promise<SaveEvent>,
): Promise<SavePhase> {
  // A form value committed by the same key press (Ctrl+S in a field) goes first,
  // and so do comment edits still on their way (a text comment's, M7-02).
  await editsSettled();
  await annotationsSettled(docId);
  // A page operation in flight finishes first (its undo snapshot and reopen, M4-09).
  while (pageOpRunning(docId)) await new Promise((r) => setTimeout(r, 50));
  if (isActive(phaseOf(docId))) return phaseOf(docId);
  const ac = new AbortController();
  controllers.set(docId, ac);
  const editsAtStart = documentStore.getState().docs[docId]?.edits ?? 0;
  emit(docId, { type: 'start' });
  try {
    return emit(docId, await job({ signal: ac.signal, editsAtStart }));
  } catch (err) {
    const kind = errorKind(err);
    return emit(docId, kind === 'cancelled' ? { type: 'cancel' } : { type: 'fail', kind });
  } finally {
    controllers.delete(docId);
  }
}

type Writer = (prepared: PreparedSave | null, signal: AbortSignal) => Promise<void>;

/**
 * Incremental save job: prepare (save + verify) → write → commit. `write`
 * receives null when nothing changed (Ctrl+S then does nothing; Save As still
 * writes a copy).
 */
function incremental(docId: string, write: Writer, writeWhenUnchanged: boolean) {
  return runJob(docId, async ({ signal, editsAtStart }) => {
    const deps = saveDeps();
    const prepared = await prepareSave(docId, deps, {
      signal,
      onVerify: () => emit(docId, { type: 'verifying' }),
    });
    if (!prepared && !writeWhenUnchanged) {
      documentStore.getState().markSaved(docId, 0, editsAtStart);
      return { type: 'nothing-to-save' };
    }
    signal.throwIfAborted();
    emit(docId, { type: 'writing' });
    await write(prepared, signal);
    // Written: from here on the save cannot be cancelled.
    const appended = prepared?.tail.byteLength ?? 0;
    if (prepared) {
      await finishSave(prepared, deps);
      committed.set(docId, [...(committed.get(docId) ?? []), prepared.tail]);
    }
    documentStore.getState().markSaved(docId, appended, editsAtStart);
    return { type: 'written', appended };
  });
}

/** Everything saved so far plus `tail`: the whole file, as a Blob (no main-thread copy). */
async function wholeFile(docId: string, tail: ArrayBuffer | undefined): Promise<Blob> {
  const parts: BlobPart[] = [await originalBlob(docId), ...(committed.get(docId) ?? [])];
  if (tail) parts.push(tail);
  return new Blob(parts, { type: 'application/pdf' });
}

/**
 * Where Ctrl+S goes instead, when somewhere else decides (M12-20: in a
 * comparison it is Save review, which saves every document of the comparison,
 * or the comparison file a reopened comparison lives in). Null: save as usual.
 */
type SaveRedirect = (docId: string) => Promise<unknown> | null;
let redirect: SaveRedirect = () => null;

export function setSaveRedirect(fn: SaveRedirect): () => void {
  redirect = fn;
  return () => {
    if (redirect === fn) redirect = () => null;
  };
}

/** Ctrl+S on the document commands act on: redirected in a comparison (M12-20). */
export async function saveActive(docId: string): Promise<unknown> {
  const elsewhere = redirect(docId);
  return elsewhere ?? save(docId);
}

/** Ctrl+S (§4.2). `skipGrowthCheck`: the user chose "Just save" in the growth prompt. */
export async function save(docId: string, skipGrowthCheck = false): Promise<SavePhase> {
  const src = sources.get(docId);
  const doc = documentStore.getState().docs[docId];
  if (!src || !doc) return phaseOf(docId);
  if (
    !skipGrowthCheck &&
    shouldOfferOptimize({
      signatureCount: doc.meta.signatureCount,
      originalSize: src.size,
      appendedBytes: doc.appendedBytes,
      dismissed: growth.isDismissed(docId),
      recommended: growth.isRecommended(docId),
    })
  ) {
    saveStore.setState({ growthPrompt: docId });
    return phaseOf(docId);
  }
  const { handle } = src;
  if (!handle || accessStrategy() !== 'fsa') return saveAs(docId);
  return incremental(
    docId,
    async (p, signal) => {
      const prefix = src.pendingPrefix;
      if (!p && !prefix) return;
      if (!(await ensurePermission(handle, 'readwrite')))
        throw new SaveFailure('permission-denied');
      if (prefix) {
        // A recovered document re-linked to its file (M1-24): the recovered
        // bytes go first, at the file's current end.
        const parts: BlobPart[] = [prefix.bytes, ...(p ? [p.tail] : [])];
        await appendToHandle(handle, prefix.at, new Blob(parts), signal);
        delete src.pendingPrefix;
      } else if (p) {
        await appendToHandle(handle, p.baseLength, new Uint8Array(p.tail), signal);
      }
      src.written = true;
      await noteWritten(docId, handle);
    },
    src.pendingPrefix !== undefined,
  );
}

/** A document's unsaved changes as an incremental tail on the file as saved (not committed). */
export interface UnsavedTail {
  tail: ArrayBuffer;
  baseLength: number;
}

/**
 * The unsaved changes of these documents as verified incremental tails, as
 * Ctrl+S would write them, without writing or committing anything (M12-20:
 * Save comparison… puts the review comments into the copies it holds, and the
 * documents' own files stay as they are).
 */
export async function unsavedTails(
  docIds: readonly string[],
  signal: AbortSignal,
): Promise<Map<string, UnsavedTail>> {
  await editsSettled();
  const out = new Map<string, UnsavedTail>();
  const deps = saveDeps();
  for (const docId of docIds) {
    if (!documentStore.getState().docs[docId]?.dirty) continue;
    await annotationsSettled(docId);
    while (pageOpRunning(docId)) await new Promise((r) => setTimeout(r, 50));
    const p = await prepareSave(docId, deps, { signal });
    if (p) out.set(docId, { tail: p.tail, baseLength: p.baseLength });
  }
  return out;
}

/** What a save of several documents into one file ended with. */
export type TogetherResult = 'written' | 'nothing' | 'cancelled' | 'failed';

/**
 * Saves several documents into one file that `write` writes (M12-20: Save
 * review in a reopened comparison file, whose copies of Document A and B are
 * its attachments). Each document's tail is prepared and verified as for
 * Ctrl+S; `write` gets them all; then each is committed (rule 7: the copies
 * grow by incremental sections). Nothing is committed when `write` fails or
 * is cancelled. `write` runs even when no document changed (`always`).
 */
export async function saveTogether(
  docIds: readonly string[],
  write: (tails: Map<string, PreparedSave>, signal: AbortSignal) => Promise<void>,
  always = false,
): Promise<TogetherResult> {
  await editsSettled();
  for (const docId of docIds) {
    await annotationsSettled(docId);
    while (pageOpRunning(docId)) await new Promise((r) => setTimeout(r, 50));
  }
  const ids = docIds.filter((d) => documentStore.getState().docs[d] && !isActive(phaseOf(d)));
  if (ids.length === 0) return 'nothing';
  const ac = new AbortController();
  const editsAtStart = new Map(ids.map((d) => [d, documentStore.getState().docs[d]?.edits ?? 0]));
  for (const d of ids) {
    controllers.set(d, ac);
    emit(d, { type: 'start' });
  }
  const deps = saveDeps();
  const prepared = new Map<string, PreparedSave>();
  try {
    for (const d of ids) {
      const p = await prepareSave(d, deps, {
        signal: ac.signal,
        onVerify: () => emit(d, { type: 'verifying' }),
      });
      if (p) prepared.set(d, p);
    }
    if (prepared.size === 0 && !always) {
      for (const d of ids) {
        documentStore.getState().markSaved(d, 0, editsAtStart.get(d));
        emit(d, { type: 'nothing-to-save' });
      }
      return 'nothing';
    }
    ac.signal.throwIfAborted();
    for (const d of ids) emit(d, { type: 'writing' });
    await write(prepared, ac.signal);
    // Written: from here on the save cannot be cancelled.
    for (const d of ids) {
      const p = prepared.get(d);
      if (p) {
        await finishSave(p, deps);
        committed.set(d, [...(committed.get(d) ?? []), p.tail]);
      }
      documentStore.getState().markSaved(d, p?.tail.byteLength ?? 0, editsAtStart.get(d));
      emit(d, { type: 'written', appended: p?.tail.byteLength ?? 0 });
    }
    return 'written';
  } catch (err) {
    const kind = errorKind(err);
    for (const d of ids)
      emit(d, kind === 'cancelled' ? { type: 'cancel' } : { type: 'fail', kind });
    return kind === 'cancelled' ? 'cancelled' : 'failed';
  } finally {
    for (const d of ids) if (controllers.get(d) === ac) controllers.delete(d);
  }
}

/** Tails committed since open (or since the last optimized save): recovery snapshots (M1-24). */
export function committedTails(docId: string): readonly ArrayBuffer[] {
  return committed.get(docId) ?? [];
}

/** The picked target, or undefined (cancelled, or the fallback path). */
async function pickTarget(name: string): Promise<FileSystemFileHandle | undefined> {
  try {
    return await pickSaveTarget(name);
  } catch (err) {
    recordError('save', err);
    return undefined;
  }
}

/**
 * The file's size and time after a write, for the tab's hover card (M11-03): metadata
 * only (no bytes are read). Best effort: a failure leaves the facts as they were.
 */
async function noteWritten(
  docId: string,
  handle: FileSystemFileHandle,
  source?: DocumentSource,
): Promise<void> {
  try {
    const file = await handle.getFile();
    void fileWritten(docId, file); // its last view follows the file's new fingerprint (D-53)
    documentStore.getState().setFileFacts(docId, {
      ...(source ? { source } : {}),
      fileSize: file.size,
      modified: file.lastModified,
    });
  } catch {
    if (source) documentStore.getState().setFileFacts(docId, { source });
  }
}

/** The document now lives in `handle` (Save As, optimized copy). */
async function adoptHandle(docId: string, handle: FileSystemFileHandle): Promise<void> {
  const src = sources.get(docId);
  if (!src) return;
  // Save Optimized over the document's own file keeps where it came from.
  const moved = src.handle !== handle;
  src.handle = handle;
  src.written = true;
  documentStore.getState().rename(docId, handle.name);
  await noteWritten(docId, handle, moved ? 'saved' : undefined);
}

/** Save As (§4.2): a full incremental copy to a new file, which becomes the document's file. */
export async function saveAs(docId: string): Promise<SavePhase> {
  const src = sources.get(docId);
  const name = documentStore.getState().docs[docId]?.meta.name;
  if (!src || name === undefined || isActive(phaseOf(docId))) return phaseOf(docId);
  if (accessStrategy() !== 'fsa') {
    return incremental(
      docId,
      async (p) => {
        downloadBytes(await wholeFile(docId, p?.tail), name);
      },
      true,
    );
  }
  // The picker first: it needs the user's gesture (Ctrl+Shift+S, a click).
  const handle = await pickTarget(name);
  if (!handle) return phaseOf(docId);
  return incremental(
    docId,
    async (p, signal) => {
      await writeToHandle(handle, await wholeFile(docId, p?.tail), signal, reportProgress(docId));
      await adoptHandle(docId, handle);
    },
    true,
  );
}

export type OptimizeTarget = 'copy' | 'replace';

/**
 * Save Optimized (§4.2, ADR-005 decision 3): a full rewrite (signatures are
 * invalidated; the dialog warns first). 'copy' asks for a new file (the
 * download on the fallback path); 'replace' overwrites the document's file.
 * A rewrite written to the document's file becomes the base for Ctrl+S.
 */
export async function saveOptimized(docId: string, target: OptimizeTarget): Promise<SavePhase> {
  const src = sources.get(docId);
  const name = documentStore.getState().docs[docId]?.meta.name;
  if (!src || name === undefined || isActive(phaseOf(docId))) return phaseOf(docId);
  const fsa = accessStrategy() === 'fsa';
  let handle: FileSystemFileHandle | undefined;
  if (fsa) {
    handle = target === 'replace' ? src.handle : await pickTarget(name);
    if (!handle) return phaseOf(docId);
  }
  const rpc = renderEngine().rpc;
  return runJob(docId, async ({ signal, editsAtStart }) => {
    const { bytes } = await rpc.call('saveRewrite', { docId }, { signal }).promise;
    signal.throwIfAborted();
    emit(docId, { type: 'writing' });
    if (!handle) {
      // Fallback: a downloaded copy; the document keeps its base.
      downloadBytes(new Uint8Array(bytes), name);
      documentStore.getState().markSaved(docId, 0, editsAtStart);
      return { type: 'written', appended: 0 };
    }
    if (target === 'replace' && !(await ensurePermission(handle, 'readwrite')))
      throw new SaveFailure('permission-denied');
    await writeToHandle(handle, new Uint8Array(bytes), signal, reportProgress(docId));
    // Written: the rewrite is now the document's file and the save base.
    await rpc.call('commitSave', { docId, tailLength: bytes.byteLength, rewrite: true }).promise;
    committed.set(docId, []);
    src.size = bytes.byteLength;
    await adoptHandle(docId, handle);
    growth.forget(docId);
    const read = async () => (await originalBlob(docId)).arrayBuffer();
    await workClient()
      .open(docId, bytes, { reload: read })
      .catch(() => undefined); // reopened lazily by the next Work job (deps.ts)
    documentStore.getState().markOptimized(docId, editsAtStart);
    return { type: 'written', appended: 0 };
  });
}

/** A change rewrote page content (a flatten, M6-09): the next Ctrl+S offers Save Optimized. */
export function recommendOptimize(docId: string): void {
  growth.recommend(docId);
}

/** Why the growth prompt is shown: the file grew, or Save Optimized is recommended. */
export const optimizeRecommended = (docId: string): boolean => growth.isRecommended(docId);

/** Growth prompt answers. */
export function answerGrowthPrompt(choice: 'optimize' | 'save' | 'cancel'): void {
  const docId = saveStore.getState().growthPrompt;
  saveStore.setState({ growthPrompt: null });
  if (!docId) return;
  if (choice === 'optimize') saveStore.setState({ optimizePrompt: docId });
  else if (choice === 'save') {
    growth.dismiss(docId);
    void save(docId, true);
  }
}

export function openOptimizeDialog(docId: string): void {
  saveStore.setState({ optimizePrompt: docId });
}

export function closeOptimizeDialog(): void {
  saveStore.setState({ optimizePrompt: null });
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
  growth.forget(docId);
  saveStore.setState((s) => ({
    phases: without(s.phases, docId),
    progress: without(s.progress, docId),
    failure: s.failure?.docId === docId ? null : s.failure,
    growthPrompt: s.growthPrompt === docId ? null : s.growthPrompt,
    optimizePrompt: s.optimizePrompt === docId ? null : s.optimizePrompt,
  }));
}
