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
//
// An Area's or Volume's value is its net area (less its cutouts) or volume
// in its own unit and decimals (M14-06, Q28); a group's sum is in the unit
// most of them use. A Volume's row also has its area and depth.
import { isCurveTool } from './measureCurve';
import { isAreaTool, MEASURE_TOOL_IDS, VALUE_KIND, type MeasureTool } from './measureMarkup';
import { ANGLE_DECIMALS, measuredValue, PAPER } from './measurement';
import {
  areaValue,
  AREA_SYMBOL,
  DEFAULT_DEPTH,
  MM2_PER,
  MM3_PER,
  volumeValue,
  VOLUME_SYMBOL,
  type AreaUnit,
  type AreaValue,
  type Depth,
  type QuantityMeta,
  type VolumeUnit,
} from './measureQuantity';
import { formatLength, MM_PER_UNIT, type LengthFormat, type Pt, type Scale } from './scale';

/** What a group adds up (an angle is in degrees, whatever the scale; a count is how many). */
export type Quantity = 'length' | 'area' | 'volume' | 'angle' | 'count';

/** An area's or volume's own unit (M14-06, Q28). */
export type QuantityUnit = AreaUnit | VolumeUnit;

export const QUANTITY: Record<MeasureTool, Quantity> = {
  length: 'length',
  polylength: 'length',
  perimeter: 'length',
  area: 'area',
  volume: 'volume',
  angle: 'angle',
  radius: 'length',
  diameter: 'length',
  count: 'count',
};

/**
 * Whether a group has a total: angles, radii and diameters (M14-05) don't add
 * up to anything useful; a count group's total is how many it has (M14-07).
 */
export const hasTotal = (tool: MeasureTool): boolean => !isCurveTool(tool) && tool !== 'count';

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
  /** An Area's or Volume's cutouts, depth and units (its `measure` field, M14-06). */
  q?: QuantityMeta;
  /** A count's group name and number (M14-07). */
  group?: string | undefined;
  n?: number | undefined;
}

export interface MeasureEntry {
  id: string;
  page: number;
  tool: MeasureTool;
  label: string;
  quantity: Quantity;
  /**
   * The value in the scale's unit (an area's or volume's in its own unit);
   * null when it spans scales.
   */
  value: number | null;
  /** The same in millimetres (mm², mm³), for totals; null when it spans scales. */
  base: number | null;
  /** An area's or volume's own unit and decimals (M14-06); null for the others. */
  unit: QuantityUnit | null;
  decimals: number;
  /** How many cutouts an Area or Volume has (Q8: "3 cutouts"). */
  cutouts: number;
  /** A Volume's net area and depth (Q40: shown in the pane); null for the others. */
  area: AreaValue | null;
  depth: Depth | null;
  /** The scale it is shown in (paper size: 1 : 1 mm when it has none). */
  scale: Scale;
  /** Valued at paper size: no scale, or a 1 : 1 scale (Q29). */
  paper: boolean;
  spans: readonly string[] | null;
  where: string;
  at: Pt;
  /** A count's group ('' for the other tools) and number (0 for the other tools). */
  group: string;
  n: number;
}

/** A scale of 1 : 1, or none: values at paper size. */
export const isPaperScale = (s: Scale | null): boolean =>
  !s || Math.abs(s.real / s.paper - 1) < 1e-9;

const power = (q: Quantity): number =>
  q === 'area' ? 2 : q === 'volume' ? 3 : q === 'angle' || q === 'count' ? 0 : 1;

/** Millimetres (mm²) in one `unit` (unit²) of the scale. */
const mmPer = (s: Scale, q: Quantity): number => MM_PER_UNIT[s.unit] ** power(q);

export function measureEntry(i: MeasureEntryInput): MeasureEntry {
  const quantity = QUANTITY[i.tool];
  // An angle or a count needs no scale (Q9, Q11): never "spans" or "at paper size".
  const angle = quantity === 'angle' || quantity === 'count';
  const scale = i.scale ?? PAPER;
  const spans = !angle && i.spans && i.spans.length > 1 ? i.spans : null;
  const kind = isCurveTool(i.tool) || i.tool === 'count' ? i.tool : VALUE_KIND[i.tool];
  const q = i.q ?? {};
  const own = isAreaTool(i.tool)
    ? i.tool === 'volume'
      ? volumeValue(i.points, q, i.scale)
      : areaValue(i.points, q, i.scale)
    : null;
  const raw =
    i.tool === 'count'
      ? (i.n ?? null)
      : spans
        ? null
        : own
          ? own.value
          : measuredValue(kind, i.points, i.scale);
  const value = raw === null || Number.isFinite(raw) ? raw : null;
  const base = value === null ? null : own ? own.base : value * mmPer(scale, quantity);
  return {
    id: i.id,
    page: i.page,
    tool: i.tool,
    label: i.label?.trim() ?? '',
    quantity,
    value,
    base,
    unit: own?.unit ?? null,
    decimals: own?.decimals ?? scale.precision,
    cutouts: isAreaTool(i.tool) ? (q.holes?.length ?? 0) : 0,
    area: i.tool === 'volume' && !spans ? areaValue(i.points, q, i.scale) : null,
    depth: i.tool === 'volume' ? (q.depth ?? DEFAULT_DEPTH) : null,
    scale,
    paper: !angle && isPaperScale(i.scale),
    spans,
    where: i.where,
    at: i.at,
    group: i.tool === 'count' ? (i.group ?? '') : '',
    n: i.tool === 'count' ? (i.n ?? 0) : 0,
  };
}

/** An area's or volume's own unit and decimals, when it has them. */
export interface OwnUnit {
  unit: QuantityUnit | null;
  decimals: number;
}

/**
 * A value as the markups show it ("20.00 m", "12'-6\"", "42.50 m²",
 * "12.75 m³"): a length in its scale's unit, an area or volume in its own.
 */
export function quantityText(
  value: number,
  s: Scale,
  q: Quantity,
  f: LengthFormat,
  own?: OwnUnit,
): string {
  if (q === 'angle') return `${f.fixed(value, ANGLE_DECIMALS)}°`;
  if (q === 'count') return f.number(value, 0);
  if (own?.unit && q === 'area')
    return `${f.fixed(value, own.decimals)} ${AREA_SYMBOL[own.unit as AreaUnit]}`;
  if (own?.unit && q === 'volume')
    return `${f.fixed(value, own.decimals)} ${VOLUME_SYMBOL[own.unit as VolumeUnit]}`;
  return formatLength(value, s, f, q === 'area' ? 'area' : 'distance');
}

/** The entry's value as shown; null when it spans scales (no number, Q30). */
export const entryText = (e: MeasureEntry, f: LengthFormat): string | null =>
  e.value === null ? null : quantityText(e.value, e.scale, e.quantity, f, e);

/** A sum of like values: millimetres (mm², mm³), shown in `scale`'s unit or its own. */
export interface Sum {
  base: number;
  scale: Scale;
  count: number;
  /** An area's or volume's sum: the unit and decimals most of them use. */
  unit: QuantityUnit | null;
  decimals: number;
}

export interface GroupTotal {
  /** The values in a real scale. */
  real: Sum | null;
  /** The values at paper size. */
  paper: Sum | null;
  /** Measurements that span scales: out of the totals. */
  left: number;
}

const unitKey = (e: MeasureEntry): string =>
  e.unit ?? `${e.scale.unit}/${e.scale.ftIn ? 'ftin' : ''}`;

/** The sum of `entries` (all with a value), in the unit most of them use. */
export function sumOf(entries: readonly MeasureEntry[]): Sum | null {
  const valued = entries.filter((e) => e.base !== null);
  const first = valued[0];
  if (!first) return null;
  const counts = new Map<string, { n: number; e: MeasureEntry }>();
  for (const e of valued) {
    const k = unitKey(e);
    const c = counts.get(k);
    if (c) c.n++;
    else counts.set(k, { n: 1, e });
  }
  let best = { n: 0, e: first };
  // Map order is first-seen order, so a tie keeps the first.
  for (const c of counts.values()) if (c.n > best.n) best = c;
  return {
    base: valued.reduce((s, e) => s + (e.base ?? 0), 0),
    scale: best.e.scale,
    count: valued.length,
    unit: best.e.unit,
    decimals: best.e.decimals,
  };
}

/** Millimetres (mm², mm³) in one unit of a sum. */
const perUnit = (s: Sum, q: Quantity): number =>
  s.unit && q === 'area'
    ? MM2_PER[s.unit as AreaUnit]
    : s.unit && q === 'volume'
      ? MM3_PER[s.unit as VolumeUnit]
      : mmPer(s.scale, q);

/** A sum in its unit (its scale's, unit², or an area's or volume's own). */
export const sumValue = (s: Sum, q: Quantity): number => s.base / perUnit(s, q);

export const sumText = (s: Sum, q: Quantity, f: LengthFormat): string =>
  quantityText(sumValue(s, q), s.scale, q, f, s);

export function totalOf(entries: readonly MeasureEntry[]): GroupTotal {
  return {
    real: sumOf(entries.filter((e) => !e.paper)),
    paper: sumOf(entries.filter((e) => e.paper)),
    left: entries.filter((e) => e.base === null).length,
  };
}

export interface MeasureGroup {
  /** The tool, or a count group's own key ("count:" and its name, M14-07). */
  key: string;
  tool: MeasureTool;
  /** A count group's name (M14-07); absent for the other tools. */
  group?: string;
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

/** A count group's key in the pane (case and spacing ignored, as its counts are). */
export const countGroupKey = (name: string): string =>
  `count:${name.replace(/\s+/gu, ' ').trim().toLocaleLowerCase()}`;

const byNumber = (a: MeasureEntry, b: MeasureEntry): number => a.n - b.n || byPlace(a, b);

/**
 * The pane's groups: one per tool that has measurements (in the ribbon's
 * order), each in page order (top to bottom, left to right), with its total;
 * Count last, one group per count group (by name), in number order (M14-07).
 */
export function groupMeasurements(
  entries: readonly MeasureEntry[],
  o: GroupOptions = {},
): MeasureGroup[] {
  const page = o.page ?? null;
  const shown = page === null ? entries : entries.filter((e) => e.page === page);
  const out: MeasureGroup[] = [];
  for (const tool of MEASURE_TOOL_IDS) {
    if (tool === 'count') {
      const byGroup = new Map<string, MeasureEntry[]>();
      for (const e of shown) {
        if (e.tool !== 'count') continue;
        const k = countGroupKey(e.group);
        const list = byGroup.get(k);
        if (list) list.push(e);
        else byGroup.set(k, [e]);
      }
      const keys = [...byGroup.keys()].sort((a, b) => a.localeCompare(b));
      for (const key of keys) {
        const list = (byGroup.get(key) ?? []).sort(byNumber);
        out.push({
          key,
          tool,
          group: list[0]?.group ?? '',
          quantity: 'count',
          entries: list,
          total: { real: null, paper: null, left: 0 },
        });
      }
      continue;
    }
    const list = shown.filter((e) => e.tool === tool).sort(byPlace);
    if (list.length === 0) continue;
    const total = hasTotal(tool) ? totalOf(list) : { real: null, paper: null, left: 0 };
    out.push({ key: tool, tool, quantity: QUANTITY[tool], entries: list, total });
  }
  return out;
}
