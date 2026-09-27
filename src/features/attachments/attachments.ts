// Attachments pane state (§5, M2-11): the list comes from the Work worker
// (document-level files and FileAttachment annotations), per document, once.
// Save writes the bytes to a file the user picks (or a download); a PDF
// attachment can open as a new tab. Nothing is previewed or executed.
import { createStore, useStore } from 'zustand';
import { documentStore } from '../../app/store/documentStore';
import { isAbortError } from '../../engine/errors';
import { downloadBytes, pickFileSaveTarget, writeToHandle } from '../../storage/fileAccess';
import type { AttachmentInfo } from '../../workers/work/attachments';
import { openFiles } from '../open/openDocument';
import { workClient } from '../view/host';

export type ListState =
  | { state: 'loading'; done: number; total: number }
  | { state: 'ready'; items: AttachmentInfo[] }
  | { state: 'failed' };

interface AttachmentsState {
  lists: Record<string, ListState>;
  /** Index of the attachment being saved or opened (one at a time). */
  busy: number | null;
  /** Last action's error code, if any (no document content, rule 10). */
  error: string | null;
}

export const attachmentsStore = createStore<AttachmentsState>()(() => ({
  lists: {},
  busy: null,
  error: null,
}));

export function useAttachments<T>(selector: (s: AttachmentsState) => T): T {
  return useStore(attachmentsStore, selector);
}

const jobs = new Map<string, { cancel(): void }>();

function setList(docId: string, list: ListState): void {
  attachmentsStore.setState((s) => ({ lists: { ...s.lists, [docId]: list } }));
}

function dropList(docId: string): void {
  attachmentsStore.setState((s) => ({
    lists: Object.fromEntries(Object.entries(s.lists).filter(([id]) => id !== docId)),
  }));
}

/** Loads a document's attachments once (the pane asks when it shows). */
export function loadAttachments(docId: string): void {
  if (attachmentsStore.getState().lists[docId] || jobs.has(docId)) return;
  setList(docId, { state: 'loading', done: 0, total: 0 });
  const job = workClient().run(
    'listAttachments',
    { docId },
    {
      onProgress: (p) => {
        setList(docId, { state: 'loading', ...p });
      },
    },
  );
  jobs.set(docId, job);
  job.promise.then(
    (items) => {
      jobs.delete(docId);
      if (documentStore.getState().docs[docId]) setList(docId, { state: 'ready', items });
    },
    (err: unknown) => {
      jobs.delete(docId);
      if (isAbortError(err)) {
        dropList(docId);
      } else setList(docId, { state: 'failed' });
    },
  );
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
    dropList(id);
  }
});
