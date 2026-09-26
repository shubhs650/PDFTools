// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecentEntry } from '../../src/storage/idb';

// The IndexedDB layer has its own tests (tests/storage/idb.test.ts). Here a
// Map stands in, because fake handles (with methods) can't be structured-cloned
// the way real FileSystemFileHandles are.
const store = new Map<string, RecentEntry>();
const MAX = 20;
vi.mock('../../src/storage/appDb', () => ({
  appDb: () =>
    Promise.resolve({
      listRecent: (limit = MAX) =>
        Promise.resolve(
          [...store.values()].sort((a, b) => b.lastOpened - a.lastOpened).slice(0, limit),
        ),
      putRecent: (e: RecentEntry) => {
        store.set(e.id, e);
        const sorted = [...store.values()].sort((a, b) => b.lastOpened - a.lastOpened);
        for (const old of sorted.slice(MAX)) store.delete(old.id);
        return Promise.resolve();
      },
      removeRecent: (id: string) => {
        store.delete(id);
        return Promise.resolve();
      },
    }),
}));

const opened: { file: File; handle?: FileSystemFileHandle }[][] = [];
vi.mock('../../src/features/open/openDocument', () => ({
  openFiles: (files: { file: File; handle?: FileSystemFileHandle }[]) => {
    opened.push(files);
    return Promise.resolve(files.map(() => 'doc-1'));
  },
}));

const recent = await import('../../src/features/recent/recent');
const { MAX_RECENT } = await import('../../src/storage/idb');

type Perm = 'granted' | 'denied' | 'prompt';

function handle(path: string, opts: { perm?: Perm; request?: Perm; missing?: boolean } = {}) {
  return {
    kind: 'file',
    name: path.split('/').at(-1),
    path,
    isSameEntry: (other: { path?: string }) => Promise.resolve(other.path === path),
    queryPermission: () => Promise.resolve(opts.perm ?? 'granted'),
    requestPermission: () => Promise.resolve(opts.request ?? opts.perm ?? 'granted'),
    getFile: () =>
      opts.missing
        ? Promise.reject(new DOMException('gone', 'NotFoundError'))
        : Promise.resolve(new File(['%PDF'], path.split('/').at(-1) ?? 'x.pdf')),
  } as unknown as FileSystemFileHandle;
}

const file = (name: string) => new File(['%PDF-1.7'], name);

beforeEach(() => {
  // FSA available (Chromium path), clean database and store.
  Object.assign(window, {
    showOpenFilePicker: () => undefined,
    showSaveFilePicker: () => undefined,
  });
  store.clear();
  recent.recentStore.setState({ entries: [], problem: null });
  opened.length = 0;
});

const ids = () => recent.recentStore.getState().entries.map((e) => e.id);

describe('recent files (M1-18)', () => {
  it('lists newest first and caps the list', async () => {
    for (let i = 0; i < MAX_RECENT + 3; i++) {
      await recent.recordOpened({
        file: file(`f${String(i)}.pdf`),
        handle: handle(`/d/f${String(i)}.pdf`),
        fingerprint: `fp${String(i)}`,
        now: 1000 + i,
      });
    }
    expect(ids()).toHaveLength(MAX_RECENT);
    expect(ids()[0]).toBe(`fp${String(MAX_RECENT + 2)}`);
    expect(ids()).not.toContain('fp0');
  });

  it('dedupes: the same fingerprint moves to the top; a changed file replaces its old entry', async () => {
    const a = handle('/d/a.pdf');
    await recent.recordOpened({ file: file('a.pdf'), handle: a, fingerprint: 'A1', now: 1 });
    await recent.recordOpened({
      file: file('b.pdf'),
      handle: handle('/d/b.pdf'),
      fingerprint: 'B',
      now: 2,
    });
    await recent.recordOpened({ file: file('a.pdf'), handle: a, fingerprint: 'A1', now: 3 });
    expect(ids()).toEqual(['A1', 'B']);
    // Saved since: same file on disk, new fingerprint.
    await recent.recordOpened({
      file: file('a.pdf'),
      handle: handle('/d/a.pdf'),
      fingerprint: 'A2',
      now: 4,
    });
    expect(ids()).toEqual(['A2', 'B']);
  });

  it('keeps nothing without a handle (fallback path)', async () => {
    await recent.recordOpened({ file: file('x.pdf'), fingerprint: 'X' });
    expect(ids()).toEqual([]);
  });

  it('is off where the File System Access API is missing', async () => {
    Object.assign(window, { showOpenFilePicker: undefined, showSaveFilePicker: undefined });
    expect(recent.recentSupported()).toBe(false);
    await recent.recordOpened({
      file: file('a.pdf'),
      handle: handle('/d/a.pdf'),
      fingerprint: 'A',
    });
    await recent.loadRecent();
    expect(ids()).toEqual([]);
  });

  it('removes one entry and clears all', async () => {
    await recent.recordOpened({
      file: file('a.pdf'),
      handle: handle('/a'),
      fingerprint: 'A',
      now: 1,
    });
    await recent.recordOpened({
      file: file('b.pdf'),
      handle: handle('/b'),
      fingerprint: 'B',
      now: 2,
    });
    await recent.removeRecent('A');
    expect(ids()).toEqual(['B']);
    await recent.clearRecent();
    expect(ids()).toEqual([]);
  });

  it('reopens with permission; denied or missing files report a problem', async () => {
    const ok = handle('/d/ok.pdf', { perm: 'prompt', request: 'granted' });
    await recent.recordOpened({ file: file('ok.pdf'), handle: ok, fingerprint: 'OK' });
    const [entry] = recent.recentStore.getState().entries;
    if (!entry) throw new Error('no entry');
    expect(await recent.openRecent(entry)).toBe(true);
    expect(opened).toHaveLength(1);
    expect(opened[0]?.[0]?.handle).toBe(entry.handle);

    const denied = { ...entry, handle: handle('/d/no.pdf', { perm: 'prompt', request: 'denied' }) };
    expect(await recent.openRecent(denied)).toBe(false);
    expect(recent.recentStore.getState().problem).toEqual({
      id: 'OK',
      name: 'ok.pdf',
      kind: 'denied',
    });

    const gone = { ...entry, handle: handle('/d/gone.pdf', { missing: true }) };
    expect(await recent.openRecent(gone)).toBe(false);
    expect(recent.recentStore.getState().problem?.kind).toBe('missing');
    recent.dismissProblem();
    expect(recent.recentStore.getState().problem).toBeNull();
    expect(opened).toHaveLength(1);
  });
});
