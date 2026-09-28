// IndexedDB: small app data only (ARCHITECTURE §10.3, D-04). Settings, the
// recent-files list (file handles + display metadata) and the reviewer profile. Never document bytes:
// those live in the user's file and, for recovery, in OPFS (§4.3).
//
// The schema is versioned by the MIGRATIONS list: version N runs migrations
// [oldVersion, N). Append a migration to change the schema; never edit one
// that has shipped.

export const DB_NAME = 'pdftools';

export interface RecentEntry {
  /** Document fingerprint (fingerprint.ts). */
  id: string;
  name: string;
  size: number;
  /** Epoch ms. */
  lastOpened: number;
  /** Absent on the fallback path (no File System Access API). */
  handle?: FileSystemFileHandle;
}

export type Migration = (db: IDBDatabase, tx: IDBTransaction) => void;

export const MIGRATIONS: readonly Migration[] = [
  // v1: settings (key → value) and recent files, newest first by `lastOpened`.
  (db) => {
    db.createObjectStore('settings');
    const recent = db.createObjectStore('recent', { keyPath: 'id' });
    recent.createIndex('lastOpened', 'lastOpened');
  },
  // v2 (M3-07): the reviewer profile (D-16), key → value; one entry, `reviewer`.
  (db) => {
    db.createObjectStore('profile');
  },
  // v3 (M3-13): custom status schemes (D-23), by id.
  (db) => {
    db.createObjectStore('schemes', { keyPath: 'id' });
  },
];

const PROFILE_KEY = 'reviewer';

export const MAX_RECENT = 20;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('IndexedDB request failed'));
    };
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      resolve();
    };
    tx.onabort = tx.onerror = () => {
      reject(tx.error ?? new Error('IndexedDB transaction failed'));
    };
  });
}

export interface OpenOptions {
  name?: string;
  migrations?: readonly Migration[];
  factory?: IDBFactory;
}

export class AppDb {
  readonly db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.db = db;
  }

  static open(options: OpenOptions = {}): Promise<AppDb> {
    const migrations = options.migrations ?? MIGRATIONS;
    const factory = options.factory ?? indexedDB;
    const req = factory.open(options.name ?? DB_NAME, migrations.length);
    req.onupgradeneeded = (ev) => {
      const tx = req.transaction;
      if (!tx) return;
      for (let v = ev.oldVersion; v < migrations.length; v++) migrations[v]?.(req.result, tx);
    };
    return request(req).then((db) => {
      // Another tab upgraded the schema: close so it is not blocked.
      db.onversionchange = () => {
        db.close();
      };
      return new AppDb(db);
    });
  }

  close(): void {
    this.db.close();
  }

  async getSetting<T>(key: string): Promise<T | undefined> {
    const tx = this.db.transaction('settings', 'readonly');
    return (await request(tx.objectStore('settings').get(key))) as T | undefined;
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    const tx = this.db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put(value, key);
    await done(tx);
  }

  /** The reviewer profile as stored (validate it: reviewerProfile.ts). */
  async getProfile(): Promise<unknown> {
    const tx = this.db.transaction('profile', 'readonly');
    return request(tx.objectStore('profile').get(PROFILE_KEY));
  }

  async setProfile(value: unknown): Promise<void> {
    const tx = this.db.transaction('profile', 'readwrite');
    tx.objectStore('profile').put(value, PROFILE_KEY);
    await done(tx);
  }

  /** Custom status schemes as stored (validate them: statusScheme.ts). */
  async listSchemes(): Promise<unknown[]> {
    const tx = this.db.transaction('schemes', 'readonly');
    return request(tx.objectStore('schemes').getAll());
  }

  async putScheme(value: { id: string }): Promise<void> {
    const tx = this.db.transaction('schemes', 'readwrite');
    tx.objectStore('schemes').put(value);
    await done(tx);
  }

  async deleteScheme(id: string): Promise<void> {
    const tx = this.db.transaction('schemes', 'readwrite');
    tx.objectStore('schemes').delete(id);
    await done(tx);
  }

  /** Newest first. */
  async listRecent(limit = MAX_RECENT): Promise<RecentEntry[]> {
    const tx = this.db.transaction('recent', 'readonly');
    const index = tx.objectStore('recent').index('lastOpened');
    const out: RecentEntry[] = [];
    await new Promise<void>((resolve, reject) => {
      const req = index.openCursor(null, 'prev');
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || out.length >= limit) {
          resolve();
          return;
        }
        out.push(cursor.value as RecentEntry);
        cursor.continue();
      };
      req.onerror = () => {
        reject(req.error ?? new Error('IndexedDB cursor failed'));
      };
    });
    return out;
  }

  /** Adds or refreshes an entry, keeping at most `MAX_RECENT` (oldest dropped). */
  async putRecent(entry: RecentEntry): Promise<void> {
    const tx = this.db.transaction('recent', 'readwrite');
    const store = tx.objectStore('recent');
    store.put(entry);
    const count = await request(store.count());
    if (count > MAX_RECENT) {
      let extra = count - MAX_RECENT;
      const cursor = store.index('lastOpened').openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c || extra <= 0) return;
        c.delete();
        extra--;
        c.continue();
      };
    }
    await done(tx);
  }

  async removeRecent(id: string): Promise<void> {
    const tx = this.db.transaction('recent', 'readwrite');
    tx.objectStore('recent').delete(id);
    await done(tx);
  }

  /** Settings → "Clear all local data" (§10.3). */
  async clearAll(): Promise<void> {
    const names = [...this.db.objectStoreNames];
    const tx = this.db.transaction(names, 'readwrite');
    for (const name of names) tx.objectStore(name).clear();
    await done(tx);
  }
}
