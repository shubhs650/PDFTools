import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  AppDb,
  MAX_RECENT,
  MIGRATIONS,
  type Migration,
  type RecentEntry,
} from '../../src/storage/idb';

const entry = (id: string, lastOpened: number): RecentEntry => ({
  id,
  name: `${id}.pdf`,
  size: 1000,
  lastOpened,
});

describe('AppDb (M1-12)', () => {
  it('creates schema v1 with settings and recent', async () => {
    const db = await AppDb.open({ factory: new IDBFactory() });
    expect(db.db.version).toBe(MIGRATIONS.length);
    expect([...db.db.objectStoreNames].sort()).toEqual(['recent', 'settings']);
    db.close();
  });

  it('reads and writes settings', async () => {
    const db = await AppDb.open({ factory: new IDBFactory() });
    expect(await db.getSetting('theme')).toBeUndefined();
    await db.setSetting('theme', 'light');
    await db.setSetting('zoom', { mode: 'fitWidth' });
    expect(await db.getSetting('theme')).toBe('light');
    expect(await db.getSetting('zoom')).toEqual({ mode: 'fitWidth' });
    db.close();
  });

  it('lists recent files newest first, refreshes, removes and caps the list', async () => {
    const db = await AppDb.open({ factory: new IDBFactory() });
    await db.putRecent(entry('a', 1));
    await db.putRecent(entry('b', 3));
    await db.putRecent(entry('c', 2));
    expect((await db.listRecent()).map((e) => e.id)).toEqual(['b', 'c', 'a']);
    await db.putRecent(entry('a', 4)); // reopened
    expect((await db.listRecent()).map((e) => e.id)).toEqual(['a', 'b', 'c']);
    await db.removeRecent('b');
    expect((await db.listRecent()).map((e) => e.id)).toEqual(['a', 'c']);
    for (let i = 0; i < MAX_RECENT + 5; i++) await db.putRecent(entry(`n${String(i)}`, 10 + i));
    const all = await db.listRecent(100);
    expect(all).toHaveLength(MAX_RECENT);
    expect(all[0]?.id).toBe(`n${String(MAX_RECENT + 4)}`);
    expect(all.some((e) => e.id === 'a')).toBe(false); // oldest dropped
    db.close();
  });

  it('clears all local data', async () => {
    const db = await AppDb.open({ factory: new IDBFactory() });
    await db.setSetting('x', 1);
    await db.putRecent(entry('a', 1));
    await db.clearAll();
    expect(await db.getSetting('x')).toBeUndefined();
    expect(await db.listRecent()).toEqual([]);
    db.close();
  });

  it('upgrades an existing database without losing data', async () => {
    const factory = new IDBFactory();
    const v1 = await AppDb.open({ factory });
    await v1.setSetting('theme', 'light');
    await v1.putRecent(entry('a', 1));
    v1.close();

    const v2: Migration = (db, tx) => {
      db.createObjectStore('profile');
      tx.objectStore('recent').createIndex('name', 'name');
    };
    const upgraded = await AppDb.open({ factory, migrations: [...MIGRATIONS, v2] });
    expect(upgraded.db.version).toBe(2);
    expect(upgraded.db.objectStoreNames.contains('profile')).toBe(true);
    expect(await upgraded.getSetting('theme')).toBe('light');
    expect((await upgraded.listRecent()).map((e) => e.id)).toEqual(['a']);
    upgraded.close();
  });

  it('closes itself when another tab upgrades the schema', async () => {
    const factory = new IDBFactory();
    const old = await AppDb.open({ factory });
    const next = await AppDb.open({ factory, migrations: [...MIGRATIONS, () => undefined] });
    expect(next.db.version).toBe(2);
    next.close();
    expect(() => old.db.transaction('settings')).toThrow();
  });
});
