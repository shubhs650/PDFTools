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
import { createStore, useStore } from 'zustand';
import { recordError } from '../../app/diagnostics';
import { documentStore } from '../../app/store/documentStore';
import { appDb } from '../../storage/appDb';
import { ensurePermission } from '../../storage/fileAccess';
import { openFiles } from '../open/openDocument';
import { reportFailure } from '../open/openStore';
import { sources } from '../open/sources';
import { recentSupported } from '../recent/recent';
import { launchSnapshots } from '../recovery/recovery';
import {
  DEFAULT_STARTUP,
  parseSession,
  parseStartup,
  sameSession,
  sessionOf,
  withoutRecoverable,
  type SessionEntry,
  type SessionRecord,
  type StartupChoice,
} from './sessionModel';

/** IndexedDB `settings` key of the start-up choice. */
export const STARTUP_KEY = 'startup';

interface SessionState {
  choice: StartupChoice;
  /** Last session's files that wait for a click (the browser asks to allow access again). */
  waiting: SessionEntry[];
  /** True while files are being reopened from the waiting list. */
  busy: boolean;
}

export const sessionStore = createStore<SessionState>()(() => ({
  choice: DEFAULT_STARTUP,
  waiting: [],
  busy: false,
}));

export function useSession<T>(selector: (s: SessionState) => T): T {
  return useStore(sessionStore, selector);
}

/** The tab that was selected last time, selected again once it is open. */
let activeEntry: SessionEntry | undefined;
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
  const { order, docs, activeId } = documentStore.getState();
  const open = order.map((id) => {
    const src = sources.get(id);
    const meta = docs[id]?.meta;
    return {
      id,
      name: meta?.name ?? '',
      ...(meta?.source ? { source: meta.source } : {}),
      ...(src?.handle ? { handle: src.handle } : {}),
      ...(src ? { fp: src.fingerprint } : {}),
    };
  });
  return sessionOf(open, activeId, sessionStore.getState().waiting, Date.now());
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

/** Opens `entries` one by one, in order, then selects the tab that was selected last time. */
async function openEntries(entries: readonly SessionEntry[]): Promise<void> {
  let select: string | undefined;
  for (const entry of entries) {
    let file: File;
    try {
      file = await entry.handle.getFile();
    } catch {
      reportFailure(entry.name, 'unreadable'); // moved, renamed or deleted since
      continue;
    }
    const [id] = await openFiles([{ file, handle: entry.handle }], entry.source);
    if (id && entry === activeEntry) select = id;
  }
  if (select && documentStore.getState().docs[select]) documentStore.getState().activate(select);
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
  if (!record || record.entries.length === 0) return;
  // Wait for the recovery scan, so the files opened here don't hide their snapshots.
  const snapshots = await launchSnapshots();
  const rest = withoutRecoverable(record, new Set(snapshots.map((s) => s.fp)));
  activeEntry = rest.entries[rest.active];
  const ready: SessionEntry[] = [];
  const waiting: SessionEntry[] = [];
  for (const entry of rest.entries) ((await canRead(entry.handle)) ? ready : waiting).push(entry);
  sessionStore.setState({ waiting });
  await openEntries(ready);
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
  const { waiting, busy } = sessionStore.getState();
  if (busy || waiting.length === 0) return;
  sessionStore.setState({ busy: true });
  const allowed: SessionEntry[] = [];
  const still: SessionEntry[] = [];
  for (const entry of waiting) {
    try {
      if (await ensurePermission(entry.handle, 'read')) allowed.push(entry);
      else reportFailure(entry.name, 'denied');
    } catch (err) {
      // No click to ask from (it expired): ask again on the next click.
      if ((err as DOMException | undefined)?.name === 'SecurityError') still.push(entry);
      else reportFailure(entry.name, 'unreadable');
    }
  }
  try {
    await openEntries(allowed);
  } finally {
    sessionStore.setState({ waiting: still, busy: false });
  }
}

/** "Not now": the waiting files are not reopened (and leave the record). */
export function dismissWaiting(): void {
  sessionStore.setState({ waiting: [] });
}

/** Settings › Start-up. "start" deletes the record; "reopen" keeps the tabs open now. */
export function setStartupChoice(choice: StartupChoice): void {
  if (sessionStore.getState().choice === choice) return;
  sessionStore.setState({ choice, ...(choice === 'start' ? { waiting: [] } : {}) });
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
  sessionStore.setState({ choice: DEFAULT_STARTUP, waiting: [], busy: false });
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
