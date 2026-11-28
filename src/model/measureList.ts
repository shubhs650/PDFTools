// The Measurements pane's model (M14-08, D-76, ADR-035; plan M14 §8): each
// measurement's value in its own scale, its flags (spans two scales, Q30;
// paper size, Q29), the groups by tool with their totals, This page or All
// pages. Totals are plain sums of values already worked out from the
// markups' points (no document reading, rule 1). Pure.
//
// Totals add like with like: every value is turned into millimetres (mm² for
// an area) first, then shown in the unit most of the group's measurements use
// (the first one's on a tie, ft-in when that scale shows ft-in). A value at
// paper size (no scale, or a 1 : 1 scale) is never added to a real one: it has
// its own "at paper size" sum. A measurement that spans two scales has no
// number and stays out of both (Q30).
import { MEASURE_TOOL_IDS, VALUE_KIND, type MeasureTool } from './measureMarkup';
import { measuredValue, PAPER } from './measurement';
import { formatLength, MM_PER_UNIT, type LengthFormat, type Pt, type Scale } from './scale';

/** What a group adds up. */
export type Quantity = 'length' | 'area';

export const QUANTITY: Record<MeasureTool, Quantity> = {
  length: 'length',
  polylength: 'length',
  perimeter: 'length',
  area: 'area',
};

/** One measurement as the pane reads it. */
export interface MeasureEntryInput {
  id: string;
  /** 0-based. */
  page: number;
  tool: MeasureTool;
  /** The optional label (Q27). */
  label?: string | undefined;
  /** The measured points (page points; lengths and areas don't depend on the origin). */
  points: readonly Pt[];
  /** The scale it is valued in; null: none (paper size). */
  scale: Scale | null;
  /** The scale areas it spans (two or more), else null. */
  spans: readonly string[] | null;
  /** Where its scale comes from, as shown ("Detail A · 1 : 5"); display only. */
  where: string;
  /** Its place on the page (top left of its box): the order inside a group. */
  at: Pt;
}

export interface MeasureEntry {
  id: string;
  page: number;
  tool: MeasureTool;
  label: string;
  quantity: Quantity;
  /** The value in the scale's unit (unit² for an area); null when it spans scales. */
  value: number | null;
  /** The same in millimetres (mm²), for totals; null when it spans scales. */
  base: number | null;
  /** The scale it is shown in (paper size: 1 : 1 mm when it has none). */
  scale: Scale;
  /** Valued at paper size: no scale, or a 1 : 1 scale (Q29). */
  paper: boolean;
  spans: readonly string[] | null;
  where: string;
  at: Pt;
}

/** A scale of 1 : 1, or none: values at paper size. */
export const isPaperScale = (s: Scale | null): boolean =>
  !s || Math.abs(s.real / s.paper - 1) < 1e-9;

const power = (q: Quantity): number => (q === 'area' ? 2 : 1);

/** Millimetres (mm²) in one `unit` (unit²) of the scale. */
const mmPer = (s: Scale, q: Quantity): number => MM_PER_UNIT[s.unit] ** power(q);

export function measureEntry(i: MeasureEntryInput): MeasureEntry {
  const quantity = QUANTITY[i.tool];
  const scale = i.scale ?? PAPER;
  const spans = i.spans && i.spans.length > 1 ? i.spans : null;
  const value = spans ? null : measuredValue(VALUE_KIND[i.tool], i.points, i.scale);
  return {
    id: i.id,
    page: i.page,
    tool: i.tool,
    label: i.label?.trim() ?? '',
    quantity,
    value,
    base: value === null ? null : value * mmPer(scale, quantity),
    scale,
    paper: isPaperScale(i.scale),
    spans,
    where: i.where,
    at: i.at,
  };
}

/** A value in a scale's unit, as the markups show it ("20.00 m", "12'-6\"", "42.50 m²"). */
export function quantityText(value: number, s: Scale, q: Quantity, f: LengthFormat): string {
  return formatLength(value, s, f, q === 'area' ? 'area' : 'distance');
}

/** The entry's value as shown; null when it spans scales (no number, Q30). */
export const entryText = (e: MeasureEntry, f: LengthFormat): string | null =>
  e.value === null ? null : quantityText(e.value, e.scale, e.quantity, f);

/** A sum of like values: millimetres (mm²), shown in `scale`'s unit. */
export interface Sum {
  base: number;
  scale: Scale;
  count: number;
}

export interface GroupTotal {
  /** The values in a real scale. */
  real: Sum | null;
  /** The values at paper size. */
  paper: Sum | null;
  /** Measurements that span scales: out of the totals. */
  left: number;
}

const unitKey = (s: Scale): string => `${s.unit}/${s.ftIn ? 'ftin' : ''}`;

/** The sum of `entries` (all with a value), in the unit most of them use. */
export function sumOf(entries: readonly MeasureEntry[]): Sum | null {
  const valued = entries.filter((e) => e.base !== null);
  const first = valued[0];
  if (!first) return null;
  const counts = new Map<string, { n: number; scale: Scale }>();
  for (const e of valued) {
    const k = unitKey(e.scale);
    const c = counts.get(k);
    if (c) c.n++;
    else counts.set(k, { n: 1, scale: e.scale });
  }
  let best = { n: 0, scale: first.scale };
  // Map order is first-seen order, so a tie keeps the first.
  for (const c of counts.values()) if (c.n > best.n) best = c;
  return {
    base: valued.reduce((s, e) => s + (e.base ?? 0), 0),
    scale: best.scale,
    count: valued.length,
  };
}

/** A sum in its scale's unit (unit²). */
export const sumValue = (s: Sum, q: Quantity): number => s.base / mmPer(s.scale, q);

export const sumText = (s: Sum, q: Quantity, f: LengthFormat): string =>
  quantityText(sumValue(s, q), s.scale, q, f);

export function totalOf(entries: readonly MeasureEntry[]): GroupTotal {
  return {
    real: sumOf(entries.filter((e) => !e.paper)),
    paper: sumOf(entries.filter((e) => e.paper)),
    left: entries.filter((e) => e.base === null).length,
  };
}

export interface MeasureGroup {
  /** The tool now; a count group's own key once Count exists (M14-07). */
  key: string;
  tool: MeasureTool;
  quantity: Quantity;
  entries: MeasureEntry[];
  total: GroupTotal;
}

export interface GroupOptions {
  /** This page only (0-based); absent: all pages. */
  page?: number | null;
}

const byPlace = (a: MeasureEntry, b: MeasureEntry): number =>
  a.page - b.page ||
  Math.round(a.at.y) - Math.round(b.at.y) ||
  a.at.x - b.at.x ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The pane's groups: one per tool that has measurements (in the ribbon's
 * order), each in page order (top to bottom, left to right), with its total.
 */
export function groupMeasurements(
  entries: readonly MeasureEntry[],
  o: GroupOptions = {},
): MeasureGroup[] {
  const page = o.page ?? null;
  const shown = page === null ? entries : entries.filter((e) => e.page === page);
  const out: MeasureGroup[] = [];
  for (const tool of MEASURE_TOOL_IDS) {
    const list = shown.filter((e) => e.tool === tool).sort(byPlace);
    if (list.length === 0) continue;
    out.push({ key: tool, tool, quantity: QUANTITY[tool], entries: list, total: totalOf(list) });
  }
  return out;
}
