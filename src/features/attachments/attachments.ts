// Attachments pane state (§5, M2-11): the list comes from the Work worker
// (document-level files and FileAttachment annotations), per document, once.
// Save writes the bytes to a file the user picks (or a download); a PDF
// attachment can open as a new tab. Nothing is previewed or executed.
import { createStore, useStore } from 'zustand';
import { documentStore } from '../../app/store/documentStore';
import type { PluginRegistry } from '@embedpdf/core';
import { PdfAnnotationSubtype } from '@embedpdf/models';
import type { AnnotationCapability } from '@embedpdf/plugin-annotation';
import { AbortError, isAbortError } from '../../engine/errors';
import { downloadBytes, pickFileSaveTarget, writeToHandle } from '../../storage/fileAccess';
import type { AttachmentInfo } from '../../workers/work/attachments';
import { openFiles } from '../open/openDocument';
import { syncLive } from '../pages/pageOps';
import { capability, workClient } from '../view/host';

export type ListState =
  | { state: 'loading'; done: number; total: number }
  | { state: 'ready'; items: AttachmentInfo[] }
  | { state: 'failed' };

interface AttachmentsState {
  lists: Record<string, ListState>;
  /** Bumped when a document's attachments changed (M6-10): the pane lists them again. */
  versions: Record<string, number>;
  /** Index of the attachment being saved or opened (one at a time). */
  busy: number | null;
  /** Last action's error code, if any (no document content, rule 10). */
  error: string | null;
}

export const attachmentsStore = createStore<AttachmentsState>()(() => ({
  lists: {},
  versions: {},
  busy: null,
  error: null,
}));

export function useAttachments<T>(selector: (s: AttachmentsState) => T): T {
  return useStore(attachmentsStore, selector);
}

/** How long a just-opened document's Work copy is waited for. */
const WORK_COPY_WAIT_MS = 10_000;

const jobs = new Map<string, { cancel(): void }>();
/** Documents whose list is out of date (a file attachment was added, moved or removed). */
const stale = new Set<string>();

function setList(docId: string, list: ListState): void {
  attachmentsStore.setState((s) => ({ lists: { ...s.lists, [docId]: list } }));
}

function dropList(docId: string): void {
  attachmentsStore.setState((s) => ({
    lists: Object.fromEntries(Object.entries(s.lists).filter(([id]) => id !== docId)),
  }));
}

/**
 * Loads a document's attachments (the pane asks when it shows, and again
 * after a change). The Work worker's copy is brought up to date first, so
 * unsaved Attach File comments are listed too (M6-10).
 */
export function loadAttachments(docId: string): void {
  const current = attachmentsStore.getState().lists[docId];
  if ((current && !stale.has(docId)) || jobs.has(docId)) return;
  stale.delete(docId);
  // A refresh keeps showing the old list until the new one is ready.
  if (current?.state !== 'ready') setList(docId, { state: 'loading', done: 0, total: 0 });
  let inner: { cancel(): void } | null = null;
  let cancelled = false;
  const job = {
    cancel: () => {
      cancelled = true;
      inner?.cancel();
    },
  };
  jobs.set(docId, job);
  const fail = (err: unknown): void => {
    if (jobs.get(docId) === job) jobs.delete(docId);
    if (isAbortError(err) || cancelled) {
      if (!stale.has(docId)) dropList(docId);
    } else setList(docId, { state: 'failed' });
  };
  // The pane can show before the Work worker has the copy of a document just opened.
  workClient()
    .whenAdded(docId, WORK_COPY_WAIT_MS)
    // A document still opening has no unsaved changes to bring over (and no tail yet).
    .then(() => syncLive(docId).catch(() => undefined))
    .then(() => {
      if (cancelled) throw new AbortError();
      const run = workClient().run(
        'listAttachments',
        { docId },
        {
          onProgress: (p) => {
            if (attachmentsStore.getState().lists[docId]?.state !== 'ready')
              setList(docId, { state: 'loading', ...p });
          },
        },
      );
      inner = run;
      return run.promise.then((items) => {
        if (jobs.get(docId) === job) jobs.delete(docId);
        if (!cancelled && documentStore.getState().docs[docId])
          setList(docId, { state: 'ready', items });
      });
    })
    .catch(fail);
}

/** A file attachment changed (M6-10): a listed document is listed again. */
export function invalidateAttachments(docId: string): void {
  const st = attachmentsStore.getState();
  if (!st.lists[docId] && !jobs.has(docId)) return; // never listed
  jobs.get(docId)?.cancel();
  jobs.delete(docId);
  stale.add(docId);
  attachmentsStore.setState((s) => ({
    versions: { ...s.versions, [docId]: (s.versions[docId] ?? 0) + 1 },
  }));
}

/** Committed changes to FileAttachment comments make the pane list again. */
export function installAttachmentRefresh(registry: PluginRegistry): () => void {
  const cap = capability<AnnotationCapability>(registry, 'annotation');
  return cap.onAnnotationEvent((e) => {
    if (!('committed' in e) || !e.committed) return;
    if (e.annotation.type === PdfAnnotationSubtype.FILEATTACHMENT)
      invalidateAttachments(e.documentId);
  });
}

/** Is this file a PDF? By its header, never its name. */
export const isPdf = (bytes: ArrayBuffer): boolean =>
  new TextDecoder('latin1').decode(new Uint8Array(bytes, 0, Math.min(5, bytes.byteLength))) ===
  '%PDF-';

/** The attachment as a Blob made in the Work worker: no large copy on the main thread (rule 1). */
async function read(docId: string, item: AttachmentInfo): Promise<Blob> {
  return (await workClient().run('readAttachment', { docId, ref: item.ref }).promise).blob;
}

async function withBusy(index: number, fn: () => Promise<void>): Promise<void> {
  if (attachmentsStore.getState().busy !== null) return;
  attachmentsStore.setState({ busy: index, error: null });
  try {
    await fn();
  } catch (err) {
    if (!isAbortError(err)) {
      const code = (err as { code?: unknown }).code;
      attachmentsStore.setState({
        error: typeof code === 'string' ? code : 'attachment-failed',
      });
    }
  } finally {
    attachmentsStore.setState({ busy: null });
  }
}

/** "Save…": the picker first (a user gesture), then the bytes. */
export function saveAttachment(docId: string, item: AttachmentInfo, index: number): Promise<void> {
  return withBusy(index, async () => {
    const handle = await pickFileSaveTarget(item.name || 'attachment');
    const fsa =
      typeof (window as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
    if (fsa && !handle) return; // cancelled
    const blob = await read(docId, item);
    if (handle) await writeToHandle(handle, blob);
    else downloadBytes(blob, item.name || 'attachment');
  });
}

/** Opens a PDF attachment as a new tab. */
export function openAttachment(docId: string, item: AttachmentInfo, index: number): Promise<void> {
  return withBusy(index, async () => {
    const blob = await read(docId, item);
    if (!isPdf(await blob.slice(0, 5).arrayBuffer()))
      throw Object.assign(new Error('not a PDF'), { code: 'attachment-not-pdf' });
    // A File over the same Blob data: no copy.
    await openFiles([
      { file: new File([blob], item.name || 'attachment.pdf', { type: 'application/pdf' }) },
    ]);
  });
}

documentStore.subscribe((s, prev) => {
  if (s.docs === prev.docs) return;
  for (const id of Object.keys(prev.docs)) {
    if (id in s.docs) continue;
    jobs.get(id)?.cancel();
    jobs.delete(id);
    stale.delete(id);
    dropList(id);
  }
});
