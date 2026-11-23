// Pick up where you left off (M11-08·O2, D-53, §10.3). File › Settings › Start-up: "When
// Triya PDF starts", the start screen (the default) or the files open last time.
//
// While "reopen" is chosen, the files open now are kept on this device (IndexedDB
// `session`: their File System Access handles, names, where they came from and the selected
// tab; never their content), rewritten whenever the tabs change. With "start" nothing is
// kept, and choosing it deletes the record.
//
// At start, with "reopen": files the browser still lets us read open at once, in their old
// order, with the selected tab selected again (each at its last view, O3). The browser
// usually asks again after a restart, and asking needs a click, so the others wait on the
// start screen (or a bar over the document) under "Reopen files", which asks for each. Files
// with a recovery snapshot of unsaved changes are left to the recovery prompt. Only Chromium
// keeps file handles: elsewhere there is no choice and nothing is kept (as Recent files).
//
// M12-08 (D-58): an open comparison's inputs are kept too (its type, each side's files and
// page ranges, its place among the tabs) and it reopens on its input window, at once when
// the browser lets us read every one of its files, else with the waiting files.
import { createStore, useStore } from 'zustand';
import { recordError } from '../../app/diagnostics';
import { documentStore } from '../../app/store/documentStore';
import { newComparisonId, type SideFile } from '../compare/model';
import { appDb } from '../../storage/appDb';
import { ensurePermission } from '../../storage/fileAccess';
import { openFiles, releaseDocuments } from '../open/openDocument';
import { reportFailure } from '../open/openStore';
import { sources } from '../open/sources';
import { recentSupported } from '../recent/recent';
import { launchSnapshots } from '../recovery/recovery';
import {
  DEFAULT_STARTUP,
  parseSession,
  parseStartup,
  sameSession,
  comparisonFiles,
  comparisonsOf,
  sessionOf,
  withoutRecoverable,
  type OpenDoc,
  type SessionComparison,
  type SessionEntry,
  type SessionRecord,
  type SessionSideFile,
  type StartupChoice,
} from './sessionModel';

/** IndexedDB `settings` key of the start-up choice. */
export const STARTUP_KEY = 'startup';

interface SessionState {
  choice: StartupChoice;
  /** Last session's files that wait for a click (the browser asks to allow access again). */
  waiting: SessionEntry[];
  /** Last session's comparisons with a file that waits for that click (M12-08). */
  waitingComparisons: SessionComparison[];
  /** True while files are being reopened from the waiting list. */
  busy: boolean;
}

export const sessionStore = createStore<SessionState>()(() => ({
  choice: DEFAULT_STARTUP,
  waiting: [],
  waitingComparisons: [],
  busy: false,
}));

/** The names of every file waiting to be reopened, comparisons' files included (M12-08). */
export const waitingNames = (s: SessionState): string[] => [
  ...s.waiting.map((e) => e.name),
  ...s.waitingComparisons.flatMap((c) => comparisonFiles(c).map((f) => f.name)),
];

export function useSession<T>(selector: (s: SessionState) => T): T {
  return useStore(sessionStore, selector);
}

/** The tab that was selected last time, selected again once it is open. */
let activeEntry: SessionEntry | undefined;
/** Or the comparison that was selected last time (M12-08). */
let activeComparison: SessionComparison | undefined;
/** The record last written (or deleted: null), so an unchanged session is not written. */
let written: SessionRecord | null = null;
/** Writes and deletes, one after another. */
let queue: Promise<void> = Promise.resolve();
let tracking = false;
let started: Promise<void> | null = null;

const persist = (job: () => Promise<void>): void => {
  queue = queue.then(job).catch((err: unknown) => {
    recordError('session', err);
  });
};

/** The record for the tabs open now and the files still waiting. */
function currentRecord(): SessionRecord {
  const { order, docs, activeTab, comparisons } = documentStore.getState();
  const openDoc = (id: string): OpenDoc => {
    const src = sources.get(id);
    const meta = docs[id]?.meta;
    return {
      id,
      name: meta?.name ?? '',
      ...(meta?.source ? { source: meta.source } : {}),
      ...(src?.handle ? { handle: src.handle } : {}),
      ...(src ? { fp: src.fingerprint } : {}),
    };
  };
  const record = sessionOf(
    order.filter((id) => docs[id]).map(openDoc),
    activeTab,
    sessionStore.getState().waiting,
    Date.now(),
    activeEntry,
  );
  const side = (files: readonly SideFile[]) =>
    files.map((f) => ({ ...openDoc(f.docId), range: f.range }));
  const open = order.flatMap((id, index) => {
    const c = comparisons[id];
    return c
      ? [
          {
            type: c.type,
            index,
            a: side(c.a),
            b: side(c.b),
            active: id === activeTab,
            ...(c.area ? { area: c.area } : {}),
          },
        ]
      : [];
  });
  const kept = comparisonsOf(open);
  // Comparisons still waiting for a click stay in the record, as waiting files do.
  const all = [...kept.comparisons, ...sessionStore.getState().waitingComparisons];
  const activeIndex =
    kept.activeComparison >= 0
      ? kept.activeComparison
      : activeComparison && record.active === -1
        ? all.indexOf(activeComparison)
        : -1;
  return all.length > 0 ? { ...record, comparisons: all, activeComparison: activeIndex } : record;
}

/** Keeps the record in step with the tabs (only while "reopen" is chosen). */
function update(): void {
  if (!tracking || sessionStore.getState().choice !== 'reopen') return;
  const record = currentRecord();
  if (sameSession(written, record)) return;
  written = record;
  persist(async () => {
    await (await appDb()).putSession(record);
  });
}

/** Opens one file from last session, with or without its own tab; undefined if it failed. */
async function openEntry(entry: SessionEntry, tab: boolean): Promise<string | undefined> {
  let file: File;
  try {
    file = await entry.handle.getFile();
  } catch {
    reportFailure(entry.name, 'unreadable'); // moved, renamed or deleted since
    return undefined;
  }
  const [id] = await openFiles([{ file, handle: entry.handle }], entry.source, { tab });
  return id;
}

/** A comparison from last session on its input window, at its old place (M12-08). */
async function openComparison(c: SessionComparison): Promise<string | undefined> {
  const side = async (files: readonly SessionSideFile[]): Promise<SideFile[]> => {
    const out: SideFile[] = [];
    for (const f of files) {
      const docId = await openEntry(f, false);
      if (docId) out.push({ docId, range: f.range });
    }
    return out;
  };
  const a = await side(c.a);
  const b = (await side(c.b)).filter((f) => !a.some((x) => x.docId === f.docId));
  if (a.length + b.length === 0) return undefined;
  const id = newComparisonId();
  if (c.area) {
    // An area comparison (O1) reopens on its result, or not at all without both pages.
    if (a.length !== 1 || b.length !== 1) {
      releaseDocuments([...a, ...b].map((f) => f.docId));
      return undefined;
    }
    documentStore
      .getState()
      .openComparison({ id, type: 'overlay', stage: 'result', a, b, area: c.area }, c.index);
    return id;
  }
  documentStore.getState().openComparison({ id, type: c.type, stage: 'input', a, b }, c.index);
  return id;
}

/**
 * Opens `entries` one by one, in order, then `comparisons` at their places, then selects
 * the tab that was selected last time.
 */
async function openEntries(
  entries: readonly SessionEntry[],
  comparisons: readonly SessionComparison[] = [],
): Promise<void> {
  let select: string | undefined;
  for (const entry of entries) {
    const id = await openEntry(entry, true);
    if (id && entry === activeEntry) select = id;
  }
  for (const c of [...comparisons].sort((x, y) => x.index - y.index)) {
    const id = await openComparison(c);
    if (id && c === activeComparison) select = id;
  }
  const s = documentStore.getState();
  if (select && (s.docs[select] || s.comparisons[select])) s.activate(select);
}

const canRead = async (handle: FileSystemFileHandle): Promise<boolean> => {
  const h = handle as FileSystemFileHandle & {
    queryPermission?: (d: { mode: 'read' }) => Promise<PermissionState>;
  };
  try {
    return (await h.queryPermission?.({ mode: 'read' })) === 'granted';
  } catch {
    return false;
  }
};

async function start(): Promise<void> {
  let record: SessionRecord | null = null;
  try {
    const db = await appDb();
    const choice = parseStartup(await db.getSetting(STARTUP_KEY));
    sessionStore.setState({ choice });
    if (choice === 'reopen') record = parseSession(await db.getSession());
  } catch (err) {
    recordError('session', err);
  }
  written = record;
  if (!record || record.entries.length + (record.comparisons?.length ?? 0) === 0) return;
  // Wait for the recovery scan, so the files opened here don't hide their snapshots.
  const snapshots = await launchSnapshots();
  const rest = withoutRecoverable(record, new Set(snapshots.map((s) => s.fp)));
  activeEntry = rest.entries[rest.active];
  activeComparison = rest.comparisons?.[rest.activeComparison ?? -1];
  const ready: SessionEntry[] = [];
  const waiting: SessionEntry[] = [];
  for (const entry of rest.entries) ((await canRead(entry.handle)) ? ready : waiting).push(entry);
  const readyComparisons: SessionComparison[] = [];
  const waitingComparisons: SessionComparison[] = [];
  for (const c of rest.comparisons ?? []) {
    let all = true;
    for (const f of comparisonFiles(c)) all &&= await canRead(f.handle);
    (all ? readyComparisons : waitingComparisons).push(c);
  }
  sessionStore.setState({ waiting, waitingComparisons });
  await openEntries(ready, readyComparisons);
}

/**
 * At launch (App): reopens last session's files if that is the choice, then keeps the
 * record in step with the tabs. Does nothing where files have no handles.
 */
export function installSession(): () => void {
  if (!recentSupported()) return () => undefined;
  started ??= start();
  let offDocs: (() => void) | undefined;
  let offSession: (() => void) | undefined;
  let stopped = false;
  void started.then(() => {
    if (stopped) return;
    tracking = true;
    offDocs = documentStore.subscribe(update);
    offSession = sessionStore.subscribe(update);
    update();
  });
  return () => {
    stopped = true;
    tracking = false;
    offDocs?.();
    offSession?.();
  };
}

/**
 * "Reopen files": asks for each waiting file (this must run from the click) and opens the
 * ones allowed. A file the browser would not ask about without a click stays waiting.
 */
export async function reopenWaiting(): Promise<void> {
  const { waiting, waitingComparisons, busy } = sessionStore.getState();
  if (busy || waiting.length + waitingComparisons.length === 0) return;
  sessionStore.setState({ busy: true });
  /** 'yes', 'no' (said, or unreadable), or 'later' (no click to ask from any more). */
  const ask = async (entry: SessionEntry): Promise<'yes' | 'no' | 'later'> => {
    try {
      if (await ensurePermission(entry.handle, 'read')) return 'yes';
      reportFailure(entry.name, 'denied');
      return 'no';
    } catch (err) {
      // No click to ask from (it expired): ask again on the next click.
      if ((err as DOMException | undefined)?.name === 'SecurityError') return 'later';
      reportFailure(entry.name, 'unreadable');
      return 'no';
    }
  };
  const allowed: SessionEntry[] = [];
  const still: SessionEntry[] = [];
  for (const entry of waiting) {
    const answer = await ask(entry);
    if (answer === 'yes') allowed.push(entry);
    else if (answer === 'later') still.push(entry);
  }
  // A comparison opens with the files allowed; one left with a file to ask about waits.
  const comparisons: SessionComparison[] = [];
  const stillComparisons: SessionComparison[] = [];
  for (const c of waitingComparisons) {
    const keep = async (files: readonly SessionSideFile[]): Promise<SessionSideFile[] | null> => {
      const out: SessionSideFile[] = [];
      for (const f of files) {
        const answer = await ask(f);
        if (answer === 'later') return null;
        if (answer === 'yes') out.push(f);
      }
      return out;
    };
    const a = await keep(c.a);
    const b = a === null ? null : await keep(c.b);
    if (a === null || b === null) stillComparisons.push(c);
    else comparisons.push({ ...c, a, b });
  }
  try {
    await openEntries(allowed, comparisons);
  } finally {
    sessionStore.setState({ waiting: still, waitingComparisons: stillComparisons, busy: false });
  }
}

/** "Not now": the waiting files are not reopened (and leave the record). */
export function dismissWaiting(): void {
  sessionStore.setState({ waiting: [], waitingComparisons: [] });
}

/** Settings › Start-up. "start" deletes the record; "reopen" keeps the tabs open now. */
export function setStartupChoice(choice: StartupChoice): void {
  if (sessionStore.getState().choice === choice) return;
  sessionStore.setState({
    choice,
    ...(choice === 'start' ? { waiting: [], waitingComparisons: [] } : {}),
  });
  persist(async () => {
    const db = await appDb();
    await db.setSetting(STARTUP_KEY, choice);
    if (choice === 'start') await db.deleteSession();
  });
  if (choice === 'start') written = null;
  else update();
}

/** Clear all local data: the database is gone; back to the start screen, nothing kept. */
export function resetSession(): void {
  written = null;
  activeEntry = undefined;
  activeComparison = undefined;
  sessionStore.setState({
    choice: DEFAULT_STARTUP,
    waiting: [],
    waitingComparisons: [],
    busy: false,
  });
}

/** For tests: forget what this module did, as after a reload. */
export function resetSessionForTests(): void {
  resetSession();
  tracking = false;
  started = null;
  queue = Promise.resolve();
}

/** For tests: resolves when the writes queued so far are done. */
export const sessionWritten = (): Promise<void> => queue;
