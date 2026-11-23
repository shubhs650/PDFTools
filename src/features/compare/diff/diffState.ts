// The differences of an overlay comparison (M12-14, D-61, ARCHITECTURE
// §7.16): the settings (sensitivity, minimum size, ignore zones), the list's
// filters, the checked ticks and the entry in use, and each sheet's
// differences as the Compare worker gives them at those settings. Pure
// transitions plus one small store per comparison, apart from the overlay
// view's: a new result re-renders the list and the outlines, not the windows.
import { createStore, useStore } from 'zustand';
import {
  DIFF_KINDS,
  DIFF_TYPES,
  type DiffEntry,
  type DiffKind,
  type DiffType,
  type Sensitivity,
  type SheetDiff,
} from '../../../model/compare/detect/entries';
import type { Box } from '../../../model/compare/detect/textDiff';
import type { PlacedZone } from '../../../model/compare/detect/zoneSets';
import type { Sheet } from '../overlay/overlayState';

/** An ignore zone (Q22): a rectangle of one sheet, or of every sheet (`pair` null). */
export interface IgnoreZone {
  id: string;
  /** The compared sheet it belongs to, or null for all sheets. */
  pair: number | null;
  /** In the sheet's frame (Document B's displayed page), pt. */
  box: Box;
}

export interface DiffFilter {
  kinds: Record<DiffKind, boolean>;
  types: Record<DiffType, boolean>;
  /** The sheet shown, or every sheet. */
  scope: 'sheet' | 'all';
  /** Applied on Enter (rule 3). */
  query: string;
  hideChecked: boolean;
}

export interface DiffView {
  /** The differences pane shown on the right (switched in the result's head). */
  pane: boolean;
  sensitivity: Sensitivity;
  /** Smallest difference shown: its larger side in mm (0: all). */
  minSize: number;
  /** Thin outlines of the differences on the overlay (view only). */
  outlines: boolean;
  zones: IgnoreZone[];
  /** Drawing an ignore zone on the overlay window; the scope of the next one. */
  drawing: boolean;
  zoneScope: 'sheet' | 'all';
  filter: DiffFilter;
  /** Entry ids (`pair|key`) ticked as checked. */
  checked: string[];
  /** The entry in use. */
  selected: string | null;
  /** The sheet list in order of percent changed. */
  sortByChange: boolean;
  /** Each detected sheet's differences at the settings in use, by compared pair. */
  results: Record<number, SheetDiff>;
}

const all = <K extends string>(keys: readonly K[]): Record<K, boolean> =>
  Object.fromEntries(keys.map((k) => [k, true])) as Record<K, boolean>;

export const DEFAULT_DIFF: DiffView = {
  pane: true,
  sensitivity: 'normal',
  minSize: 0,
  outlines: true,
  zones: [],
  drawing: false,
  zoneScope: 'sheet',
  filter: {
    kinds: all(DIFF_KINDS),
    types: all(DIFF_TYPES),
    scope: 'all',
    query: '',
    hideChecked: false,
  },
  checked: [],
  selected: null,
  sortByChange: false,
  results: {},
};

/** Millimetres → points. */
export const mmToPt = (mm: number): number => (mm * 72) / 25.4;
export const ptToMm = (pt: number): number => (pt * 25.4) / 72;

/** An entry's id: its sheet and its key. */
export const entryId = (pair: number, key: string): string => `${String(pair)}|${key}`;

/** The zones that apply to a compared sheet. */
export const zonesOf = (v: DiffView, pair: number): Box[] =>
  v.zones.filter((z) => z.pair === null || z.pair === pair).map((z) => z.box);

/** What the worker's result depends on: a change here asks for the differences again. */
export const settingsKey = (v: DiffView): string =>
  JSON.stringify([v.sensitivity, v.minSize, v.zones]);

/** An entry as the list shows it: its sheet (index in the result) and compared pair. */
export interface ShownEntry {
  id: string;
  sheet: number;
  pair: number;
  entry: DiffEntry;
}

/** Every entry of the sheets in scope, sheet by sheet, before the kind, type, search and checked filters. */
export function scopedEntries(
  v: DiffView,
  sheets: readonly Sheet[],
  current: number,
): ShownEntry[] {
  const out: ShownEntry[] = [];
  sheets.forEach((s, sheet) => {
    if (s.pair === null || (v.filter.scope === 'sheet' && sheet !== current)) return;
    const r = v.results[s.pair];
    if (!r) return;
    for (const entry of r.entries)
      out.push({ id: entryId(s.pair, entry.key), sheet, pair: s.pair, entry });
  });
  return out;
}

/** The entries the list shows: in scope, of the kinds and types switched on, matching the search. */
export function shownEntries(v: DiffView, sheets: readonly Sheet[], current: number): ShownEntry[] {
  const q = v.filter.query.trim().toLocaleLowerCase();
  const checked = new Set(v.checked);
  return scopedEntries(v, sheets, current).filter(
    ({ id, entry: e }) =>
      v.filter.kinds[e.kind] &&
      v.filter.types[e.type] &&
      (!v.filter.hideChecked || !checked.has(id)) &&
      (!q || e.old.toLocaleLowerCase().includes(q) || e.new.toLocaleLowerCase().includes(q)),
  );
}

/** Counts of each kind and type among `entries`. */
export function countEntries(entries: readonly ShownEntry[]): {
  kinds: Record<DiffKind, number>;
  types: Record<DiffType, number>;
} {
  const kinds = { added: 0, removed: 0, changed: 0 };
  const types = { text: 0, geometry: 0, both: 0 };
  for (const { entry } of entries) {
    kinds[entry.kind]++;
    types[entry.type]++;
  }
  return { kinds, types };
}

/** The entry `dir` steps from the one in use (wrapping); the first or last without one. */
export function stepFrom(
  shown: readonly ShownEntry[],
  selected: string | null,
  dir: 1 | -1,
): ShownEntry | null {
  if (shown.length === 0) return null;
  const at = selected === null ? -1 : shown.findIndex((e) => e.id === selected);
  if (at < 0) return (dir > 0 ? shown[0] : shown[shown.length - 1]) ?? null;
  return shown[(at + dir + shown.length) % shown.length] ?? null;
}

/** A sheet's state in the sheet list (D-61): not detected yet, unchanged, changed, or done. */
export type SheetState =
  | { status: 'pending' }
  | { status: 'unchanged'; percent: number }
  | { status: 'changed' | 'done'; count: number; percent: number };

export function sheetState(v: DiffView, s: Sheet): SheetState | null {
  if (s.pair === null) return null;
  const r = v.results[s.pair];
  if (!r) return { status: 'pending' };
  if (r.entries.length === 0) return { status: 'unchanged', percent: r.percent };
  const checked = new Set(v.checked);
  const pair = s.pair;
  const done = r.entries.every((e) => checked.has(entryId(pair, e.key)));
  return { status: done ? 'done' : 'changed', count: r.entries.length, percent: r.percent };
}

/** The sheet list's order: as paired, or most changed first (unchanged and pending last). */
export function sheetOrder(v: DiffView, sheets: readonly Sheet[]): number[] {
  const order = sheets.map((_, i) => i);
  if (!v.sortByChange) return order;
  const pct = (i: number): number => {
    const p = sheets[i]?.pair;
    const r = p === null || p === undefined ? undefined : v.results[p];
    return r ? (r.entries.length ? r.percent : 0) : -1;
  };
  return order.sort((p, q) => pct(q) - pct(p) || p - q);
}

export const toggleChecked = (v: DiffView, id: string): DiffView => ({
  ...v,
  checked: v.checked.includes(id) ? v.checked.filter((k) => k !== id) : [...v.checked, id],
});

let zoneSeq = 0;

/** Adds an ignore zone (a rectangle with some size) in the scope chosen. */
export function addZone(v: DiffView, pair: number | null, box: Box): DiffView {
  const b: Box = [
    Math.min(box[0], box[2]),
    Math.min(box[1], box[3]),
    Math.max(box[0], box[2]),
    Math.max(box[1], box[3]),
  ];
  if (b[2] - b[0] < 1 || b[3] - b[1] < 1) return v;
  return {
    ...v,
    zones: [
      ...v.zones,
      { id: `z${String(++zoneSeq)}`, pair: v.zoneScope === 'all' ? null : pair, box: b },
    ],
  };
}

/** The zones replaced by `zones` (a saved set or a preset placed on the result's sheets). */
export function withZones(v: DiffView, zones: readonly PlacedZone[]): DiffView {
  let next: DiffView = { ...v, zones: [] };
  for (const z of zones)
    next = addZone({ ...next, zoneScope: z.pair === null ? 'all' : 'sheet' }, z.pair, z.box);
  return { ...next, zoneScope: v.zoneScope };
}

export const removeZone = (v: DiffView, zoneId: string): DiffView => ({
  ...v,
  zones: v.zones.filter((z) => z.id !== zoneId),
});

interface DiffStoreState {
  byId: Record<string, DiffView>;
}

export const diffStore = createStore<DiffStoreState>()(() => ({ byId: {} }));

export function useDiffView(id: string): DiffView {
  return useStore(diffStore, (s) => s.byId[id] ?? DEFAULT_DIFF);
}

/** A part of the view (a component re-renders only when it changes). */
export function useDiffPart<T>(id: string, pick: (v: DiffView) => T): T {
  return useStore(diffStore, (s) => pick(s.byId[id] ?? DEFAULT_DIFF));
}

export function diffView(id: string): DiffView {
  return diffStore.getState().byId[id] ?? DEFAULT_DIFF;
}

export function updateDiff(id: string, fn: (v: DiffView) => DiffView): void {
  diffStore.setState((s) => {
    const cur = s.byId[id] ?? DEFAULT_DIFF;
    const next = fn(cur);
    return next === cur ? {} : { byId: { ...s.byId, [id]: next } };
  });
}

export function dropDiff(id: string): void {
  if (!diffStore.getState().byId[id]) return;
  diffStore.setState((s) => ({
    byId: Object.fromEntries(Object.entries(s.byId).filter(([k]) => k !== id)),
  }));
}
