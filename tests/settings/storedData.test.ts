import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { clearAllLocalData, type ClearDeps } from '../../src/features/settings/clearAll';
import { APP_FILES_CACHE, LOCAL_DATA } from '../../src/features/settings/storedData';
import { deleteAppDb } from '../../src/storage/appDb';
import { AppDb, DB_NAME } from '../../src/storage/idb';
import { RECOVERY_DIR } from '../../src/storage/recoveryTypes';

describe('local data list (M1-26)', () => {
  it('lists exactly the IndexedDB stores the migrations create', async () => {
    const db = await AppDb.open({ factory: new IDBFactory() });
    const stores = [...db.db.objectStoreNames].sort();
    db.close();
    const listed = LOCAL_DATA.filter((d) => d.kind === 'indexedDB');
    expect(listed.map((d) => d.store).sort()).toEqual(stores);
    for (const d of listed) expect(d.location.startsWith(DB_NAME)).toBe(true);
  });

  it('lists the OPFS recovery directory and the app-files cache', () => {
    expect(LOCAL_DATA.filter((d) => d.kind === 'opfs').map((d) => d.store)).toEqual([RECOVERY_DIR]);
    const cache = LOCAL_DATA.find((d) => d.kind === 'cache');
    expect(cache?.cleared).toBe(false);
    expect(LOCAL_DATA.filter((d) => d.kind !== 'cache').every((d) => d.cleared)).toBe(true);
  });

  it('recognizes the service worker cache names as app files', () => {
    expect(APP_FILES_CACHE.test('pdftools-8c9a01ff')).toBe(true);
    expect(APP_FILES_CACHE.test('pdftools-data')).toBe(false);
    expect(APP_FILES_CACHE.test('other')).toBe(false);
  });
});

function deps(overrides: Partial<ClearDeps> = {}) {
  const calls: string[] = [];
  const d: ClearDeps = {
    clearRecovery: () => {
      calls.push('recovery');
      return Promise.resolve();
    },
    deleteDatabase: () => {
      calls.push('idb');
      return Promise.resolve();
    },
    cacheNames: () => Promise.resolve(['pdftools-1a2b3c', 'pdftools-data-x', 'thumbnails']),
    deleteCache: (name) => {
      calls.push(`cache:${name}`);
      return Promise.resolve(true);
    },
    reset: () => {
      calls.push('reset');
    },
    ...overrides,
  };
  return { d, calls };
}

describe('clearAllLocalData (M1-26)', () => {
  it('clears recovery, IndexedDB and non-app caches, keeping the offline app files', async () => {
    const { d, calls } = deps();
    expect(await clearAllLocalData(d)).toEqual({ failed: [] });
    expect(calls).toEqual([
      'recovery',
      'idb',
      'cache:pdftools-data-x',
      'cache:thumbnails',
      'reset',
    ]);
  });

  it('attempts every part even when one fails, and reports which failed', async () => {
    const { d, calls } = deps({
      clearRecovery: () => Promise.reject(new Error('locked')),
    });
    expect(await clearAllLocalData(d)).toEqual({ failed: ['recovery'] });
    expect(calls).toContain('idb');
    expect(calls).toContain('reset');
  });

  it('deleteAppDb removes the database removes every store; reopening recreates it empty', async () => {
    const factory = new IDBFactory();
    const db = await AppDb.open({ factory });
    await db.setSetting('theme', 'dark');
    await db.putRecent({ id: 'a', name: 'a.pdf', size: 1, lastOpened: 1 });
    db.close();
    await deleteAppDb(factory);
    const again = await AppDb.open({ factory });
    expect(await again.getSetting('theme')).toBeUndefined();
    expect(await again.listRecent()).toEqual([]);
    again.close();
  });
});
