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

type PickerTypes = readonly { description: string; accept: Record<string, readonly string[]> }[];

interface PickerWindow {
  showOpenFilePicker?: (options: {
    multiple?: boolean;
    types?: PickerTypes;
    id?: string;
  }) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: typeof PDF_TYPES;
    id?: string;
  }) => Promise<FileSystemFileHandle>;
  showDirectoryPicker?: (options: {
    id?: string;
    mode?: 'read' | 'readwrite';
  }) => Promise<FileSystemDirectoryHandle>;
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

/** Import Comments (M4-20): one PDF or one of our JSON exports. Resolves null when cancelled. */
export async function pickCommentSource(win: Window = window): Promise<File | null> {
  if (accessStrategy(win) === 'fsa') {
    try {
      const [handle] =
        (await (win as PickerWindow).showOpenFilePicker?.({
          multiple: false,
          types: [
            {
              description: 'PDF, JSON',
              accept: { 'application/pdf': ['.pdf'], 'application/json': ['.json'] },
            },
          ],
          id: 'pdftools-comments',
        })) ?? [];
      return handle ? await handle.getFile() : null;
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
  }
  const [picked] = await pickWithInput(
    win.document,
    '.pdf,application/pdf,.json,application/json',
    false,
  );
  return picked?.file ?? null;
}

/** Attach File (M6-10): one file of any type. Resolves null when cancelled. */
export async function pickAnyFile(win: Window = window): Promise<File | null> {
  if (accessStrategy(win) === 'fsa') {
    try {
      const [handle] =
        (await (win as PickerWindow).showOpenFilePicker?.({
          multiple: false,
          id: 'pdftools-attach',
        })) ?? [];
      return handle ? await handle.getFile() : null;
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
  }
  const [picked] = await pickWithInput(win.document, '', false);
  return picked?.file ?? null;
}

function pickWithInput(
  doc: Document,
  accept = '.pdf,application/pdf',
  multiple = true,
): Promise<OpenedFile[]> {
  return new Promise((resolve) => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
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

/**
 * Save target for a file that isn't the document (an attachment, M2-11): any
 * type, the name the file carries. undefined on the fallback path or if cancelled.
 */
export async function pickFileSaveTarget(
  suggestedName: string,
  win: Window = window,
): Promise<FileSystemFileHandle | undefined> {
  if (accessStrategy(win) !== 'fsa') return undefined;
  try {
    return await (win as PickerWindow).showSaveFilePicker?.({
      suggestedName,
      id: 'pdftools-attachment',
    });
  } catch (err) {
    if (isAbort(err)) return undefined;
    throw err;
  }
}

/** Several exported files can be written straight to a folder (M4-Q5; Chromium). */
export function canPickFolder(win: object = window): boolean {
  return typeof (win as PickerWindow).showDirectoryPicker === 'function';
}

/**
 * Folder for several exported files (images, one CSV per table — M4-Q5);
 * undefined where the browser has no folder picker, or if cancelled.
 */
export async function pickFolderTarget(
  win: Window = window,
): Promise<FileSystemDirectoryHandle | undefined> {
  if (!canPickFolder(win)) return undefined;
  try {
    return await (win as PickerWindow).showDirectoryPicker?.({
      id: 'pdftools-export',
      mode: 'readwrite',
    });
  } catch (err) {
    if (isAbort(err)) return undefined;
    throw err;
  }
}

/** "a.png" → "a (2).png" … until the name is free in `taken` (case-insensitive). */
export function freeName(name: string, taken: ReadonlySet<string>): string {
  const dot = name.lastIndexOf('.');
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  let n = name;
  for (let i = 2; taken.has(n.toLowerCase()); i++) n = `${base} (${String(i)})${ext}`;
  return n;
}

async function namesIn(dir: FileSystemDirectoryHandle): Promise<Set<string>> {
  const taken = new Set<string>();
  const keys = (dir as unknown as { keys?: () => AsyncIterable<string> }).keys?.();
  if (keys) for await (const k of keys) taken.add(k.toLowerCase());
  return taken;
}

/**
 * Writes the files into `dir` — or, with `subfolder`, into a new folder of
 * that name inside it (" (2)" if taken) — never replacing anything already
 * there; paths may contain "/" (created as folders). One file after another,
 * cancellable between files. Returns the folder written to.
 */
export async function writeFilesToFolder(
  dir: FileSystemDirectoryHandle,
  files: readonly { path: string; blob: Blob }[],
  opts: {
    subfolder?: string;
    signal?: AbortSignal;
    progress?: (done: number, total: number) => void;
  } = {},
): Promise<string> {
  let root = dir;
  let rootName = dir.name;
  if (opts.subfolder !== undefined) {
    rootName = freeName(opts.subfolder, await namesIn(dir));
    root = await dir.getDirectoryHandle(rootName, { create: true });
  }
  const taken = new Map<FileSystemDirectoryHandle, Set<string>>();
  const folders = new Map<string, FileSystemDirectoryHandle>([['', root]]);
  for (const [i, f] of files.entries()) {
    if (opts.signal?.aborted) throw new AbortError();
    const parts = f.path.split('/').filter((p) => p !== '' && p !== '.' && p !== '..');
    const leaf = parts.pop() ?? 'file';
    let at = root;
    let key = '';
    for (const part of parts) {
      key = `${key}/${part}`;
      let next = folders.get(key);
      if (!next) {
        next = await at.getDirectoryHandle(part, { create: true });
        folders.set(key, next);
      }
      at = next;
    }
    let names = taken.get(at);
    if (!names) {
      names = await namesIn(at);
      taken.set(at, names);
    }
    const name = freeName(leaf, names);
    names.add(name.toLowerCase());
    const handle = await at.getFileHandle(name, { create: true });
    await writeToHandle(handle, f.blob, opts.signal);
    opts.progress?.(i + 1, files.length);
  }
  return rootName;
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
