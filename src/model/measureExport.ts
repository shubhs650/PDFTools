// The measurements export (M14-10, D-76, ADR-035; plan M14 §10, Q32): a fixed
// layout. Sheet 1 lists every measurement (No., Page, Scale area, Tool, Group
// or Label, Value, Unit, Depth, Scale, Author, Date, and the picture when
// asked), values as real numbers shown to their scale's decimals; sheet 2
// holds each group's total. CSV is sheet 1's rows only. The words come in
// from the caller (i18n); the numbers, units, formats and the stamp that says
// whether an attached copy is still current are worked out here. Pure.
import type { MeasureTool } from './measureMarkup';
import {
  sumValue,
  type MeasureEntry,
  type MeasureGroup,
  type Quantity,
  type QuantityUnit,
  type Sum,
} from './measureList';
import {
  AREA_SYMBOL,
  depthMm,
  VOLUME_SYMBOL,
  type AreaUnit,
  type VolumeUnit,
} from './measureQuantity';
import { MM_PER_UNIT, type Scale } from './scale';
import { ANGLE_DECIMALS } from './measurement';

/** A cell of the workbook: text, a number shown with `fmt`, an Excel date (serial, local time), or empty. */
export type BookCell = string | { n: number; fmt: string } | { date: number } | null;

export interface BookSheet {
  name: string;
  /** Row 1 (merged across the columns). */
  title: string;
  columns: string[];
  /** Character widths of the columns. */
  widths: number[];
  rows: BookCell[][];
  /** The column that holds each row's picture (sheet 1 with pictures), else null. */
  pictureColumn: number | null;
}

export interface MeasureBookSpec {
  sheets: BookSheet[];
}

/** A measurement's place for its picture: page points, top-left origin, 0-based page. */
export interface PictureRegion {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One measurement as the export lists it. */
export interface ExportItem {
  entry: MeasureEntry;
  /** The scale area it is in ("Detail A", "Page"), or "" when there is none. */
  area: string;
  /** Its scale as shown ("1 : 100"), or why it has none ("Paper size", "Spans 2 scales"). */
  scale: string;
  /** The count group or the label (Q27). */
  group: string;
  author: string;
  /** Last changed (else made), or null. */
  date: Date | null;
  region: PictureRegion;
}

/** The words the sheets need, from the caller (i18n). */
export interface ExportWords {
  measurementsSheet: string;
  totalsSheet: string;
  /** Row 1 of each sheet. */
  measurementsTitle: string;
  totalsTitle: string;
  /** Sheet 1's column titles, in MEASURE_COLUMNS order. */
  columns: Record<MeasureColumn, string>;
  picture: string;
  /** Sheet 2's column titles, in TOTAL_COLUMNS order. */
  totalColumns: Record<TotalColumn, string>;
  tool(tool: MeasureTool): string;
  /** "Length (at paper size)". */
  atPaper(name: string): string;
  /** "1 not in the total (spans 2 scales)". */
  leftOut(n: number): string;
  /** "No total" (angles, radii, diameters). */
  noTotal: string;
}

export const MEASURE_COLUMNS = [
  'number',
  'page',
  'area',
  'tool',
  'group',
  'value',
  'unit',
  'depth',
  'scale',
  'author',
  'date',
] as const;
export type MeasureColumn = (typeof MEASURE_COLUMNS)[number];

export const TOTAL_COLUMNS = ['group', 'count', 'total', 'unit', 'note'] as const;
export type TotalColumn = (typeof TOTAL_COLUMNS)[number];

const MEASURE_WIDTHS: Record<MeasureColumn, number> = {
  number: 6,
  page: 6,
  area: 16,
  tool: 14,
  group: 22,
  value: 12,
  unit: 7,
  depth: 9,
  scale: 14,
  author: 18,
  date: 17,
};
const TOTAL_WIDTHS: Record<TotalColumn, number> = {
  group: 26,
  count: 8,
  total: 14,
  unit: 7,
  note: 36,
};
/** The picture column: wide enough for a 240 px picture. */
const PICTURE_WIDTH = 36;

/** Excel's date format for the Date column (shown in the reader's own way by Excel). */
export const DATE_FORMAT = 'yyyy-mm-dd hh:mm';

/**
 * A unit as the sheet writes it: "m", "m²", "°"; an area or volume in its own
 * unit when it has one (M14-06: "sq ft", "m³").
 */
export function unitText(scale: Scale, q: Quantity, own?: QuantityUnit | null): string {
  if (q === 'area') return own ? AREA_SYMBOL[own as AreaUnit] : `${scale.unit}²`;
  if (q === 'volume') return own ? VOLUME_SYMBOL[own as VolumeUnit] : `${scale.unit}³`;
  if (q === 'length') return scale.unit;
  if (q === 'count') return ''; // a count's value is its number (M14-07)
  return '°'; // an angle (M14-05), whatever the scale
}

/**
 * Decimals a value is shown with: its scale's (ft-in in decimal feet: at
 * least 2); an area's or volume's own (M14-06) when it has its own unit.
 */
export function decimalsOf(scale: Scale, q: Quantity, own?: { decimals: number }): number {
  if (q === 'angle') return ANGLE_DECIMALS;
  if (own && (q === 'area' || q === 'volume')) return own.decimals;
  if (q === 'count') return 0;
  const p = Math.max(0, Math.min(6, Math.round(scale.precision)));
  return scale.ftIn && q === 'length' ? Math.max(2, p) : p;
}

/** Excel's number format for `decimals` places: "0", "0.00". */
export const numberFormat = (decimals: number): string =>
  decimals > 0 ? `0.${'0'.repeat(decimals)}` : '0';

/** A date as an Excel serial number in local time (the sheet shows the clock the person saw). */
export function excelDate(d: Date): number {
  // Whole seconds: a PDF date has no more, so a reopened file gives the same value.
  const local = Math.floor(d.getTime() / 1000) * 1000 - d.getTimezoneOffset() * 60_000;
  return local / 86_400_000 + 25_569;
}

/** 1.4999999999999996 → 1.5: the floating-point noise of the sums, not the value. */
const clean = (n: number): number => Number(n.toPrecision(12));
const num = (n: number, decimals: number): BookCell => ({
  n: clean(n),
  fmt: numberFormat(decimals),
});
const whole = (n: number): BookCell => ({ n, fmt: '0' });

/** An area's or volume's own unit and decimals, when it has one. */
const ownOf = (o: { unit: QuantityUnit | null; decimals: number }) =>
  o.unit ? { decimals: o.decimals } : undefined;

/** Sheet 1's cells for one measurement, numbered `no` (1-based). */
export function itemCells(item: ExportItem, no: number, tool: string): BookCell[] {
  const e = item.entry;
  const cells: Record<MeasureColumn, BookCell> = {
    number: whole(no),
    page: whole(e.page + 1),
    area: item.area,
    tool,
    group: item.group,
    value: e.value === null ? null : num(e.value, decimalsOf(e.scale, e.quantity, ownOf(e))),
    unit: e.value === null ? '' : unitText(e.scale, e.quantity, e.unit),
    // A Volume's depth (M14-06), in its scale's length unit.
    depth: e.depth
      ? num(depthMm(e.depth) / MM_PER_UNIT[e.scale.unit], decimalsOf(e.scale, 'length'))
      : null,
    scale: item.scale,
    author: item.author,
    date: item.date ? { date: excelDate(item.date) } : null,
  };
  return MEASURE_COLUMNS.map((c) => cells[c]);
}

/** The export's items in order: group by group, as the Measurements pane lists them. */
export const orderedEntries = (groups: readonly MeasureGroup[]): MeasureEntry[] =>
  groups.flatMap((g) => g.entries);

function sumRow(name: string, sum: Sum, q: Quantity, note: string): BookCell[] {
  const cells: Record<TotalColumn, BookCell> = {
    group: name,
    count: whole(sum.count),
    total: num(sumValue(sum, q), decimalsOf(sum.scale, q, ownOf(sum))),
    unit: unitText(sum.scale, q, sum.unit),
    note,
  };
  return TOTAL_COLUMNS.map((c) => cells[c]);
}

/**
 * Sheet 2's rows: each group's total in a real scale, then its total at paper
 * size (never added to a real one), the measurements left out (spanning two
 * scales) in the note. A group with no total (angles) lists its count only.
 */
export function totalRows(groups: readonly MeasureGroup[], words: ExportWords): BookCell[][] {
  const out: BookCell[][] = [];
  for (const g of groups) {
    // A count group by its own name ("Door"): its count is its total (M14-07).
    const name = g.group ?? words.tool(g.tool);
    const { real, paper, left } = g.total;
    const note = left ? words.leftOut(left) : '';
    if (!real && !paper) {
      const cells: Record<TotalColumn, BookCell> = {
        group: name,
        count: whole(g.entries.length),
        total: null,
        unit: '',
        note: left ? note : g.quantity === 'count' ? '' : words.noTotal,
      };
      out.push(TOTAL_COLUMNS.map((c) => cells[c]));
      continue;
    }
    if (real) out.push(sumRow(name, real, g.quantity, note));
    if (paper) out.push(sumRow(words.atPaper(name), paper, g.quantity, real ? '' : note));
  }
  return out;
}

/** The workbook: the measurements (with a Picture column when asked) and the totals. */
export function exportBook(
  groups: readonly MeasureGroup[],
  items: readonly ExportItem[],
  words: ExportWords,
  pictures: boolean,
): MeasureBookSpec {
  const columns = MEASURE_COLUMNS.map((c) => words.columns[c]);
  const widths = MEASURE_COLUMNS.map((c) => MEASURE_WIDTHS[c]);
  const rows = items.map((it, i) => {
    const cells = itemCells(it, i + 1, words.tool(it.entry.tool));
    return pictures ? [...cells, null] : cells;
  });
  return {
    sheets: [
      {
        name: words.measurementsSheet,
        title: words.measurementsTitle,
        columns: pictures ? [...columns, words.picture] : columns,
        widths: pictures ? [...widths, PICTURE_WIDTH] : widths,
        rows,
        pictureColumn: pictures ? columns.length : null,
      },
      {
        name: words.totalsSheet,
        title: words.totalsTitle,
        columns: TOTAL_COLUMNS.map((c) => words.totalColumns[c]),
        widths: TOTAL_COLUMNS.map((c) => TOTAL_WIDTHS[c]),
        rows: totalRows(groups, words),
        pictureColumn: null,
      },
    ],
  };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** A cell as CSV writes it: numbers with a point and their decimals, dates as "2026-11-28 14:05". */
export function csvText(c: BookCell): string {
  if (c === null) return '';
  if (typeof c === 'string') return c;
  if ('date' in c) {
    const ms = Math.round((c.date - 25_569) * 86_400_000);
    const d = new Date(ms);
    return `${String(d.getUTCFullYear())}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }
  const dot = c.fmt.indexOf('.');
  return c.n.toFixed(dot < 0 ? 0 : c.fmt.length - dot - 1);
}

/** CSV's lines: sheet 1's column titles and rows (no pictures). */
export function csvLines(book: MeasureBookSpec): string[][] {
  const sheet = book.sheets[0];
  if (!sheet) return [];
  const keep = (row: readonly unknown[]): boolean[] => row.map((_, i) => i !== sheet.pictureColumn);
  const k = keep(sheet.columns);
  return [
    sheet.columns.filter((_, i) => k[i]),
    ...sheet.rows.map((r) => r.filter((_, i) => k[i]).map(csvText)),
  ];
}

/** FNV-1a, 32 bits, as 8 hex digits. */
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Which measurements an export holds: All pages, or one page (0-based). */
export type ExportScope = { all: true } | { all: false; page: number };

/** How an attached export was made, so a refresh makes it the same way. */
export interface StampInfo {
  pictures: boolean;
  scope: ExportScope;
}

/** The stamp's form: "v1;p1;all;<hash>" or "v1;p0;page3;<hash>" (p1: with pictures). */
const STAMP = /^v1;p([01]);(all|page(\d+));([0-9a-f]{8})$/u;

/**
 * What an attached export was made from: the sheets' cells as CSV writes them
 * (values to their shown decimals, dates to the minute, so a saved and
 * reopened file still matches; not the titles, which carry the day), how it
 * was made (pictures, which pages). A copy whose stamp differs from the
 * document's now is out of date (Q18).
 */
export function exportStamp(book: MeasureBookSpec, info: StampInfo): string {
  const body = book.sheets
    .map((s) =>
      [s.columns, ...s.rows.map((r) => r.map(csvText))].map((r) => r.join('\t')).join('\n'),
    )
    .join('\f');
  const scope = info.scope.all ? 'all' : `page${String(info.scope.page)}`;
  return `v1;p${info.pictures ? '1' : '0'};${scope};${fnv(body)}`;
}

/** A stamp read back; null when it isn't one of ours. */
export function readStamp(stamp: string): StampInfo | null {
  const m = STAMP.exec(stamp);
  if (!m) return null;
  return {
    pictures: m[1] === '1',
    scope: m[3] === undefined ? { all: true } : { all: false, page: Number(m[3]) },
  };
}
