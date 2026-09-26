// Settings → "Clear all local data" (M1-26, §10.3). Deletes the IndexedDB
// database (settings, recent files), the OPFS recovery snapshots (through the
// storage worker, which owns OPFS) and any Cache Storage the app keeps apart
// from the service worker's offline copy of the app itself, so PDFTools keeps
// working (and working offline) afterwards. Never touches the user's files.
// Pure over its dependencies (the app's are in appClearDeps.ts).
import { recordError } from '../../app/diagnostics';
import { APP_FILES_CACHE } from './storedData';

export type ClearPart = 'recovery' | 'indexedDB' | 'caches';

export interface ClearDeps {
  clearRecovery: () => Promise<void>;
  deleteDatabase: () => Promise<void>;
  cacheNames: () => Promise<string[]>;
  deleteCache: (name: string) => Promise<unknown>;
  /** In-memory state that mirrors what was deleted. */
  reset: () => void;
}

export interface ClearResult {
  /** Parts that could not be cleared (each is attempted regardless of the others). */
  failed: ClearPart[];
}

export async function clearAllLocalData(deps: ClearDeps): Promise<ClearResult> {
  const failed: ClearPart[] = [];
  const attempt = async (part: ClearPart, job: () => Promise<unknown>): Promise<void> => {
    try {
      await job();
    } catch (err) {
      recordError('settings.clearAll', err);
      failed.push(part);
    }
  };
  await attempt('recovery', deps.clearRecovery);
  await attempt('indexedDB', deps.deleteDatabase);
  await attempt('caches', async () => {
    for (const name of await deps.cacheNames()) {
      if (!APP_FILES_CACHE.test(name)) await deps.deleteCache(name);
    }
  });
  deps.reset();
  return { failed };
}
