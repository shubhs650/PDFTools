// The summary page of an overlay comparison file (M12-21, D-65; plan §"Saving
// and outputs"): the first page of the file, before the overlay sheets, with
// the file names, the date, the counts, the legend and the settings used
// (ignore zones included). Pure: the counts here, the words on the main thread
// (rule 11), the page drawn in the Work worker (comparisonFile/summary.ts).
import type { DiffKind, DiffType } from './detect/entries';
import type { SheetStatus } from './file/format';
import type { Rgb } from './overlay';

export type { Rgb };

/** One block of the page, top to bottom (all words already localized). */
export type SummaryBlock =
  | { kind: 'title'; text: string }
  | { kind: 'heading'; text: string }
  /** A label and its value side by side; the value wraps. */
  | { kind: 'row'; label: string; value: string }
  /** A colour square and what it means (0–255 per channel). */
  | { kind: 'swatch'; colour: Rgb; text: string }
  | { kind: 'note'; text: string };

export interface SummarySpec {
  blocks: SummaryBlock[];
}

/** A sheet as the summary counts it. */
export interface SummarySheet {
  /** Its compared pair (both sides present), else null. */
  pair: number | null;
  a: boolean;
  b: boolean;
  status: SheetStatus;
}

/** What a compared pair's differences are, once found. */
export interface SummaryResult {
  entries: readonly { key: string; kind: DiffKind; type: DiffType }[];
}

/** An ignore zone: a compared pair, or every sheet (null). */
export interface SummaryZone {
  pair: number | null;
}

export interface OverlayFacts {
  sheets: number;
  /** Sheets with both sides (compared), only in A (removed), only in B (added). */
  compared: number;
  onlyA: number;
  onlyB: number;
  /** Compared sheets with differences, without, and not checked yet. */
  changed: number;
  unchanged: number;
  pending: number;
  differences: number;
  kinds: Record<DiffKind, number>;
  types: Record<DiffType, number>;
  /** Differences ticked as checked. */
  checked: number;
  /** Compared sheets by how their placement was found. */
  placement: Record<SheetStatus, number>;
  /** Ignore zones on every sheet, and per sheet (1-based sheet number, in order). */
  zones: { every: number; sheets: [number, number][] };
}

/**
 * The counts of an overlay comparison. `isChecked(pair, key)`: whether a
 * difference is ticked. Differences are counted as found (ignore zones and the
 * smallest size already applied), every kind and type, whatever the list's
 * filters show.
 */
export function overlayFacts(
  sheets: readonly SummarySheet[],
  results: Readonly<Record<number, SummaryResult | undefined>>,
  isChecked: (pair: number, key: string) => boolean,
  zones: readonly SummaryZone[],
): OverlayFacts {
  const f: OverlayFacts = {
    sheets: sheets.length,
    compared: 0,
    onlyA: 0,
    onlyB: 0,
    changed: 0,
    unchanged: 0,
    pending: 0,
    differences: 0,
    kinds: { added: 0, removed: 0, changed: 0 },
    types: { text: 0, geometry: 0, both: 0 },
    checked: 0,
    placement: { asIs: 0, aligned: 0, manual: 0, lowConfidence: 0 },
    zones: { every: 0, sheets: [] },
  };
  const sheetOfPair = new Map<number, number>();
  sheets.forEach((s, i) => {
    if (s.pair === null || !s.a || !s.b) {
      if (s.a && !s.b) f.onlyA++;
      else if (s.b && !s.a) f.onlyB++;
      return;
    }
    sheetOfPair.set(s.pair, i + 1);
    f.compared++;
    f.placement[s.status]++;
    const r = results[s.pair];
    if (!r) {
      f.pending++;
      return;
    }
    if (r.entries.length === 0) f.unchanged++;
    else f.changed++;
    for (const e of r.entries) {
      f.differences++;
      f.kinds[e.kind]++;
      f.types[e.type]++;
      if (isChecked(s.pair, e.key)) f.checked++;
    }
  });
  const per = new Map<number, number>();
  for (const z of zones) {
    if (z.pair === null) {
      f.zones.every++;
      continue;
    }
    const sheet = sheetOfPair.get(z.pair);
    if (sheet !== undefined) per.set(sheet, (per.get(sheet) ?? 0) + 1);
  }
  f.zones.sheets = [...per.entries()].sort((x, y) => x[0] - y[0]);
  return f;
}

/** Where ink of both colours overlaps on white paper (B is multiplied onto A). */
export const multiplied = (a: Rgb, b: Rgb): Rgb => [
  Math.round((a[0] * b[0]) / 255),
  Math.round((a[1] * b[1]) / 255),
  Math.round((a[2] * b[2]) / 255),
];
