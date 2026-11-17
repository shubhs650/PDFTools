// Rename File… on the tab menu (M11-05, ADR-028 D-50): renames the original file in
// place with File System Access `move()` (Chromium 111+, write permission asked for
// here). Offered only where that exists (tabCommands.canRenameFile); never a fake
// rename that only changes the tab.
import { createStore, useStore } from 'zustand';
import { recentStore, renameRecent } from '../features/recent/recent';
import { sources } from '../features/open/sources';
import { ensurePermission } from '../storage/fileAccess';
import { documentStore } from './store/documentStore';
import { renameTarget, type RenameError } from './tabMenu';

export type RenameFailure =
  | RenameError
  /** An open tab or a recent file has this name: `move()` could write over it. */
  | 'taken'
  | 'denied'
  /** Another program or tab is writing the file. */
  | 'busy'
  | 'failed'
  | 'gone';

interface RenameState {
  docId: string | null;
}

export const renameStore = createStore<RenameState>()(() => ({ docId: null }));

export const useRename = <T>(sel: (s: RenameState) => T): T => useStore(renameStore, sel);

export function openRename(docId: string): void {
  renameStore.setState({ docId });
}

export function closeRename(): void {
  renameStore.setState({ docId: null });
}

type Movable = FileSystemFileHandle & { move(name: string): Promise<void> };

/**
 * Renames document `docId`'s file to what the user typed (".pdf" added when missing).
 * Resolves null when done (or nothing to change), else why not. Must run from the
 * dialog's click: the browser may ask for write permission.
 */
export async function renameFile(docId: string, typed: string): Promise<RenameFailure | null> {
  const target = renameTarget(typed);
  if (target.error) return target.error;
  const name = target.name;
  const s = documentStore.getState();
  const doc = s.docs[docId];
  const src = sources.get(docId);
  const handle = src?.handle as Movable | undefined;
  if (!doc || !src || typeof handle?.move !== 'function') return 'gone';
  if (name === doc.meta.name) return null;
  // `move()` replaces a file of that name when the app may already write to it: never
  // let a rename land on another file the user opened here.
  const lower = name.toLowerCase();
  const own = lower === doc.meta.name.toLowerCase(); // only the letter case changes
  const names = [
    ...s.order.filter((d) => d !== docId).map((d) => s.docs[d]?.meta.name ?? ''),
    ...recentStore.getState().entries.map((e) => e.name),
  ];
  if (!own && names.some((n) => n.toLowerCase() === lower)) return 'taken';
  try {
    if (!(await ensurePermission(handle, 'readwrite'))) return 'denied';
  } catch {
    return 'denied';
  }
  try {
    await handle.move(name);
  } catch (err) {
    const kind = (err as DOMException | undefined)?.name;
    if (kind === 'NotAllowedError' || kind === 'SecurityError') return 'denied';
    if (kind === 'NoModificationAllowedError') return 'busy';
    if (kind === 'NotFoundError') return 'gone';
    return 'failed';
  }
  documentStore.getState().rename(docId, name);
  // The File read at open points at the old name and can no longer be read; the same
  // bytes are now at the new one.
  try {
    src.file = await handle.getFile();
  } catch {
    // Kept: a later read reports its own error.
  }
  void renameRecent(handle, name).catch(() => undefined); // the recent list is best effort
  return null;
}
