// Export framework (M4-04, §7.6): the dialog's choices → the pages → where to
// save (asked first, while the click's gesture is fresh) → the Work worker job
// with progress and Cancel (rule 2) → the file written. The main thread only
// ever holds a Blob handle from the worker (rule 1). Every export in M4
// (text, Markdown, HTML, images, Word, tables, annotations) runs through here;
// M4-05 onwards add formats and their ribbon commands.
import { createStore, useStore } from 'zustand';
import { recordError } from '../../app/diagnostics';
import { documentStore } from '../../app/store/documentStore';
import { RpcError } from '../../engine/errors';
import { t } from '../../i18n';
import {
  accessStrategy,
  downloadBytes,
  pickFileSaveTarget,
  writeToHandle,
} from '../../storage/fileAccess';
import type { ExtractFormat } from '../../workers/work/extract';
import { DENIED } from '../../workers/work/permissionGate';
import { workClient } from '../view/host';
import { resolveScope, type Scope } from './scope';

export type ExportError =
  'empty' | 'syntax' | 'outOfRange' | 'noSelection' | 'denied' | 'failed' | 'noDocument';

interface ExportState {
  docId: string | null;
  format: ExtractFormat | null;
  running: { done: number; total: number } | null;
  error: ExportError | null;
}

export const exportStore = createStore<ExportState>()(() => ({
  docId: null,
  format: null,
  running: null,
  error: null,
}));

export function useExport<T>(selector: (s: ExportState) => T): T {
  return useStore(exportStore, selector);
}

/** File extension of each format's single-file output. */
export const EXTENSIONS: Record<ExtractFormat, string> = { text: 'txt' };

/** The last file made (e2e builds only: the test hook reads it). */
export let lastExport: { name: string; blob: Blob } | null = null;

let job: AbortController | null = null;

export function openExport(docId: string, format: ExtractFormat): void {
  if (!documentStore.getState().docs[docId]) return;
  exportStore.setState({ docId, format, running: null, error: null });
}

export function closeExport(): void {
  job?.abort();
  job = null;
  exportStore.setState({ docId: null, format: null, running: null, error: null });
}

export function cancelExport(): void {
  job?.abort();
}

/** "plan.pdf" → "plan.txt". */
export function exportFileName(name: string, format: ExtractFormat): string {
  return t('export.fileName', { base: name.replace(/\.pdf$/iu, ''), ext: EXTENSIONS[format] });
}

/**
 * Runs the export chosen in the dialog. Resolves once the file is written,
 * or the job was cancelled or failed (the store says which).
 */
export async function startExport(scope: Scope): Promise<void> {
  const { docId, format, running } = exportStore.getState();
  const d = docId ? documentStore.getState().docs[docId] : undefined;
  if (!docId || !format || running) return;
  if (!d) {
    exportStore.setState({ error: 'noDocument' });
    return;
  }
  const pages = resolveScope(scope, { pageCount: d.meta.pageCount, current: d.view.page });
  if (!pages.ok) {
    exportStore.setState({ error: pages.error });
    return;
  }
  const fileName = exportFileName(d.meta.name, format);
  const controller = new AbortController();
  job = controller;
  exportStore.setState({ running: { done: 0, total: pages.pages.length }, error: null });
  try {
    let handle: FileSystemFileHandle | undefined;
    if (accessStrategy() === 'fsa') {
      handle = await pickFileSaveTarget(fileName);
      if (!handle) {
        exportStore.setState({ running: null });
        return;
      }
    }
    const { blob } = await workClient().run(
      'extract',
      { docId, pages: pages.pages, format },
      {
        signal: controller.signal,
        onProgress: (p) => {
          if (!controller.signal.aborted) exportStore.setState({ running: p });
        },
      },
    ).promise;
    controller.signal.throwIfAborted();
    if (import.meta.env.MODE === 'e2e') lastExport = { name: fileName, blob };
    if (handle) await writeToHandle(handle, blob, controller.signal);
    else downloadBytes(blob, fileName);
    exportStore.setState({ docId: null, format: null, running: null, error: null });
  } catch (err) {
    const cancelled = controller.signal.aborted;
    const denied = err instanceof RpcError && err.code.startsWith(DENIED);
    // Content-free (rule 10): the error's code and message are ours.
    if (!cancelled && !denied) recordError('export.run', err);
    exportStore.setState({ running: null, error: cancelled ? null : denied ? 'denied' : 'failed' });
  } finally {
    if (job === controller) job = null;
  }
}
