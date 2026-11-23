// Pick up where you left off (M11-08·O2, D-53, §10.3): the pure part. The choice of what
// happens at start, and the record of the files that were open (their File System Access
// handles, names, where they came from and which tab was selected), as kept on the device.
// Only documents with a handle to a file on disk can be reopened, so only they are kept:
// a new document that was never saved, a download or a recovered copy is not.
import type { DocumentSource } from '../../app/store/documentStore';
import type { CompareType, SideId } from '../compare/model';
import { normBox, type AreaBox, type AreaPair } from '../../model/compare/area';

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

/** A file on one side of a comparison (M12-08), with its page range as typed. */
export interface SessionSideFile extends SessionEntry {
  range: string;
}

/**
 * An open comparison's inputs (M12-08, D-58): its type and the files of each side, never
 * its result. It reopens on its input window at its old place among the tabs.
 */
export interface SessionComparison {
  type: CompareType;
  /** Its place in the tab strip (0-based, among every tab). */
  index: number;
  a: SessionSideFile[];
  b: SessionSideFile[];
  /** An area comparison's rectangles (O1): it reopens on its result, one page per side. */
  area?: AreaPair;
}

export interface SessionRecord {
  /** In tab order. */
  entries: SessionEntry[];
  /** Index in `entries` of the selected tab; -1 when it was not one of them. */
  active: number;
  /** Open comparisons in tab order (M12-08); absent in records from before. */
  comparisons?: SessionComparison[];
  /** Index in `comparisons` of the selected tab; -1 or absent when it was not one. */
  activeComparison?: number;
  /** Epoch ms. */
  savedAt: number;
}

/** The most comparisons a session keeps. */
export const MAX_SESSION_COMPARISONS = 10;

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

/** What the record needs to know about one open comparison (M12-08). */
export interface OpenComparison {
  type: CompareType;
  index: number;
  a: readonly (OpenDoc & { range: string })[];
  b: readonly (OpenDoc & { range: string })[];
  active: boolean;
  area?: AreaPair;
}

/**
 * The comparisons to keep (M12-08): each with the files of its sides that can be reopened
 * (a handle to a file on disk); a comparison with no such file is not kept.
 */
export function comparisonsOf(open: readonly OpenComparison[]): {
  comparisons: SessionComparison[];
  activeComparison: number;
} {
  const comparisons: SessionComparison[] = [];
  let activeComparison = -1;
  const side = (files: OpenComparison['a']): SessionSideFile[] =>
    files.flatMap((d) =>
      d.handle && d.fp !== undefined
        ? [
            {
              name: d.name,
              handle: d.handle,
              fp: d.fp,
              source: keptSource(d.source),
              range: d.range,
            },
          ]
        : [],
    );
  for (const c of open) {
    const a = side(c.a);
    const b = side(c.b);
    if (a.length + b.length === 0 || comparisons.length >= MAX_SESSION_COMPARISONS) continue;
    // An area comparison (O1) is kept only whole: both its pages can be reopened.
    if (c.area && (a.length !== 1 || b.length !== 1)) continue;
    if (c.active) activeComparison = comparisons.length;
    comparisons.push({ type: c.type, index: c.index, a, b, ...(c.area ? { area: c.area } : {}) });
  }
  return { comparisons, activeComparison };
}

const sameEntry = (e: SessionEntry, o: SessionEntry | undefined): boolean =>
  e.handle === o?.handle && e.name === o.name && e.fp === o.fp && e.source === o.source;

const sameFiles = (a: readonly SessionSideFile[], b: readonly SessionSideFile[]): boolean =>
  a.length === b.length && a.every((f, i) => sameEntry(f, b[i]) && f.range === b[i]?.range);

/** Same files, names, sources, order, comparisons and selected tab (the time is not compared). */
export function sameSession(a: SessionRecord | null, b: SessionRecord | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.active !== b.active || a.entries.length !== b.entries.length) return false;
  const ca = a.comparisons ?? [];
  const cb = b.comparisons ?? [];
  if ((a.activeComparison ?? -1) !== (b.activeComparison ?? -1) || ca.length !== cb.length)
    return false;
  const comparisonsSame = ca.every((c, i) => {
    const o = cb[i];
    return (
      c.type === o?.type &&
      c.index === o.index &&
      sameFiles(c.a, o.a) &&
      sameFiles(c.b, o.b) &&
      JSON.stringify(c.area ?? null) === JSON.stringify(o.area ?? null)
    );
  });
  return comparisonsSame && a.entries.every((e, i) => sameEntry(e, b.entries[i]));
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function parseEntry(e: unknown): SessionEntry | null {
  if (!isObject(e)) return null;
  const { name, handle, fp, source } = e;
  if (typeof name !== 'string' || typeof fp !== 'string') return null;
  if (!isObject(handle) || handle['kind'] !== 'file') return null;
  return {
    name,
    handle: handle as unknown as FileSystemFileHandle,
    fp,
    source: keptSource(source as DocumentSource | undefined),
  };
}

function parseSide(value: unknown): SessionSideFile[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).flatMap((f) => {
    const entry = parseEntry(f);
    if (!entry || !isObject(f)) return [];
    return [{ ...entry, range: typeof f['range'] === 'string' ? f['range'] : '' }];
  });
}

/** An area comparison's rectangles as stored, or null when they are not two rectangles. */
function parseArea(value: unknown): AreaPair | null {
  if (!isObject(value)) return null;
  const box = (v: unknown): AreaBox | null => {
    if (!Array.isArray(v) || v.length !== 4) return null;
    const n = v as unknown[];
    if (!n.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
    const b = normBox(n as number[]);
    return b[2] - b[0] > 0 && b[3] - b[1] > 0 ? b : null;
  };
  const a = box(value['a']);
  const b = box(value['b']);
  return a && b ? { a, b } : null;
}

function parseComparisons(value: unknown): SessionComparison[] {
  if (!Array.isArray(value)) return [];
  const out: SessionComparison[] = [];
  for (const c of value as unknown[]) {
    if (!isObject(c) || (c['type'] !== 'overlay' && c['type'] !== 'text')) continue;
    const index = c['index'];
    const type: CompareType = c['type'];
    const sides: Record<SideId, SessionSideFile[]> = {
      a: parseSide(c['a']),
      b: parseSide(c['b']),
    };
    // A text comparison has one file per side.
    if (type === 'text') for (const s of ['a', 'b'] as const) sides[s] = sides[s].slice(0, 1);
    if (sides.a.length + sides.b.length === 0) continue;
    const area = c['area'] === undefined ? undefined : parseArea(c['area']);
    // An area comparison (O1): an overlay of one page of each side, both rectangles valid.
    if (
      area === null ||
      (area && (type !== 'overlay' || sides.a.length !== 1 || sides.b.length !== 1))
    )
      continue;
    out.push({
      type,
      index: typeof index === 'number' && Number.isInteger(index) && index >= 0 ? index : 0,
      ...sides,
      ...(area ? { area } : {}),
    });
  }
  return out.slice(0, MAX_SESSION_COMPARISONS);
}

/** A stored record, validated; null when there is none or it is not one. */
export function parseSession(value: unknown): SessionRecord | null {
  if (!isObject(value) || !Array.isArray(value['entries'])) return null;
  const entries: SessionEntry[] = [];
  for (const e of value['entries'] as unknown[]) {
    const entry = parseEntry(e);
    if (entry) entries.push(entry);
  }
  const comparisons = parseComparisons(value['comparisons']);
  const rawComparison = value['activeComparison'];
  const activeComparison =
    typeof rawComparison === 'number' &&
    Number.isInteger(rawComparison) &&
    rawComparison < comparisons.length
      ? Math.max(-1, rawComparison)
      : -1;
  const rawActive = value['active'];
  const active =
    typeof rawActive === 'number' && Number.isInteger(rawActive) && rawActive < entries.length
      ? Math.max(-1, rawActive)
      : -1;
  const savedAt = typeof value['savedAt'] === 'number' ? value['savedAt'] : 0;
  return {
    entries: entries.slice(0, MAX_SESSION_FILES),
    active,
    ...(comparisons.length > 0 ? { comparisons, activeComparison } : {}),
    savedAt,
  };
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
  const comparisons = record.comparisons?.map((c) => ({
    ...c,
    a: c.a.filter((f) => !snapshotFps.has(f.fp)),
    b: c.b.filter((f) => !snapshotFps.has(f.fp)),
  }));
  return {
    ...record,
    entries,
    active: activeEntry ? entries.indexOf(activeEntry) : -1,
    ...(comparisons ? { comparisons } : {}),
  };
}

/** Every file of a comparison, A's then B's (M12-08). */
export const comparisonFiles = (c: SessionComparison): SessionSideFile[] => [...c.a, ...c.b];
