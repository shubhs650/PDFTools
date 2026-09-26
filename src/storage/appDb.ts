// The app's IndexedDB, opened once on first use (§10.3).
import { AppDb, DB_NAME } from './idb';

let db: Promise<AppDb> | undefined;

export function appDb(): Promise<AppDb> {
  if (db) return db;
  const opening = AppDb.open();
  db = opening;
  opening.then(
    (a) => {
      // Deleted or upgraded elsewhere (another tab's "Clear all local data"):
      // AppDb closes itself; open a fresh connection next time.
      a.db.addEventListener('versionchange', () => {
        if (db === opening) db = undefined;
      });
    },
    () => {
      if (db === opening) db = undefined; // blocked or unavailable: try again next time
    },
  );
  return opening;
}

/**
 * Settings → "Clear all local data" (M1-26): closes our connection and deletes
 * the whole database; the next `appDb()` recreates it empty. Other tabs close
 * their connections on `versionchange`, which lets the delete proceed.
 */
export async function deleteAppDb(factory: IDBFactory = indexedDB): Promise<void> {
  const current = db;
  db = undefined;
  if (current) (await current.catch(() => undefined))?.close();
  await new Promise<void>((resolve, reject) => {
    const req = factory.deleteDatabase(DB_NAME);
    req.onsuccess = () => {
      resolve();
    };
    req.onerror = () => {
      reject(req.error ?? new Error('IndexedDB delete failed'));
    };
  });
}
