// The comparison file on the main thread (M12-20, D-65, ADR-032): Save
// comparison… (one standard PDF holding both documents and the comparison
// data), Save review (Ctrl+S in a comparison), and Export Document A / B of a
// comparison reopened from such a file. The file is built in the Work worker
// (rule 1); the bytes only pass through here.
//
// A comparison reopened from a comparison file is "linked" to it: its
// documents are the copies inside, so Save review saves them incrementally
// (rule 7) and writes the comparison file again around them (ADR-032
// decision 3: an overlay file compacted, a text file rebuilt over the new B).
import { createStore, useStore } from 'zustand';
import { recordError } from '../../../app/diagnostics';
import { documentStore, securityOf } from '../../../app/store/documentStore';
import { RpcError, isAbortError } from '../../../engine/errors';
import { t } from '../../../i18n';
import type { ComparisonData, FileKind } from '../../../model/compare/file/format';
import { textMarkSpecs } from '../../../model/compare/file/textMarks';
import { pageMap } from '../../../model/compare/textView';
import {
  accessStrategy,
  downloadBytes,
  pickSaveTarget,
  writeToHandle,
} from '../../../storage/fileAccess';
import type { CompareFileRequest, FileInputRef } from '../../../workers/work/comparisonFile/jobs';
import { DENIED } from '../../../workers/work/permissionGate';
import { syncLive } from '../../pages/pageOps';
import { save, saveTogether, unsavedTails, type UnsavedTail } from '../../save/save';
import { showStatusToast } from '../../snapshot/snapshot';
import { workClient } from '../../view/host';
import { baseName, documentsOf, type Comparison } from '../model';
import {
  comparisonSheets,
  vectorRequest,
  vectorSheet,
  whenAligned,
} from '../overlay/vectorOverlay';
import { overlayView } from '../overlay/overlayState';
import { notesStore } from '../review/notes';
import { textStore, DEFAULT_TEXT_VIEW } from '../text/textFlow';
import { blockFor, type Block } from '../permissions';
import { overlayFields, sidesOf, textFields } from './data';
import { fileWords, markWords } from './words';

// ---- comparisons linked to their comparison file ----

export interface LinkedFile {
  kind: FileKind;
  /** The comparison file's name (and, on Chromium, its handle: Save review writes there). */
  name: string;
  handle?: FileSystemFileHandle;
  /** The data as read (its `created` time is kept). */
  data: ComparisonData;
  /** The documents opened from the copies inside. */
  docIds: string[];
  /** Revisions another program appended after ours (text: Save review asks first). */
  foreignRevisions: number;
  /** The comparison file's own open password (memory only), kept when it is written again. */
  password?: string;
}

interface FileStoreState {
  linked: Record<string, LinkedFile>;
}

export const fileStore = createStore<FileStoreState>()(() => ({ linked: {} }));

export function useLinked(id: string): LinkedFile | undefined {
  return useStore(fileStore, (s) => s.linked[id]);
}

export const linkedOf = (id: string): LinkedFile | undefined => fileStore.getState().linked[id];

export function link(id: string, f: LinkedFile): void {
  watchClosing();
  fileStore.setState((s) => ({ linked: { ...s.linked, [id]: f } }));
}

function relink(id: string, patch: Partial<LinkedFile>): void {
  fileStore.setState((s) => {
    const cur = s.linked[id];
    return cur ? { linked: { ...s.linked, [id]: { ...cur, ...patch } } } : {};
  });
}

let watching = false;

/** A comparison that closed forgets its file. */
function watchClosing(): void {
  if (watching) return;
  watching = true;
  documentStore.subscribe((s) => {
    const gone = Object.keys(fileStore.getState().linked).filter((id) => !s.comparisons[id]);
    if (gone.length)
      fileStore.setState((st) => ({
        linked: Object.fromEntries(Object.entries(st.linked).filter(([k]) => !gone.includes(k))),
      }));
  });
}

/** The linked comparison a document of a comparison file belongs to. */
export function linkedComparisonOf(docId: string): string | null {
  for (const [id, f] of Object.entries(fileStore.getState().linked))
    if (f.docIds.includes(docId)) return id;
  return null;
}

// ---- what saving needs ----

const nameOf = (docId: string): string => documentStore.getState().docs[docId]?.meta.name ?? '';

/** "RevA vs RevB (comparison).pdf" (localized). */
export function comparisonFileName(c: Comparison): string {
  const first = (side: 'a' | 'b'): string => baseName(nameOf(c[side][0]?.docId ?? ''));
  return t('compare.file.fileName', { a: first('a'), b: first('b') });
}

/** Which file blocks Save comparison… (rule 9): copying in every file; for text, commenting in B. */
export function saveBlock(c: Comparison): Block | null {
  const docs = documentStore.getState().docs;
  const files = documentsOf(c).flatMap((docId) => {
    const d = docs[docId];
    return d ? [{ docId, name: d.meta.name, security: securityOf(d.meta) }] : [];
  });
  const copy = blockFor('saveComparison', files);
  if (copy) return copy;
  const b = c.b[0]?.docId;
  return c.type === 'text' && b ? blockFor('comment', files, b) : null;
}

/** Whether an input needed an open password (ADR-032 decision 1). */
const locked = (docId: string): boolean => workClient().openPassword(docId) !== undefined;

/**
 * The input whose open password makes the comparison file need one, or null:
 * any input of an overlay; for text, a protected A over an open B (a protected
 * B already locks the file with its own password).
 */
export function protectedInput(c: Comparison): string | null {
  if (c.type === 'text') {
    const a = c.a[0]?.docId;
    const b = c.b[0]?.docId;
    return a && b && locked(a) && !locked(b) ? nameOf(a) : null;
  }
  const f = documentsOf(c).find(locked);
  return f ? nameOf(f) : null;
}

/** Whether the comparison has its result (an overlay paired, a text comparison compared). */
export function hasResult(c: Comparison): boolean {
  if (c.stage !== 'result') return false;
  if (c.type === 'overlay') return (comparisonSheets(c.id)?.length ?? 0) > 0;
  // The whole result (a cancelled run keeps what it found, and is saved as it is).
  const run = textStore.getState().runs[c.id];
  return run?.result != null && (run.status === 'done' || run.status === 'cancelled');
}

/** Whether the comparison's documents have unsaved review comments. */
export const hasUnsaved = (c: Comparison): boolean =>
  documentsOf(c).some((d) => documentStore.getState().docs[d]?.dirty);

/** The overlay notes' document of a comparison, once made. */
const notesOf = (id: string): string | null => notesStore.getState().byId[id]?.docId ?? null;

/**
 * The Work worker's request for the whole comparison file, as the comparison
 * stands; `tails`: the documents' changes not saved yet.
 */
async function fileRequest(
  c: Comparison,
  tails: ReadonlyMap<string, UnsavedTail>,
  signal: AbortSignal,
  onStage: (stage: 'aligning' | 'drawing') => void,
  lock: string | undefined,
): Promise<CompareFileRequest> {
  const created = linkedOf(c.id)?.data.created ?? '';
  const ref = (f: { docId: string; name: string; range: string }): FileInputRef => {
    const tl = tails.get(f.docId);
    return tl ? { ...f, tail: tl.tail, baseLength: tl.baseLength } : f;
  };
  const sides = sidesOf(c);
  const base = {
    A: sides.A.map(ref),
    B: sides.B.map(ref),
    words: fileWords(),
    when: new Date().toISOString(),
    ...(lock === undefined ? {} : { lock }),
  };
  if (c.type === 'overlay') {
    const sheets = comparisonSheets(c.id) ?? [];
    onStage('aligning');
    await whenAligned(c.id, sheets, signal);
    onStage('drawing');
    const v = overlayView(c.id);
    const notes = notesOf(c.id);
    if (notes) await syncLive(notes);
    return {
      kind: 'overlay',
      ...base,
      fields: overlayFields(c, created),
      vector: vectorRequest(
        c,
        v,
        sheets.map((s) => vectorSheet(v, s)),
        nameOf,
      ),
      ...(notes ? { notesDocId: notes } : {}),
    };
  }
  onStage('drawing');
  const run = textStore.getState().runs[c.id];
  const view = textStore.getState().views[c.id] ?? DEFAULT_TEXT_VIEW;
  if (!run?.result) throw new RpcError('compare-file-request', 'The text comparison has no result');
  return {
    kind: 'text',
    ...base,
    fields: textFields(c, created),
    marks: textMarkSpecs(run.result, pageMap(run.inputs.b.pages), view.colours, markWords()),
  };
}

// ---- Save comparison… ----

export interface SaveComparisonState {
  /** The comparison the dialog is open for. */
  id: string | null;
  password: string;
  confirm: string;
  running: {
    stage: 'preparing' | 'aligning' | 'drawing' | 'writing';
    done: number;
    total: number;
  } | null;
  error: 'failed' | 'denied' | 'password' | 'mismatch' | null;
}

const CLOSED: SaveComparisonState = {
  id: null,
  password: '',
  confirm: '',
  running: null,
  error: null,
};

export const saveComparisonStore = createStore<SaveComparisonState>()(() => CLOSED);

export function useSaveComparison<T>(selector: (s: SaveComparisonState) => T): T {
  return useStore(saveComparisonStore, selector);
}

let job: AbortController | null = null;

export function openSaveComparison(id: string): void {
  saveComparisonStore.setState({ ...CLOSED, id });
}

export function closeSaveComparison(): void {
  job?.abort();
  job = null;
  saveComparisonStore.setState(CLOSED);
}

export function cancelSaveComparison(): void {
  job?.abort();
}

export function setSavePassword(password: string, confirm: string): void {
  saveComparisonStore.setState({ password, confirm, error: null });
}

/** Writes `bytes` to the handle, or downloads them (no file handles: Firefox, Safari). */
async function writeOut(
  bytes: ArrayBuffer,
  handle: FileSystemFileHandle | undefined,
  name: string,
  signal: AbortSignal,
): Promise<void> {
  const data = new Uint8Array(bytes);
  if (handle) await writeToHandle(handle, data, signal);
  else downloadBytes(data, name);
}

/**
 * Save comparison…: asks where (first: the picker needs the click's gesture),
 * takes the review comments not saved yet into the copies, builds the file in
 * the Work worker and writes it. The documents' own files are not changed.
 */
export async function startSaveComparison(): Promise<void> {
  const st = saveComparisonStore.getState();
  const c = st.id ? documentStore.getState().comparisons[st.id] : undefined;
  if (!c || st.running || !hasResult(c)) return;
  if (saveBlock(c)) {
    saveComparisonStore.setState({ error: 'denied' });
    return;
  }
  const linkedFile = linkedOf(c.id);
  const needsLock = protectedInput(c) !== null;
  let lock: string | undefined;
  if (needsLock) {
    if (st.password === '') {
      saveComparisonStore.setState({ error: 'password' });
      return;
    }
    if (st.password !== st.confirm) {
      saveComparisonStore.setState({ error: 'mismatch' });
      return;
    }
    lock = st.password;
  }
  const fileName = linkedFile?.name ?? comparisonFileName(c);
  const controller = new AbortController();
  job = controller;
  const progress = (
    stage: NonNullable<SaveComparisonState['running']>['stage'],
    done = 0,
    total = 0,
  ): void => {
    if (!controller.signal.aborted)
      saveComparisonStore.setState({ running: { stage, done, total }, error: null });
  };
  progress('preparing');
  try {
    let handle: FileSystemFileHandle | undefined;
    if (accessStrategy() === 'fsa') {
      handle = await pickSaveTarget(fileName);
      if (!handle) {
        saveComparisonStore.setState({ running: null });
        return;
      }
    }
    const tails = await unsavedTails(documentsOf(c), controller.signal);
    controller.signal.throwIfAborted();
    const req = await fileRequest(
      c,
      tails,
      controller.signal,
      (s) => {
        progress(s);
      },
      lock,
    );
    const { bytes } = await workClient().run('compareFileSave', req, {
      signal: controller.signal,
      onProgress: (p) => {
        progress('drawing', p.done, p.total);
      },
    }).promise;
    controller.signal.throwIfAborted();
    progress('writing');
    await writeOut(bytes, handle, fileName, controller.signal);
    // A reopened comparison now lives in the file just written (as after Save As).
    if (linkedFile && handle)
      relink(c.id, {
        handle,
        name: handle.name,
        ...(lock === undefined ? {} : { password: lock }),
      });
    const first = c.b[0]?.docId ?? c.a[0]?.docId;
    if (first)
      showStatusToast(first, t('compare.file.save.done', { name: handle?.name ?? fileName }), true);
    saveComparisonStore.setState(CLOSED);
  } catch (err) {
    const cancelled = controller.signal.aborted || isAbortError(err);
    const denied = err instanceof RpcError && err.code.startsWith(DENIED);
    if (!cancelled && !denied) recordError('compare.saveComparison', err);
    saveComparisonStore.setState({
      running: null,
      error: cancelled ? null : denied ? 'denied' : 'failed',
    });
  } finally {
    if (job === controller) job = null;
  }
}

// ---- Save review (Ctrl+S in a comparison) ----

interface ReviewState {
  /** Save review is waiting on "rebuild the file?" for this comparison (text, foreign revisions). */
  confirm: string | null;
  /** Save review is writing the comparison file of this comparison. */
  saving: string | null;
}

export const reviewStore = createStore<ReviewState>()(() => ({ confirm: null, saving: null }));

export function useReviewSave<T>(selector: (s: ReviewState) => T): T {
  return useStore(reviewStore, selector);
}

/**
 * Save review (Ctrl+S in a comparison, D-65): the reviewer's new comments go
 * into Document A and Document B by the normal incremental save, each file
 * on its own. In a comparison reopened from a comparison file they go into
 * the copies inside, and the file is written again around them.
 */
export async function saveReview(id: string, confirmed = false): Promise<void> {
  const c = documentStore.getState().comparisons[id];
  if (!c) return;
  const linkedFile = linkedOf(id);
  if (!linkedFile) {
    for (const docId of documentsOf(c))
      if (documentStore.getState().docs[docId]?.dirty) await save(docId);
    const notes = notesOf(id);
    if (notes && documentStore.getState().docs[notes]?.dirty) {
      const first = c.b[0]?.docId ?? c.a[0]?.docId;
      if (first) showStatusToast(first, t('compare.file.review.notesOnly'), false);
    }
    return;
  }
  if (linkedFile.kind === 'text' && linkedFile.foreignRevisions > 0 && !confirmed) {
    reviewStore.setState({ confirm: id });
    return;
  }
  if (!hasResult(c)) return;
  // A file that must be locked again and whose password is not known: Save comparison… asks.
  if (protectedInput(c) !== null && linkedFile.password === undefined) {
    openSaveComparison(id);
    return;
  }
  const notes = notesOf(id);
  const docIds = documentsOf(c);
  reviewStore.setState({ saving: id });
  try {
    const result = await saveTogether(
      docIds,
      async (prepared, signal) => {
        const tails = new Map<string, UnsavedTail>(
          [...prepared].map(([d, p]) => [d, { tail: p.tail, baseLength: p.baseLength }]),
        );
        const req = await fileRequest(c, tails, signal, () => undefined, linkedFile.password);
        const { bytes } = await workClient().run('compareFileSave', req, { signal }).promise;
        signal.throwIfAborted();
        await writeOut(bytes, linkedFile.handle, linkedFile.name, signal);
      },
      notes !== null && documentStore.getState().docs[notes]?.dirty === true,
    );
    if (result === 'written') {
      relink(id, { foreignRevisions: 0 });
      if (notes) documentStore.getState().markSaved(notes, 0);
    } else if (result === 'failed') {
      reviewFailed(c);
    }
  } catch (err) {
    recordError('compare.saveReview', err);
    reviewFailed(c);
  } finally {
    reviewStore.setState({ saving: null });
  }
}

function reviewFailed(c: Comparison): void {
  const first = c.b[0]?.docId ?? c.a[0]?.docId;
  if (first) showStatusToast(first, t('compare.file.review.failed'), false);
}

export function answerRebuild(go: boolean): void {
  const id = reviewStore.getState().confirm;
  reviewStore.setState({ confirm: null });
  if (go && id) void saveReview(id, true);
}

/**
 * Where Ctrl+S goes in a comparison (save.ts's redirect): with a comparison
 * tab shown, Save review of that comparison; a document of a comparison file
 * shown in a tab of its own saves into its comparison file. Null: as usual.
 */
export function reviewRedirect(docId: string): Promise<void> | null {
  const s = documentStore.getState();
  const tab = s.activeTab ? s.comparisons[s.activeTab] : undefined;
  if (tab && (documentsOf(tab).includes(docId) || notesOf(tab.id) === docId))
    return saveReview(tab.id);
  const owner = linkedComparisonOf(docId);
  return owner ? saveReview(owner) : null;
}

// ---- Export Document A / B ----

/** Writes the copies of a side of a reopened comparison file out as ordinary files. */
export async function exportDocuments(id: string, side: 'a' | 'b'): Promise<void> {
  const c = documentStore.getState().comparisons[id];
  if (!c || !linkedOf(id)) return;
  for (const f of c[side]) {
    const name = nameOf(f.docId);
    try {
      let handle: FileSystemFileHandle | undefined;
      if (accessStrategy() === 'fsa') {
        handle = await pickSaveTarget(name);
        if (!handle) return;
      }
      const { bytes } = await workClient().run('compareFileInput', { docId: f.docId }).promise;
      await writeOut(bytes, handle, name, new AbortController().signal);
      showStatusToast(f.docId, t('compare.file.export.done', { name: handle?.name ?? name }), true);
    } catch (err) {
      if (isAbortError(err)) return;
      recordError('compare.exportDocument', err);
      showStatusToast(f.docId, t('compare.file.export.failed'), false);
      return;
    }
  }
}
