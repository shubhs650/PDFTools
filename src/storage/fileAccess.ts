// File access (ARCHITECTURE §4.1, §4.2, D-04). Chromium: File System Access
// API pickers and in-place writes. Firefox/Safari: `<input type=file>` to open,
// a download to save.
//
// Rule 7: nothing in the app writes to a user's file except `appendToHandle`
// and `writeToHandle`, called by the explicit Save commands. Both can be
// aborted before commit, which leaves the file untouched (the browser writes
// to a swap file and only replaces the original on close()).

import { AbortError } from '../engine/errors';

const PDF_TYPES = [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] as const;

interface PickerWindow {
  showOpenFilePicker?: (options: {
    multiple?: boolean;
    types?: typeof PDF_TYPES;
    id?: string;
  }) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: typeof PDF_TYPES;
    id?: string;
  }) => Promise<FileSystemFileHandle>;
}

type PermissionMode = 'read' | 'readwrite';
interface PermissionHandle {
  queryPermission?: (d: { mode: PermissionMode }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: PermissionMode }) => Promise<PermissionState>;
}

export type AccessStrategy = 'fsa' | 'fallback';

/** FSA when the pickers exist (Chromium desktop); otherwise input + download. */
export function accessStrategy(win: object = window): AccessStrategy {
  const w = win as PickerWindow;
  return typeof w.showOpenFilePicker === 'function' && typeof w.showSaveFilePicker === 'function'
    ? 'fsa'
    : 'fallback';
}

export interface OpenedFile {
  file: File;
  /** Present on the FSA path: enables in-place save and the recent list. */
  handle?: FileSystemFileHandle;
}

const isAbort = (err: unknown): boolean => (err as DOMException | undefined)?.name === 'AbortError';

/** Open dialog (§4.1). Resolves [] when the user cancels. */
export async function pickPdfFiles(win: Window = window): Promise<OpenedFile[]> {
  if (accessStrategy(win) === 'fsa') {
    try {
      const handles = await (win as PickerWindow).showOpenFilePicker?.({
        multiple: true,
        types: PDF_TYPES,
        id: 'pdftools-open',
      });
      return await Promise.all(
        (handles ?? []).map(async (handle) => ({ file: await handle.getFile(), handle })),
      );
    } catch (err) {
      if (isAbort(err)) return [];
      throw err;
    }
  }
  return pickWithInput(win.document);
}

function pickWithInput(doc: Document): Promise<OpenedFile[]> {
  return new Promise((resolve) => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,application/pdf';
    input.multiple = true;
    input.addEventListener('change', () => {
      resolve([...(input.files ?? [])].map((file) => ({ file })));
    });
    input.addEventListener('cancel', () => {
      resolve([]);
    });
    input.click();
  });
}

/** Save As target (§4.2); undefined on the fallback path or if cancelled. */
export async function pickSaveTarget(
  suggestedName: string,
  win: Window = window,
): Promise<FileSystemFileHandle | undefined> {
  if (accessStrategy(win) !== 'fsa') return undefined;
  try {
    return await (win as PickerWindow).showSaveFilePicker?.({
      suggestedName,
      types: PDF_TYPES,
      id: 'pdftools-save',
    });
  } catch (err) {
    if (isAbort(err)) return undefined;
    throw err;
  }
}

/** Reopening a recent file asks for permission again (§4.1). */
export async function ensurePermission(
  handle: FileSystemFileHandle,
  mode: PermissionMode,
): Promise<boolean> {
  const h = handle as FileSystemFileHandle & PermissionHandle;
  if ((await h.queryPermission?.({ mode })) === 'granted') return true;
  return (await h.requestPermission?.({ mode })) === 'granted';
}

export class FileChangedError extends Error {
  override readonly name = 'FileChangedError';
}

/**
 * Ctrl+S (§4.2): appends `tail` at `expectedSize`. Refuses if the file on disk
 * no longer has the size it had when opened (changed by another program).
 * Aborting before commit leaves the file untouched.
 */
export async function appendToHandle(
  handle: FileSystemFileHandle,
  expectedSize: number,
  tail: Uint8Array<ArrayBuffer> | Blob,
  signal?: AbortSignal,
): Promise<void> {
  const current = (await handle.getFile()).size;
  if (current !== expectedSize) throw new FileChangedError('The file changed on disk');
  await commit(await handle.createWritable({ keepExistingData: true }), signal, async (w) => {
    await w.seek(expectedSize);
    await w.write(tail);
  });
}

/** Chunk size for writes that report progress (M1-23). */
export const WRITE_CHUNK = 8 * 1024 * 1024;

/**
 * Save As / Save Optimized to a chosen handle: replaces its content. Written
 * in chunks with `progress`, and cancellable between chunks until the commit.
 */
export async function writeToHandle(
  handle: FileSystemFileHandle,
  bytes: Uint8Array<ArrayBuffer> | Blob,
  signal?: AbortSignal,
  progress?: (done: number, total: number) => void,
): Promise<void> {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes]);
  await commit(await handle.createWritable(), signal, async (w) => {
    for (let at = 0; at < blob.size || at === 0; at += WRITE_CHUNK) {
      if (signal?.aborted) throw new AbortError();
      progress?.(at, blob.size);
      await w.write(blob.slice(at, at + WRITE_CHUNK));
      progress?.(Math.min(at + WRITE_CHUNK, blob.size), blob.size);
      if (blob.size === 0) break;
    }
  });
}

async function commit(
  writable: FileSystemWritableFileStream,
  signal: AbortSignal | undefined,
  write: (w: FileSystemWritableFileStream) => Promise<void>,
): Promise<void> {
  try {
    if (signal?.aborted) throw new AbortError();
    await write(writable);
    if (signal?.aborted) throw new AbortError();
  } catch (err) {
    await writable.abort().catch(() => undefined);
    throw err;
  }
  await writable.close();
}

/** Fallback save (§4.1): the browser downloads a new file; the original is untouched. */
export function downloadBytes(
  bytes: Uint8Array<ArrayBuffer> | Blob,
  fileName: string,
  doc: Document = document,
): void {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = fileName;
  a.hidden = true;
  doc.body.append(a);
  a.click();
  a.remove();
  // Give the download time to start before revoking.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
}
