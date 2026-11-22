// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// M11-08·O2 (D-53): reopening last session's files at start, and keeping the record.
// A Map stands in for IndexedDB (fake handles with methods can't be structured-cloned).

const settings = new Map<string, unknown>();
let stored: unknown;
const db = {
  getSetting: (key: string) => Promise.resolve(settings.get(key)),
  setSetting: (key: string, value: unknown) => {
    settings.set(key, value);
    return Promise.resolve();
  },
  getSession: () => Promise.resolve(stored),
  putSession: (value: unknown) => {
    stored = value;
    return Promise.resolve();
  },
  deleteSession: () => {
    stored = undefined;
    return Promise.resolve();
  },
};
vi.mock('../../src/storage/appDb', () => ({ appDb: () => Promise.resolve(db) }));

let snapshots: { fp: string }[] = [];
vi.mock('../../src/features/recovery/recovery', () => ({
  launchSnapshots: () => Promise.resolve(snapshots),
}));
vi.mock('../../src/features/recent/recent', () => ({ recentSupported: () => true }));

const failures: { name: string; kind: string }[] = [];
vi.mock('../../src/features/open/openStore', () => ({
  reportFailure: (name: string, kind: string) => {
    failures.push({ name, kind });
  },
}));

const { documentStore } = await import('../../src/app/store/documentStore');
const { sources } = await import('../../src/features/open/sources');

const opened: { name: string; source: string }[] = [];
let nextId = 0;
vi.mock('../../src/features/open/openDocument', () => ({
  openFiles: (
    files: { file: File; handle?: FileSystemFileHandle }[],
    source: string,
    options: { tab?: boolean } = {},
  ) => {
    const ids = files.map(({ file, handle }) => {
      const id = `doc-${String(++nextId)}`;
      opened.push({ name: file.name, source });
      sources.set(id, {
        file,
        ...(handle ? { handle } : {}),
        fingerprint: `fp-${file.name}`,
        size: file.size,
      });
      const meta = {
        id,
        name: file.name,
        pageCount: 1,
        permissions: -1,
        signatureCount: 0,
        source: source as 'picked',
      };
      if (options.tab === false) documentStore.getState().openWithoutTab(meta);
      else documentStore.getState().open(meta);
      return id;
    });
    return Promise.resolve(ids);
  },
}));

const session = await import('../../src/features/session/session');

type Perm = 'granted' | 'denied' | 'prompt';

function handle(
  name: string,
  opts: { perm?: Perm; request?: Perm | 'throw'; gone?: boolean } = {},
) {
  return {
    kind: 'file',
    name,
    queryPermission: () => Promise.resolve(opts.perm ?? 'granted'),
    requestPermission: () =>
      opts.request === 'throw'
        ? Promise.reject(new DOMException('no activation', 'SecurityError'))
        : Promise.resolve(opts.request ?? opts.perm ?? 'granted'),
    getFile: () =>
      opts.gone
        ? Promise.reject(new DOMException('gone', 'NotFoundError'))
        : Promise.resolve(new File(['%PDF'], name)),
  } as unknown as FileSystemFileHandle;
}

const entry = (h: FileSystemFileHandle, source = 'picked') => ({
  name: h.name,
  handle: h,
  fp: `fp-${h.name}`,
  source,
});

const tabNames = () => {
  const s = documentStore.getState();
  return s.order.map((id) => s.docs[id]?.meta.name);
};
const activeName = () => {
  const s = documentStore.getState();
  return s.activeId ? s.docs[s.activeId]?.meta.name : null;
};

/** Starts the app's side and waits until it has reopened what it could. */
async function launch(): Promise<() => void> {
  const off = session.installSession();
  await vi.waitFor(async () => {
    await session.sessionWritten();
    expect(session.sessionStore.getState().busy).toBe(false);
  });
  // Let the start finish (it opens one file at a time).
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  return off;
}

beforeEach(() => {
  settings.clear();
  stored = undefined;
  snapshots = [];
  failures.length = 0;
  opened.length = 0;
  documentStore.setState({
    docs: {},
    order: [],
    activeId: null,
    activeTab: null,
    comparisons: {},
  });
  sources.clear();
  session.resetSessionForTests();
});

describe('start-up choice', () => {
  it('shows the start screen by default and keeps nothing', async () => {
    const off = await launch();
    expect(session.sessionStore.getState().choice).toBe('start');
    await (
      await import('../../src/features/open/openDocument')
    ).openFiles([{ file: new File(['%PDF'], 'a.pdf'), handle: handle('a.pdf') }], 'picked');
    await session.sessionWritten();
    expect(stored).toBeUndefined();
    off();
  });

  it('"reopen" keeps the tabs open now, and "start" deletes them', async () => {
    const off = await launch();
    const { openFiles } = await import('../../src/features/open/openDocument');
    const a = handle('a.pdf');
    await openFiles([{ file: new File(['%PDF'], 'a.pdf'), handle: a }], 'dropped');
    await openFiles([{ file: new File(['%PDF'], 'new.pdf') }], 'created'); // no file
    session.setStartupChoice('reopen');
    await session.sessionWritten();
    expect(settings.get(session.STARTUP_KEY)).toBe('reopen');
    expect(stored).toMatchObject({
      entries: [{ name: 'a.pdf', handle: a, fp: 'fp-a.pdf', source: 'dropped' }],
      active: -1,
    });
    // Selecting the tab is part of the record.
    documentStore.getState().activate(documentStore.getState().order[0] ?? '');
    await session.sessionWritten();
    expect(stored).toMatchObject({ active: 0 });

    session.setStartupChoice('start');
    await session.sessionWritten();
    expect(settings.get(session.STARTUP_KEY)).toBe('start');
    expect(stored).toBeUndefined();
    documentStore.getState().activate(documentStore.getState().order[1] ?? '');
    await session.sessionWritten();
    expect(stored).toBeUndefined();
    off();
  });
});

describe('at start, with "reopen"', () => {
  it('reopens the files it may read, in order, and selects the tab selected last time', async () => {
    const a = handle('a.pdf');
    const b = handle('b.pdf');
    const c = handle('c.pdf');
    settings.set(session.STARTUP_KEY, 'reopen');
    stored = { entries: [entry(a), entry(b, 'recent'), entry(c, 'saved')], active: 1, savedAt: 1 };
    const off = await launch();
    expect(tabNames()).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
    expect(opened.map((o) => o.source)).toEqual(['picked', 'recent', 'saved']);
    expect(activeName()).toBe('b.pdf');
    expect(session.sessionStore.getState().waiting).toEqual([]);
    off();
  });

  it('leaves files that need permission waiting for a click, and keeps them in the record', async () => {
    const a = handle('a.pdf');
    const b = handle('b.pdf', { perm: 'prompt', request: 'granted' });
    const c = handle('c.pdf', { perm: 'prompt', request: 'denied' });
    settings.set(session.STARTUP_KEY, 'reopen');
    stored = { entries: [entry(a), entry(b), entry(c)], active: 1, savedAt: 1 };
    const off = await launch();
    expect(tabNames()).toEqual(['a.pdf']);
    expect(session.sessionStore.getState().waiting.map((e) => e.name)).toEqual(['b.pdf', 'c.pdf']);
    await session.sessionWritten();
    expect((stored as { entries: { name: string }[] }).entries.map((e) => e.name)).toEqual([
      'a.pdf',
      'b.pdf',
      'c.pdf',
    ]);

    await session.reopenWaiting();
    expect(tabNames()).toEqual(['a.pdf', 'b.pdf']);
    expect(activeName()).toBe('b.pdf'); // the one selected last time
    expect(failures).toEqual([{ name: 'c.pdf', kind: 'denied' }]);
    expect(session.sessionStore.getState().waiting).toEqual([]);
    await session.sessionWritten();
    expect((stored as { entries: { name: string }[] }).entries.map((e) => e.name)).toEqual([
      'a.pdf',
      'b.pdf',
    ]);
    off();
  });

  it('keeps the selected tab in the record while every file waits', async () => {
    const a = handle('a.pdf', { perm: 'prompt' });
    const b = handle('b.pdf', { perm: 'prompt' });
    settings.set(session.STARTUP_KEY, 'reopen');
    stored = { entries: [entry(a), entry(b)], active: 1, savedAt: 1 };
    const off = await launch();
    expect(tabNames()).toEqual([]);
    await session.sessionWritten();
    expect(stored).toMatchObject({ active: 1 });
    off();
  });

  it('keeps a file waiting when the browser needs a fresh click to ask', async () => {
    const b = handle('b.pdf', { perm: 'prompt', request: 'throw' });
    settings.set(session.STARTUP_KEY, 'reopen');
    stored = { entries: [entry(b)], active: 0, savedAt: 1 };
    const off = await launch();
    await session.reopenWaiting();
    expect(tabNames()).toEqual([]);
    expect(session.sessionStore.getState().waiting.map((e) => e.name)).toEqual(['b.pdf']);
    expect(failures).toEqual([]);
    off();
  });

  it('"Not now" forgets the waiting files', async () => {
    const b = handle('b.pdf', { perm: 'prompt' });
    settings.set(session.STARTUP_KEY, 'reopen');
    stored = { entries: [entry(b)], active: 0, savedAt: 1 };
    const off = await launch();
    session.dismissWaiting();
    await session.sessionWritten();
    expect(stored).toMatchObject({ entries: [], active: -1 });
    off();
  });

  it('says so for a file that is gone and opens the rest', async () => {
    const a = handle('a.pdf', { gone: true });
    const b = handle('b.pdf');
    settings.set(session.STARTUP_KEY, 'reopen');
    stored = { entries: [entry(a), entry(b)], active: 0, savedAt: 1 };
    const off = await launch();
    expect(tabNames()).toEqual(['b.pdf']);
    expect(failures).toEqual([{ name: 'a.pdf', kind: 'unreadable' }]);
    off();
  });

  it('leaves a file with unsaved changes to the recovery prompt', async () => {
    const a = handle('a.pdf');
    const b = handle('b.pdf');
    settings.set(session.STARTUP_KEY, 'reopen');
    stored = { entries: [entry(a), entry(b)], active: 0, savedAt: 1 };
    snapshots = [{ fp: 'fp-a.pdf' }];
    const off = await launch();
    expect(tabNames()).toEqual(['b.pdf']);
    off();
  });

  it('opens nothing when the start screen is chosen, whatever was kept', async () => {
    stored = { entries: [entry(handle('a.pdf'))], active: 0, savedAt: 1 };
    const off = await launch();
    expect(tabNames()).toEqual([]);
    off();
  });

  it('Clear all local data goes back to the start screen', async () => {
    settings.set(session.STARTUP_KEY, 'reopen');
    const off = await launch();
    expect(session.sessionStore.getState().choice).toBe('reopen');
    session.resetSession();
    expect(session.sessionStore.getState().choice).toBe('start');
    off();
  });
});

describe('comparisons (M12-08, D-58)', () => {
  const side = (h: FileSystemFileHandle, range = '') => ({ ...entry(h), range });

  it("keeps an open comparison's inputs: type, files, ranges and its place", async () => {
    const off = await launch();
    session.setStartupChoice('reopen');
    const { openFiles } = await import('../../src/features/open/openDocument');
    const a = handle('a.pdf');
    const old = handle('rev-a.pdf');
    await openFiles([{ file: new File(['%PDF'], 'a.pdf'), handle: a }], 'picked');
    const [oldId] = await openFiles(
      [{ file: new File(['%PDF'], 'rev-a.pdf'), handle: old }],
      'dropped',
      { tab: false },
    );
    const aId = documentStore.getState().order[0] ?? '';
    documentStore.getState().openComparison(
      {
        id: 'cmp-1',
        type: 'overlay',
        stage: 'input',
        a: [{ docId: oldId ?? '', range: '2-3' }],
        b: [{ docId: aId, range: '' }],
      },
      0,
    );
    await session.sessionWritten();
    expect(stored).toMatchObject({
      entries: [{ name: 'a.pdf' }],
      active: -1,
      comparisons: [
        {
          type: 'overlay',
          index: 0,
          a: [{ name: 'rev-a.pdf', handle: old, range: '2-3', source: 'dropped' }],
          b: [{ name: 'a.pdf', handle: a, range: '' }],
        },
      ],
      activeComparison: 0,
    });
    off();
  });

  it('reopens a comparison on its input window, at its place, selected again', async () => {
    const a = handle('a.pdf');
    const ra = handle('rev-a.pdf');
    const rb = handle('rev-b.pdf');
    settings.set(session.STARTUP_KEY, 'reopen');
    stored = {
      entries: [entry(a)],
      active: -1,
      comparisons: [{ type: 'text', index: 0, a: [side(ra, '1-2')], b: [side(rb)] }],
      activeComparison: 0,
      savedAt: 1,
    };
    const off = await launch();
    const s = documentStore.getState();
    expect(s.order).toHaveLength(2);
    const id = s.order[0] ?? '';
    expect(s.activeTab).toBe(id);
    expect(s.activeId).toBeNull();
    const c = s.comparisons[id];
    expect(c).toMatchObject({ type: 'text', stage: 'input' });
    expect(c?.a.map((f) => [s.docs[f.docId]?.meta.name, f.range])).toEqual([['rev-a.pdf', '1-2']]);
    expect(c?.b.map((f) => s.docs[f.docId]?.meta.name)).toEqual(['rev-b.pdf']);
    // The comparison's files have no tabs of their own.
    expect(tabNames()).toEqual([undefined, 'a.pdf']);
    off();
  });

  it('a comparison with a file that needs permission waits, and reopens on the click', async () => {
    const ra = handle('rev-a.pdf');
    const rb = handle('rev-b.pdf', { perm: 'prompt', request: 'granted' });
    settings.set(session.STARTUP_KEY, 'reopen');
    stored = {
      entries: [],
      active: -1,
      comparisons: [{ type: 'overlay', index: 0, a: [side(ra)], b: [side(rb)] }],
      activeComparison: 0,
      savedAt: 1,
    };
    const off = await launch();
    expect(documentStore.getState().order).toEqual([]);
    expect(session.waitingNames(session.sessionStore.getState())).toEqual([
      'rev-a.pdf',
      'rev-b.pdf',
    ]);
    await session.reopenWaiting();
    const s = documentStore.getState();
    const c = s.comparisons[s.order[0] ?? ''];
    expect(c?.a.map((f) => s.docs[f.docId]?.meta.name)).toEqual(['rev-a.pdf']);
    expect(c?.b.map((f) => s.docs[f.docId]?.meta.name)).toEqual(['rev-b.pdf']);
    expect(session.sessionStore.getState().waitingComparisons).toEqual([]);
    off();
  });
});
