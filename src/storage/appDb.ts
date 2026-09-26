// The app's IndexedDB, opened once on first use (§10.3).
import { AppDb } from './idb';

let db: Promise<AppDb> | undefined;

export function appDb(): Promise<AppDb> {
  db ??= AppDb.open();
  db.catch(() => {
    db = undefined; // blocked or unavailable: try again next time
  });
  return db;
}
