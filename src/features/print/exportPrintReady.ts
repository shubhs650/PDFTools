// Export Print-Ready PDF (D-25, §7.13, M2-16): a copy of the document with
// its printable annotations and form fields burned in (vector), made in the
// Work worker on a separate copy of the current revision with unsaved edits
// appended; the open document stays as it is (not dirty). Saved as a new file
// (the save picker, or a download on the fallback path); the original file is
// never written. Also the source of the browser-viewer print route.
import { createStore, useStore } from 'zustand';
import { documentStore } from '../../app/store/documentStore';
import { t } from '../../i18n';
import {
  accessStrategy,
  downloadBytes,
  pickSaveTarget,
  writeToHandle,
} from '../../storage/fileAccess';
import type { FlattenOptions } from '../../workers/work/flatten';
import { editsSettled } from '../save/pendingEdits';
import { renderEngine, workClient } from '../view/host';

/**
 * The flattened copy's bytes. Progress counts pages; `signal` cancels it
 * between pages.
 */
export async function buildPrintReady(
  docId: string,
  opts: FlattenOptions,
  signal: AbortSignal,
  onProgress: (p: { done: number; total: number }) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  await editsSettled();
  // Unsaved edits: the Render worker's narrow tail, appended to the copy.
  const { tail } = await renderEngine().rpc.call('snapshotTail', { docId }).promise;
  signal.throwIfAborted();
  const piece = tail.byteLength > 0 ? tail : undefined;
  const { bytes } = await workClient().run(
    'printReady',
    { docId, ...opts, ...(piece ? { piece } : {}) },
    { signal, onProgress, ...(piece ? { transfer: [piece] } : {}) },
  ).promise;
  return new Uint8Array(bytes);
}

/** "plan.pdf" → "plan (print-ready).pdf" (localized). */
export function printReadyName(name: string): string {
  const base = name.replace(/\.pdf$/i, '');
  return t('printReady.fileName', { base });
}

interface ExportState {
  docId: string | null;
  running: { done: number; total: number } | null;
  error: 'failed' | null;
}

export const exportStore = createStore<ExportState>()(() => ({
  docId: null,
  running: null,
  error: null,
}));

export function useExport<T>(selector: (s: ExportState) => T): T {
  return useStore(exportStore, selector);
}

let job: AbortController | null = null;

export function openExport(docId: string): void {
  exportStore.setState({ docId, running: null, error: null });
}

export function closeExport(): void {
  job?.abort();
  job = null;
  exportStore.setState({ docId: null, running: null, error: null });
}

export function cancelExport(): void {
  job?.abort();
}

/**
 * Asks where to save (first: the picker needs the click's gesture), builds
 * the copy and writes it. Resolves once written, cancelled or failed.
 */
export async function startExport(): Promise<void> {
  const { docId, running } = exportStore.getState();
  const name = docId ? documentStore.getState().docs[docId]?.meta.name : undefined;
  if (!docId || name === undefined || running) return;
  const fileName = printReadyName(name);
  const controller = new AbortController();
  job = controller;
  exportStore.setState({ running: { done: 0, total: 0 }, error: null });
  try {
    let handle: FileSystemFileHandle | undefined;
    if (accessStrategy() === 'fsa') {
      handle = await pickSaveTarget(fileName);
      if (!handle) {
        exportStore.setState({ running: null });
        return;
      }
    }
    const bytes = await buildPrintReady(
      docId,
      { pages: null, markups: 'on' },
      controller.signal,
      (p) => {
        if (!controller.signal.aborted) exportStore.setState({ running: p });
      },
    );
    controller.signal.throwIfAborted();
    if (handle) await writeToHandle(handle, bytes, controller.signal);
    else downloadBytes(bytes, fileName);
    exportStore.setState({ docId: null, running: null, error: null });
  } catch {
    const cancelled = controller.signal.aborted;
    exportStore.setState({ running: null, error: cancelled ? null : 'failed' });
  } finally {
    if (job === controller) job = null;
  }
}
