// Recent files (§4.1, §8, §10.3, D-04, M1-18): the File System Access handles
// of opened files, kept in IndexedDB with display metadata (name, size, last
// opened). Only the FSA path has handles; the Firefox/Safari fallback has no
// recent list. Reopening asks for permission again (§4.1).
import { createStore, useStore } from 'zustand';
import { appDb } from '../../storage/appDb';
import { accessStrategy, ensurePermission } from '../../storage/fileAccess';
import type { RecentEntry } from '../../storage/idb';
import { openFiles } from '../open/openDocument';

export type RecentProblem = 'denied' | 'missing';

interface RecentState {
  entries: RecentEntry[];
  /** A reopen that failed, shown next to the list until dismissed. */
  problem: { id: string; name: string; kind: RecentProblem } | null;
}

export const recentStore = createStore<RecentState>()(() => ({ entries: [], problem: null }));

export function useRecent<T>(selector: (s: RecentState) => T): T {
  return useStore(recentStore, selector);
}

/** Whether this browser can keep a recent list at all (it needs file handles). */
export const recentSupported = (): boolean => accessStrategy() === 'fsa';

export async function loadRecent(): Promise<void> {
  if (!recentSupported()) return;
  const entries = await (await appDb()).listRecent();
  recentStore.setState({ entries });
}

/**
 * Entries for the same file on disk as `handle` (other fingerprints: the file
 * changed since, e.g. saved). Compared with `isSameEntry`.
 */
export async function sameFileEntries(
  entries: readonly RecentEntry[],
  handle: FileSystemFileHandle,
): Promise<RecentEntry[]> {
  const out: RecentEntry[] = [];
  for (const e of entries) {
    if (e.handle && (await e.handle.isSameEntry(handle).catch(() => false))) out.push(e);
  }
  return out;
}

/** Called after a successful open (M1-13 pipeline). */
export async function recordOpened(opened: {
  file: File;
  handle?: FileSystemFileHandle;
  fingerprint: string;
  now?: number;
}): Promise<void> {
  const { file, handle, fingerprint } = opened;
  if (!handle || !recentSupported()) return;
  const db = await appDb();
  for (const old of await sameFileEntries(await db.listRecent(100), handle)) {
    if (old.id !== fingerprint) await db.removeRecent(old.id);
  }
  await db.putRecent({
    id: fingerprint,
    name: file.name,
    size: file.size,
    lastOpened: opened.now ?? Date.now(),
    handle,
  });
  await loadRecent();
}

export async function removeRecent(id: string): Promise<void> {
  await (await appDb()).removeRecent(id);
  recentStore.setState((s) => ({ problem: s.problem?.id === id ? null : s.problem }));
  await loadRecent();
}

export async function clearRecent(): Promise<void> {
  const db = await appDb();
  for (const e of await db.listRecent(1000)) await db.removeRecent(e.id);
  recentStore.setState({ problem: null });
  await loadRecent();
}

export function dismissProblem(): void {
  recentStore.setState({ problem: null });
}

/** Reopens a recent file; must run from a click (permission prompt needs user activation). */
export async function openRecent(entry: RecentEntry): Promise<boolean> {
  const report = (kind: RecentProblem): false => {
    recentStore.setState({ problem: { id: entry.id, name: entry.name, kind } });
    return false;
  };
  if (!entry.handle) return report('missing');
  let granted: boolean;
  try {
    granted = await ensurePermission(entry.handle, 'read');
  } catch {
    return report('missing');
  }
  if (!granted) return report('denied');
  let file: File;
  try {
    file = await entry.handle.getFile();
  } catch {
    return report('missing');
  }
  recentStore.setState({ problem: null });
  const [id] = await openFiles([{ file, handle: entry.handle }]);
  return id !== undefined;
}
