import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  AppDb,
  MAX_LAST_VIEWS,
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
      'commentStyles',
      'ignoreZoneSets',
      'lastViews',
      'profile',
      'recent',
      'schemes',
      'session',
      'settings',
      'tableTemplates',
      'toolDefaults',
      'visualSignatures',
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
    const db = await AppDb.open({ factory, migrations: MIGRATIONS.slice(0, 5) });
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

describe('AppDb v6 (M6-07)', () => {
  it('stores the user’s comment styles by tool id, keeping the tool defaults of v5', async () => {
    const factory = new IDBFactory();
    const v5 = await AppDb.open({ factory, migrations: MIGRATIONS.slice(0, 5) });
    await v5.putToolDefaults('square', { v: 1, props: { strokeWidth: 2 } });
    v5.close();
    const db = await AppDb.open({ factory, migrations: MIGRATIONS.slice(0, 6) });
    expect(db.db.version).toBe(6);
    expect(await db.listToolDefaults()).toEqual([['square', { v: 1, props: { strokeWidth: 2 } }]]);
    expect(await db.listCommentStyles()).toEqual([]);
    const rec = { v: 1, styles: [{ id: 'a', name: 'Blue 2 pt', props: { strokeWidth: 2 } }] };
    await db.putCommentStyles('square', rec);
    await db.putCommentStyles('line', rec);
    await db.deleteCommentStyles('line');
    expect(await db.listCommentStyles()).toEqual([['square', rec]]);
    await db.clearAll();
    expect(await db.listCommentStyles()).toEqual([]);
    db.close();
  });
});

describe('AppDb v7 (M6-13)', () => {
  it('stores saved visual signatures by entry id, keeping the comment styles of v6', async () => {
    const factory = new IDBFactory();
    const v6 = await AppDb.open({ factory, migrations: MIGRATIONS.slice(0, 6) });
    const styles = { v: 1, styles: [] };
    await v6.putCommentStyles('square', styles);
    v6.close();
    const db = await AppDb.open({ factory, migrations: MIGRATIONS.slice(0, 7) });
    expect(db.db.version).toBe(7);
    expect(await db.listCommentStyles()).toEqual([['square', styles]]);
    expect(await db.listSignatures()).toEqual([]);
    const rec = (id: string) => ({ v: 1, entry: { id, createdAt: 1 } });
    await db.putSignature('a', rec('a'));
    await db.putSignature('b', rec('b'));
    await db.deleteSignature('a');
    expect(await db.listSignatures()).toEqual([rec('b')]);
    await db.clearAll();
    expect(await db.listSignatures()).toEqual([]);
    db.close();
  });
});

describe('AppDb v8 (M11-08·O3)', () => {
  const view = (savedAt: number) => ({
    v: 1,
    page: 3,
    zoom: 1.5,
    mode: 'single',
    rotation: 90,
    savedAt,
  });

  it("stores each file's last view by fingerprint, keeping the signatures of v7", async () => {
    const factory = new IDBFactory();
    const v7 = await AppDb.open({ factory, migrations: MIGRATIONS.slice(0, 7) });
    await v7.putSignature('a', { v: 1 });
    v7.close();
    const db = await AppDb.open({ factory });
    expect(db.db.version).toBe(MIGRATIONS.length);
    expect(await db.listSignatures()).toEqual([{ v: 1 }]);
    expect(await db.getLastView('fp-a')).toBeUndefined();
    await db.putLastView('fp-a', view(1));
    await db.putLastView('fp-a', view(2));
    expect(await db.getLastView('fp-a')).toEqual(view(2));
    await db.clearAll();
    expect(await db.getLastView('fp-a')).toBeUndefined();
    db.close();
  });

  it('keeps the most recently viewed files only, dropping the oldest', async () => {
    const db = await AppDb.open({ factory: new IDBFactory() });
    expect(MAX_LAST_VIEWS).toBe(500);
    for (const [fp, at] of [
      ['b', 20],
      ['a', 10],
      ['c', 30],
    ] as const)
      await db.putLastView(fp, view(at), 2);
    expect(await db.getLastView('a')).toBeUndefined();
    expect(await db.getLastView('b')).toEqual(view(20));
    expect(await db.getLastView('c')).toEqual(view(30));
    db.close();
  });
});

describe('AppDb v9 (M11-08·O2)', () => {
  const record = (savedAt: number) => ({ entries: [], active: -1, savedAt });

  it('keeps one record of the files open last time, keeping the last views of v8', async () => {
    const factory = new IDBFactory();
    const v8 = await AppDb.open({ factory, migrations: MIGRATIONS.slice(0, 8) });
    await v8.putLastView('fp-a', { savedAt: 1 });
    v8.close();
    const db = await AppDb.open({ factory, migrations: MIGRATIONS.slice(0, 9) });
    expect(db.db.version).toBe(9);
    expect(await db.getLastView('fp-a')).toEqual({ savedAt: 1 });
    expect(await db.getSession()).toBeUndefined();
    await db.putSession(record(1));
    await db.putSession(record(2));
    expect(await db.getSession()).toEqual(record(2));
    await db.deleteSession();
    expect(await db.getSession()).toBeUndefined();
    await db.putSession(record(3));
    await db.clearAll();
    expect(await db.getSession()).toBeUndefined();
    db.close();
  });
});

describe('AppDb v10 (M12-14)', () => {
  it('keeps named sets of ignore zones by id, and clears them with the rest', async () => {
    const factory = new IDBFactory();
    const v9 = await AppDb.open({ factory, migrations: MIGRATIONS.slice(0, 9) });
    await v9.putSession({ entries: [], active: -1, savedAt: 1 });
    v9.close();
    const db = await AppDb.open({ factory });
    expect(db.db.version).toBe(10);
    expect(await db.getSession()).toEqual({ entries: [], active: -1, savedAt: 1 });
    const set = { id: 's1', name: 'Title block', zones: [{ box: [0, 0, 10, 10], all: true }] };
    await db.putZoneSet(set);
    expect(await db.listZoneSets()).toEqual([set]);
    await db.deleteZoneSet('s1');
    expect(await db.listZoneSets()).toEqual([]);
    await db.putZoneSet(set);
    await db.clearAll();
    expect(await db.listZoneSets()).toEqual([]);
    db.close();
  });
});
