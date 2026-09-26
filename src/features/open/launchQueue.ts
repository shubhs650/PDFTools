// OS file launches (D-21, §4.1, M1-19): with the installed PWA, opening a .pdf
// from Explorer (manifest file_handlers) delivers its handles through
// `window.launchQueue`. launch_handler "focus-existing" routes them to the
// open window, where each becomes a tab; a file that is already open is
// focused instead (duplicate detection in the open pipeline).
import type { OpenedFile } from '../../storage/fileAccess';
import { openFiles } from './openDocument';

interface LaunchParams {
  files: readonly FileSystemHandle[];
}

interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => unknown): void;
}

export async function filesFromLaunch(params: LaunchParams): Promise<OpenedFile[]> {
  const out: OpenedFile[] = [];
  for (const h of params.files) {
    if (h.kind !== 'file') continue;
    const handle = h as FileSystemFileHandle;
    try {
      out.push({ file: await handle.getFile(), handle });
    } catch {
      // Unreadable (moved or permission gone): the open pipeline can't use it either.
    }
  }
  return out;
}

/** Registers the consumer once at startup; false where the browser has no launchQueue. */
export function installLaunchQueue(
  win: object = window,
  open: (files: readonly OpenedFile[]) => Promise<unknown> = openFiles,
): boolean {
  const queue = (win as { launchQueue?: LaunchQueue }).launchQueue;
  if (typeof queue?.setConsumer !== 'function') return false;
  queue.setConsumer(async (params) => {
    const files = await filesFromLaunch(params);
    if (files.length > 0) await open(files);
  });
  return true;
}
