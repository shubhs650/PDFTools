// The summary on the sheet (M14-10, D-76, ADR-035 Amendment 1 decision 1;
// plan M14 §10, Q17): one /FreeText markup holding a table of the
// measurement groups, how many each has and its total, which Triya PDF keeps
// up to date as measurements change. Its /Contents holds the same rows as
// plain text (tab between cells), so a viewer that redraws it from its text
// still shows them; the table itself is drawn into its appearance by the
// Render worker (summaryAppearance.ts), laid out here so the main thread's
// /Rect and the worker's drawing agree (the text widths are estimated
// generously, model/measureMarkup.ts). Its Triya data (the page's /PieceInfo,
// measureData.ts) says it is a summary and of which measurements. Pure.
import { estimateWidth } from './measureMarkup';
import { sumText, type MeasureGroup } from './measureList';
import type { LengthFormat } from './scale';
import { textOf } from './measureData';
import type { PdfJson } from './pdf/wire';

/** Which measurements a summary adds up: its own page's, or the whole document's. */
export type SummaryScope = 'page' | 'all';

/** What a summary markup carries in this session (`summary` on the annotation object). */
export interface SummaryMeta {
  scope: SummaryScope;
  /** The table: the head row, then one row per total; three cells each. */
  rows: string[][];
}

/** Text size, row height and cell padding of the table (points). */
export const SUMMARY_SIZE = 8.5;
export const SUMMARY_ROW = 14;
export const SUMMARY_PAD = 4;
/** Narrowest column. */
const MIN_COLUMN = 28;

export interface SummaryWords {
  /** The head row: "Measurements on this page" / "Measurements, all pages", "Count", "Total". */
  head: [string, string, string];
  tool(group: MeasureGroup): string;
  atPaper(name: string): string;
  /** ", 1 left out" after a total. */
  leftOut(n: number): string;
  /** A group with no total (angles). */
  noTotal: string;
  /** No measurements yet. */
  none: string;
}

/** The table's rows for `groups` (already this page's or all pages'). */
export function summaryRows(
  groups: readonly MeasureGroup[],
  words: SummaryWords,
  f: LengthFormat,
): string[][] {
  const out: string[][] = [[...words.head]];
  for (const g of groups) {
    const name = words.tool(g);
    const { real, paper, left } = g.total;
    const extra = left ? words.leftOut(left) : '';
    if (!real && !paper) {
      out.push([name, f.number(g.entries.length, 0), left ? extra.trim() : words.noTotal]);
      continue;
    }
    if (real) out.push([name, f.number(real.count, 0), sumText(real, g.quantity, f) + extra]);
    if (paper)
      out.push([
        words.atPaper(name),
        f.number(paper.count, 0),
        sumText(paper, g.quantity, f) + (real ? '' : extra),
      ]);
  }
  if (out.length === 1) out.push([words.none, '', '']);
  return out;
}

/** /Contents: the rows as lines, cells apart by a tab. */
export const summaryText = (rows: readonly (readonly string[])[]): string =>
  rows.map((r) => r.join('\t')).join('\n');

export interface SummaryLayout {
  /** Column widths (points). */
  widths: number[];
  width: number;
  height: number;
}

/** The table's size: each column as wide as its widest text, rows SUMMARY_ROW high. */
export function summaryLayout(rows: readonly (readonly string[])[]): SummaryLayout {
  const cols = Math.max(0, ...rows.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, c) =>
    Math.ceil(
      Math.max(
        MIN_COLUMN,
        ...rows.map((r) => estimateWidth(r[c] ?? '', SUMMARY_SIZE) + 2 * SUMMARY_PAD),
      ),
    ),
  );
  return {
    widths,
    width: widths.reduce((a, b) => a + b, 0),
    height: rows.length * SUMMARY_ROW,
  };
}

/** The summary a markup carries in this session, or null. */
export function summaryOf(a: unknown): SummaryMeta | null {
  const s = (a as { summary?: unknown } | null | undefined)?.summary;
  if (!s || typeof s !== 'object') return null;
  const o = s as { scope?: unknown; rows?: unknown };
  if (o.scope !== 'page' && o.scope !== 'all') return null;
  const rows = Array.isArray(o.rows)
    ? o.rows.filter((r): r is string[] => Array.isArray(r) && r.every((c) => typeof c === 'string'))
    : [];
  return { scope: o.scope, rows };
}

/** The summary's Triya data entry: `/T /Summary /Sc /Page` or `/All`. */
export function summaryToPdf(s: Pick<SummaryMeta, 'scope'>): PdfJson {
  return { dict: { T: { name: 'Summary' }, Sc: { name: s.scope === 'page' ? 'Page' : 'All' } } };
}

/** A Triya data entry read back as a summary's scope, or null when it is not a summary. */
export function summaryFromPdf(j: PdfJson | undefined): SummaryScope | null {
  if (!j || typeof j !== 'object' || Array.isArray(j) || !('dict' in j)) return null;
  const d = j.dict;
  const name = (v: PdfJson | undefined): string | undefined =>
    v && typeof v === 'object' && !Array.isArray(v) && 'name' in v ? v.name : textOf(v);
  if (name(d['T']) !== 'Summary') return null;
  return name(d['Sc']) === 'Page' ? 'page' : 'all';
}
