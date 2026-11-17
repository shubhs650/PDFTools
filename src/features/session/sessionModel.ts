// Pick up where you left off (M11-08·O2, D-53, §10.3): the pure part. The choice of what
// happens at start, and the record of the files that were open (their File System Access
// handles, names, where they came from and which tab was selected), as kept on the device.
// Only documents with a handle to a file on disk can be reopened, so only they are kept:
// a new document that was never saved, a download or a recovered copy is not.
import type { DocumentSource } from '../../app/store/documentStore';

/** What happens when Triya PDF starts: the start screen, or last session's files. */
export type StartupChoice = 'start' | 'reopen';

export const DEFAULT_STARTUP: StartupChoice = 'start';

export function parseStartup(value: unknown): StartupChoice {
  return value === 'reopen' ? 'reopen' : DEFAULT_STARTUP;
}

export interface SessionEntry {
  /** The tab's name (the file's name) when the record was written. */
  name: string;
  handle: FileSystemFileHandle;
  /**
   * The document's fingerprint as opened: a recovery snapshot of unsaved changes is kept
   * under it (§4.3), and such a file is left to the recovery prompt.
   */
  fp: string;
  /** Where it had come from: the reopened tab's hover card says the same (M11-03). */
  source: DocumentSource;
}

export interface SessionRecord {
  /** In tab order. */
  entries: SessionEntry[];
  /** Index in `entries` of the selected tab; -1 when it was not one of them. */
  active: number;
  /** Epoch ms. */
  savedAt: number;
}

/** The most files a session keeps (the app opens at most MAX_DOCUMENTS anyway). */
export const MAX_SESSION_FILES = 50;

/** The sources a reopened tab keeps; others read "Opened from this device". */
const KEEP: ReadonlySet<DocumentSource> = new Set([
  'picked',
  'dropped',
  'launched',
  'recent',
  'saved',
]);

const keptSource = (source: DocumentSource | undefined): DocumentSource =>
  source && KEEP.has(source) ? source : 'picked';

/** What the record needs to know about one open document. */
export interface OpenDoc {
  id: string;
  name: string;
  source?: DocumentSource;
  handle?: FileSystemFileHandle;
  fp?: string;
}

/**
 * The record for the documents open now, in tab order, followed by `waiting` (files from
 * last time not reopened yet: they stay in the record until reopened or dismissed). When no
 * open file is selected (none is open yet, or the selected tab has no file), `waitingActive`,
 * the waiting file that was selected last time, stays the selected one.
 */
export function sessionOf(
  docs: readonly OpenDoc[],
  activeId: string | null,
  waiting: readonly SessionEntry[],
  now: number,
  waitingActive?: SessionEntry,
): SessionRecord {
  const entries: SessionEntry[] = [];
  let active = -1;
  for (const d of docs) {
    if (!d.handle || d.fp === undefined) continue;
    if (d.id === activeId) active = entries.length;
    entries.push({ name: d.name, handle: d.handle, fp: d.fp, source: keptSource(d.source) });
  }
  for (const w of waiting) {
    if (entries.some((e) => e.handle === w.handle)) continue;
    if (active === -1 && w === waitingActive) active = entries.length;
    entries.push(w);
  }
  return {
    entries: entries.slice(0, MAX_SESSION_FILES),
    active: active < MAX_SESSION_FILES ? active : -1,
    savedAt: now,
  };
}

/** Same files, names, sources, order and selected tab (the time is not compared). */
export function sameSession(a: SessionRecord | null, b: SessionRecord | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.active !== b.active || a.entries.length !== b.entries.length) return false;
  return a.entries.every((e, i) => {
    const o = b.entries[i];
    return e.handle === o?.handle && e.name === o.name && e.fp === o.fp && e.source === o.source;
  });
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** A stored record, validated; null when there is none or it is not one. */
export function parseSession(value: unknown): SessionRecord | null {
  if (!isObject(value) || !Array.isArray(value['entries'])) return null;
  const entries: SessionEntry[] = [];
  for (const e of value['entries'] as unknown[]) {
    if (!isObject(e)) continue;
    const { name, handle, fp, source } = e;
    if (typeof name !== 'string' || typeof fp !== 'string') continue;
    if (!isObject(handle) || handle['kind'] !== 'file') continue;
    entries.push({
      name,
      handle: handle as unknown as FileSystemFileHandle,
      fp,
      source: keptSource(source as DocumentSource | undefined),
    });
  }
  const rawActive = value['active'];
  const active =
    typeof rawActive === 'number' && Number.isInteger(rawActive) && rawActive < entries.length
      ? Math.max(-1, rawActive)
      : -1;
  const savedAt = typeof value['savedAt'] === 'number' ? value['savedAt'] : 0;
  return { entries: entries.slice(0, MAX_SESSION_FILES), active, savedAt };
}

/**
 * At start: which of last session's files to leave out, because a recovery snapshot of
 * unsaved changes exists for them (the recovery prompt offers those, and reopening the
 * file as it is on disk would hide that offer).
 */
export function withoutRecoverable(
  record: SessionRecord,
  snapshotFps: ReadonlySet<string>,
): SessionRecord {
  const activeEntry = record.entries[record.active];
  const entries = record.entries.filter((e) => !snapshotFps.has(e.fp));
  return {
    ...record,
    entries,
    active: activeEntry ? entries.indexOf(activeEntry) : -1,
  };
}
