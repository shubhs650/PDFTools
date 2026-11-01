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
  it('creates the schema with settings, recent and profile', async () => {
    const db = await AppDb.open({ factory: new IDBFactory() });
    expect(db.db.version).toBe(MIGRATIONS.length);
    expect([...db.db.objectStoreNames].sort()).toEqual([
      'profile',
      'recent',
      'schemes',
      'settings',
      'tableTemplates',
      'toolDefaults',
    ]);
    db.close();
  });

  it('migrates v1 to v2 (M3-07) keeping settings and recent files', async () => {
    const factory = new IDBFactory();
    const v1 = await AppDb.open({ factory, migrations: MIGRATIONS.slice(0, 1) });
    await v1.setSetting('theme', 'dark');
    await v1.putRecent(entry('a', 1));
    v1.close();
    const db = await AppDb.open({ factory, migrations: MIGRATIONS.slice(0, 2) });
    expect(db.db.version).toBe(2);
    expect(await db.getSetting('theme')).toBe('dark');
    expect((await db.listRecent()).map((e) => e.id)).toEqual(['a']);
    expect(await db.getProfile()).toBeUndefined();
    await db.setProfile({ name: 'Ana' });
    expect(await db.getProfile()).toEqual({ name: 'Ana' });
    await db.clearAll();
    expect(await db.getProfile()).toBeUndefined();
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

    const next: Migration = (db, tx) => {
      db.createObjectStore('notes');
      tx.objectStore('recent').createIndex('name', 'name');
    };
    const upgraded = await AppDb.open({ factory, migrations: [...MIGRATIONS, next] });
    expect(upgraded.db.version).toBe(MIGRATIONS.length + 1);
    expect(upgraded.db.objectStoreNames.contains('notes')).toBe(true);
    expect(await upgraded.getSetting('theme')).toBe('light');
    expect((await upgraded.listRecent()).map((e) => e.id)).toEqual(['a']);
    upgraded.close();
  });

  it('closes itself when another tab upgrades the schema', async () => {
    const factory = new IDBFactory();
    const old = await AppDb.open({ factory });
    const next = await AppDb.open({ factory, migrations: [...MIGRATIONS, () => undefined] });
    expect(next.db.version).toBe(MIGRATIONS.length + 1);
    next.close();
    expect(() => old.db.transaction('settings')).toThrow();
  });
});

describe('AppDb v3 (M3-13)', () => {
  it('stores custom status schemes by id, keeping v2 data', async () => {
    const factory = new IDBFactory();
    const v2 = await AppDb.open({ factory, migrations: MIGRATIONS.slice(0, 2) });
    await v2.setProfile({ name: 'Ana' });
    v2.close();
    const db = await AppDb.open({ factory, migrations: MIGRATIONS.slice(0, 3) });
    expect(db.db.version).toBe(3);
    expect(await db.getProfile()).toEqual({ name: 'Ana' });
    const s1 = { id: 's1', name: 'Site' };
    const s2 = { id: 's2', name: 'Shop' };
    await db.putScheme(s1);
    await db.putScheme(s2);
    await db.deleteScheme('s1');
    expect(await db.listSchemes()).toEqual([{ id: 's2', name: 'Shop' }]);
    db.close();
  });
});

describe('AppDb v4 (M4-15)', () => {
  it('stores table templates by id, keeping the profile and schemes of v3', async () => {
    const factory = new IDBFactory();
    const v3 = await AppDb.open({ factory, migrations: MIGRATIONS.slice(0, 3) });
    await v3.setProfile({ name: 'Ana' });
    const scheme = { id: 's1', name: 'Site' };
    await v3.putScheme(scheme);
    v3.close();
    const db = await AppDb.open({ factory, migrations: MIGRATIONS.slice(0, 4) });
    expect(db.db.version).toBe(4);
    expect(await db.getProfile()).toEqual({ name: 'Ana' });
    expect(await db.listSchemes()).toEqual([{ id: 's1', name: 'Site' }]);
    await db.putTableTemplate({ id: 't1' });
    await db.putTableTemplate({ id: 't2' });
    await db.deleteTableTemplate('t1');
    expect(await db.listTableTemplates()).toEqual([{ id: 't2' }]);
    await db.clearAll();
    expect(await db.listTableTemplates()).toEqual([]);
    db.close();
  });
});

describe('AppDb v5 (M6-03)', () => {
  it('stores tool defaults by tool id, keeping the table templates of v4', async () => {
    const factory = new IDBFactory();
    const v4 = await AppDb.open({ factory, migrations: MIGRATIONS.slice(0, 4) });
    await v4.putTableTemplate({ id: 't1' });
    v4.close();
    const db = await AppDb.open({ factory });
    expect(db.db.version).toBe(5);
    expect(await db.listTableTemplates()).toEqual([{ id: 't1' }]);
    expect(await db.listToolDefaults()).toEqual([]);
    await db.putToolDefaults('square', { v: 1, props: { strokeWidth: 2 } });
    await db.putToolDefaults('line', { v: 1, props: { strokeWidth: 3 } });
    await db.deleteToolDefaults('line');
    expect(await db.listToolDefaults()).toEqual([['square', { v: 1, props: { strokeWidth: 2 } }]]);
    await db.clearAll();
    expect(await db.listToolDefaults()).toEqual([]);
    db.close();
  });
});
