// Export framework (M4-04, M4-05, §7.6): the dialog's choices → the pages →
// where to save (asked first, while the click's gesture is fresh) → the Work
// worker job with progress and Cancel (rule 2) → the file(s) written. The main
// thread only ever holds Blob handles from the worker (rule 1). Several files
// (Markdown with its images) go into a new folder where the browser can write
// one, else into one ZIP (M4-Q5).
import { createStore, useStore } from 'zustand';
import { recordError } from '../../app/diagnostics';
import { documentStore } from '../../app/store/documentStore';
import { RpcError } from '../../engine/errors';
import { i18n, t } from '../../i18n';
import {
  accessStrategy,
  canPickFolder,
  downloadBytes,
  pickFileSaveTarget,
  pickFolderTarget,
  writeFilesToFolder,
  writeToHandle,
} from '../../storage/fileAccess';
import type { ExtractFormat, ExtractOptions } from '../../workers/work/extract';
import { DENIED } from '../../workers/work/permissionGate';
import { workClient } from '../view/host';
import { resolveScope, type Scope } from './scope';

/** What the dialog exports: an Oxide format (M4-05) or the page images (M4-06). */
export type ExportFormat = ExtractFormat | 'images';

export type ExportError =
  'empty' | 'syntax' | 'outOfRange' | 'noSelection' | 'denied' | 'failed' | 'noDocument';

interface ExportState {
  docId: string | null;
  format: ExportFormat | null;
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

/** Extension of each format's main file. */
export const EXTENSIONS: Record<ExportFormat, string> = {
  text: 'txt',
  markdown: 'md',
  html: 'html',
  word: 'docx',
  images: 'zip',
};

/** Formats that can bring their images along (Markdown as files, HTML embedded). */
export const HAS_IMAGES: Record<ExportFormat, boolean> = {
  text: false,
  markdown: true,
  html: true,
  word: true,
  images: false,
};

export interface ExportChoice {
  scope: Scope;
  images: boolean;
  /** Word: each PDF page starts a new page. */
  pageBreaks?: boolean;
}

/** The last output (e2e builds only: the test hook reads it). */
export let lastExport: { files: { path: string; blob: Blob }[]; packaging: string } | null = null;

let job: AbortController | null = null;

export function openExport(docId: string, format: ExportFormat): void {
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

/** "plan.pdf" → "plan". */
export const baseNameOf = (name: string): string => name.replace(/\.pdf$/iu, '') || name;

export function exportFileName(name: string, ext: string): string {
  return t('export.fileName', { base: baseNameOf(name), ext });
}

function optionsFor(
  format: ExtractFormat,
  base: string,
  images: boolean,
  pageBreaks = false,
): ExtractOptions {
  return {
    pageBreaks,
    format,
    images: images && HAS_IMAGES[format],
    baseName: base,
    title: base,
    lang: i18n.language || 'en',
    // Templates with %P / %N, filled in by the worker (rule 11).
    labels: {
      page: t('export.label.page', { n: '%P' }),
      image: t('export.label.image', { n: '%N', page: '%P' }),
      noText: t('export.label.noText', { n: '%P' }),
    },
  };
}

type Target =
  | { packaging: 'single' | 'zip'; handle?: FileSystemFileHandle; name: string }
  | { packaging: 'folder'; dir: FileSystemDirectoryHandle };

/** Where the output goes, asked before the job (user activation); null if cancelled. */
async function pickTarget(
  base: string,
  format: ExportFormat,
  multi: boolean,
): Promise<Target | null> {
  if (multi && canPickFolder()) {
    const dir = await pickFolderTarget();
    return dir ? { packaging: 'folder', dir } : null;
  }
  const packaging = multi ? 'zip' : 'single';
  const name = exportFileName(base, multi ? 'zip' : EXTENSIONS[format]);
  if (accessStrategy() !== 'fsa') return { packaging, name };
  const handle = await pickFileSaveTarget(name);
  return handle ? { packaging, handle, name } : null;
}

/**
 * Runs the export chosen in the dialog. Resolves once the output is written,
 * or the job was cancelled or failed (the store says which).
 */
export async function startExport(choice: ExportChoice): Promise<void> {
  const { docId, format, running } = exportStore.getState();
  const d = docId ? documentStore.getState().docs[docId] : undefined;
  if (!docId || !format || running) return;
  if (!d) {
    exportStore.setState({ error: 'noDocument' });
    return;
  }
  const pages = resolveScope(choice.scope, { pageCount: d.meta.pageCount, current: d.view.page });
  if (!pages.ok) {
    exportStore.setState({ error: pages.error });
    return;
  }
  const base = baseNameOf(d.meta.name);
  const options =
    format === 'images' ? null : optionsFor(format, base, choice.images, choice.pageBreaks);
  const multi = format === 'images' || (format === 'markdown' && (options?.images ?? false));
  const controller = new AbortController();
  job = controller;
  exportStore.setState({ running: { done: 0, total: pages.pages.length }, error: null });
  try {
    const target = await pickTarget(base, format, multi);
    if (!target) {
      exportStore.setState({ running: null });
      return;
    }
    const call = {
      signal: controller.signal,
      onProgress: (p: { done: number; total: number }) => {
        if (!controller.signal.aborted) exportStore.setState({ running: p });
      },
    };
    const r = options
      ? await workClient().run(
          'extract',
          { docId, pages: pages.pages, options, packaging: target.packaging },
          call,
        ).promise
      : await workClient().run(
          'exportImages',
          {
            docId,
            pages: pages.pages,
            baseName: base,
            packaging: target.packaging === 'folder' ? 'folder' : 'zip',
          },
          call,
        ).promise;
    controller.signal.throwIfAborted();
    if (target.packaging === 'folder') {
      const files = r.files ?? [];
      if (import.meta.env.MODE === 'e2e') lastExport = { files, packaging: 'folder' };
      await writeFilesToFolder(target.dir, files, { subfolder: base, signal: controller.signal });
    } else {
      const blob = r.blob;
      if (!blob) throw new Error('no output');
      if (import.meta.env.MODE === 'e2e')
        lastExport = { files: [{ path: target.name, blob }], packaging: target.packaging };
      if (target.handle) await writeToHandle(target.handle, blob, controller.signal);
      else downloadBytes(blob, target.name);
    }
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
