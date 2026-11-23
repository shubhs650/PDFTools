// Named sets of ignore zones (M12-14, D-61, Q22), kept on this device in
// IndexedDB (§10.3) and picked again in later comparisons: a title block, a
// revision table. A zone is for every sheet, or for one sheet by its number
// in the result (it applies to that sheet number when the set is used again).
// Records are validated on the way in: storage is never trusted. Pure.
import type { Box } from './textDiff';

export interface StoredZone {
  box: Box;
  /** For every sheet; else for sheet `sheet` (0-based, in the result's order). */
  all: boolean;
  sheet?: number;
}

export interface ZoneSet {
  id: string;
  name: string;
  zones: StoredZone[];
  savedAt: number;
}

/** Longest set name kept. */
export const MAX_SET_NAME = 80;
/** Most zones a set keeps. */
export const MAX_SET_ZONES = 200;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function zoneOf(v: unknown): StoredZone | null {
  if (typeof v !== 'object' || v === null) return null;
  const z = v as { box?: unknown; all?: unknown; sheet?: unknown };
  const b = z.box;
  if (!Array.isArray(b) || b.length !== 4 || !b.every(finite)) return null;
  const [x0, y0, x1, y1] = b;
  const box: Box = [
    Math.min(x0 ?? 0, x1 ?? 0),
    Math.min(y0 ?? 0, y1 ?? 0),
    Math.max(x0 ?? 0, x1 ?? 0),
    Math.max(y0 ?? 0, y1 ?? 0),
  ];
  if (box[2] - box[0] <= 0 || box[3] - box[1] <= 0) return null;
  const all = z.all === true;
  if (all) return { box, all };
  const sheet = z.sheet;
  if (!finite(sheet) || !Number.isInteger(sheet) || sheet < 0) return null;
  return { box, all, sheet };
}

/** A stored set, or null when the record is not one. */
export function zoneSetOf(v: unknown): ZoneSet | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as { id?: unknown; name?: unknown; zones?: unknown; savedAt?: unknown };
  if (typeof r.id !== 'string' || !r.id || typeof r.name !== 'string') return null;
  const name = r.name.trim().slice(0, MAX_SET_NAME);
  if (!name || !Array.isArray(r.zones)) return null;
  const zones = r.zones
    .slice(0, MAX_SET_ZONES)
    .map(zoneOf)
    .filter((z): z is StoredZone => z !== null);
  return { id: r.id, name, zones, savedAt: finite(r.savedAt) ? r.savedAt : 0 };
}

/** Stored sets, valid ones only, by name. */
export function zoneSetsOf(list: readonly unknown[]): ZoneSet[] {
  return list
    .map(zoneSetOf)
    .filter((s): s is ZoneSet => s !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A zone as a comparison holds it: for one compared pair, or for every sheet (null). */
export interface PlacedZone {
  pair: number | null;
  box: Box;
}

/**
 * A comparison's zones as a set stores them: a sheet's zone by the sheet's
 * number in the result (`sheetOfPair`, −1 when the pair is not shown: left out).
 */
export function storeZones(
  zones: readonly PlacedZone[],
  sheetOfPair: (pair: number) => number,
): StoredZone[] {
  const out: StoredZone[] = [];
  for (const z of zones) {
    if (z.pair === null) {
      out.push({ box: z.box, all: true });
      continue;
    }
    const sheet = sheetOfPair(z.pair);
    if (sheet >= 0) out.push({ box: z.box, all: false, sheet });
  }
  return out;
}

/**
 * A stored set's zones placed on a result: a sheet's zone goes to that
 * sheet's compared pair (`pairOfSheet`); one for a sheet the result does not
 * have, or one without both revisions, is left out.
 */
export function placeZones(
  zones: readonly StoredZone[],
  pairOfSheet: (sheet: number) => number | null | undefined,
): PlacedZone[] {
  const out: PlacedZone[] = [];
  for (const z of zones) {
    if (z.all) {
      out.push({ pair: null, box: z.box });
      continue;
    }
    const pair = pairOfSheet(z.sheet ?? -1);
    if (pair !== null && pair !== undefined) out.push({ pair, box: z.box });
  }
  return out;
}
