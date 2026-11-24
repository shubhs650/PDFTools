// The live sheet preview of a CRS template's set-up (M13-08, D-71, plan M13
// §6 "Setting up", C13): the chosen sheet's first rows as Excel draws them —
// text, merged cells, borders, fills, fonts, alignment, column widths and row
// heights, and where pictures sit — read in the Work worker (rule 1). Only
// what the set-up shows goes back to the page, and nothing is logged (rule
// 10). Colours are resolved to CSS hex here: theme colours from the default
// Office theme with their tint, indexed colours from the legacy palette.
import type ExcelJS from 'exceljs';
import { parseCell } from '../../../model/crs/a1';
import { lastPreDrawnOf, widthPx } from './fill';
import { ends, model } from './sheetModel';

/** The rows the preview shows at least and at most (plan: "first 60 rows"). */
export const PREVIEW_MIN_ROWS = 20;
export const PREVIEW_ROWS = 60;
/** A start row further down still gets a few rows round it, up to this many. */
export const PREVIEW_MAX_ROWS = 400;
export const PREVIEW_MIN_COLS = 8;
export const PREVIEW_MAX_COLS = 52;
/** Longest text a preview cell carries (the cell shows what fits). */
const MAX_TEXT = 200;

export interface PreviewEdge {
  /** Excel's style name: thin, medium, thick, dashed, dotted, double, hair, … */
  style: string;
  color: string | null;
}

export interface PreviewCell {
  /** 1-based row and column. */
  r: number;
  c: number;
  text: string;
  /** A merge's first cell: its row and column span. */
  rs?: number;
  cs?: number;
  fill?: string;
  color?: string;
  bold?: true;
  italic?: true;
  underline?: true;
  /** Font size in points when not 11. */
  size?: number;
  h?: 'left' | 'center' | 'right';
  v?: 'top' | 'middle' | 'bottom';
  wrap?: true;
  /** The cell holds a formula (its last result, if any, is the text). */
  formula?: true;
  top?: PreviewEdge;
  right?: PreviewEdge;
  bottom?: PreviewEdge;
  left?: PreviewEdge;
}

export interface PreviewRange {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export interface SheetPreview {
  sheet: string;
  /** Rows and columns shown. */
  rows: number;
  cols: number;
  /** The sheet's last used row and column. */
  usedRows: number;
  usedCols: number;
  /** Pixel widths of columns 1…cols and heights of rows 1…rows (96 dpi). */
  colPx: number[];
  rowPx: number[];
  /** Cells with text or a style, merge masters with their spans. */
  cells: PreviewCell[];
  /** Merged ranges inside the shown area (cut to it). */
  merges: PreviewRange[];
  /** Where pictures (a logo) sit, as cell ranges. */
  pictures: PreviewRange[];
  /** The last pre-drawn row for the probe (C3), or null without one. */
  lastPreDrawn: number | null;
}

export interface PreviewRequest {
  sheet: string;
  /** Rows the preview must reach (the start row, a detail cell); 0 = none. */
  needRow: number;
  /** With a start row: the table's columns (empty: the start row's boxed cells). */
  probe: { startRow: number; columns: number[]; lastPreDrawn: number | null } | null;
}

// ---------------------------------------------------------------------------
// Colours.

/** The default Office theme (2013 and later): lt1, dk1, lt2, dk2, accent 1 – 6, link, followed link. */
const THEME = [
  'FFFFFF',
  '000000',
  'E7E6E6',
  '44546A',
  '4472C4',
  'ED7D31',
  'A5A5A5',
  'FFC000',
  '5B9BD5',
  '70AD47',
  '0563C1',
  '954F72',
];

/** The legacy indexed palette (0 – 63). */
const INDEXED = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
  '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF',
  '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
]; // prettier-ignore

/** Excel's tint: towards white when positive, towards black when negative. */
function tinted(hex: string, tint: number): string {
  const ch = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const out = ch.map((v) =>
    Math.round(tint < 0 ? v * (1 + tint) : v + (255 - v) * Math.min(1, tint)),
  );
  return out.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

/** An ExcelJS colour as CSS hex, or null (automatic or unknown). */
export function cssColor(c: unknown): string | null {
  if (typeof c !== 'object' || c === null) return null;
  const v = c as { argb?: unknown; theme?: unknown; tint?: unknown; indexed?: unknown };
  let hex: string | undefined;
  if (typeof v.argb === 'string' && /^[0-9a-f]{6,8}$/iu.test(v.argb)) hex = v.argb.slice(-6);
  else if (typeof v.theme === 'number') hex = THEME[v.theme];
  else if (typeof v.indexed === 'number') hex = INDEXED[v.indexed];
  if (!hex) return null;
  const tint = typeof v.tint === 'number' ? v.tint : 0;
  return `#${(tint ? tinted(hex, tint) : hex).toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Text.

const pad2 = (n: number) => String(n).padStart(2, '0');

/** What a cell shows: text, number, the day of a date, a formula's last result. */
function textOf(cell: ExcelJS.Cell): { text: string; formula: boolean } {
  const v = cell.value as unknown;
  if (v === null || v === undefined) return { text: '', formula: false };
  if (v instanceof Date) {
    const text = `${String(v.getUTCFullYear())}-${pad2(v.getUTCMonth() + 1)}-${pad2(v.getUTCDate())}`;
    return { text, formula: false };
  }
  if (typeof v === 'object') {
    const o = v as { formula?: unknown; sharedFormula?: unknown; result?: unknown };
    if (o.formula !== undefined || o.sharedFormula !== undefined) {
      const r = o.result;
      const text =
        r === undefined || r === null || typeof r === 'object'
          ? r instanceof Date
            ? textOf({ value: r } as ExcelJS.Cell).text
            : ''
          : typeof r === 'string'
            ? r
            : typeof r === 'number' || typeof r === 'boolean'
              ? String(r)
              : '';
      return { text, formula: true };
    }
  }
  let text = '';
  try {
    text = cell.text;
  } catch {
    text = '';
  }
  return { text, formula: false };
}

// ---------------------------------------------------------------------------

function edgeOf(e: Partial<ExcelJS.Border> | undefined): PreviewEdge | undefined {
  if (!e?.style) return undefined;
  return { style: e.style, color: cssColor(e.color) };
}

/** A range "A1:B3" as numbers. */
function rangeOf(ref: string): PreviewRange {
  const [a, b] = ends(ref);
  const p = parseCell(a);
  const q = parseCell(b);
  return { r1: p.row, c1: p.col, r2: q.row, c2: q.col };
}

/** The start row's boxed or filled columns (the table, before any column is placed). */
function boxedColumns(ws: ExcelJS.Worksheet, row: number, cols: number): number[] {
  const out: number[] = [];
  for (let c = 1; c <= cols; c++) {
    const s = ws.getCell(row, c).style as Partial<ExcelJS.Style> | undefined;
    const b = s?.border;
    const f = s?.fill as { pattern?: string } | undefined;
    if (b?.left?.style || b?.right?.style || (f?.pattern && f.pattern !== 'none')) out.push(c);
  }
  return out;
}

export function sheetPreview(wb: ExcelJS.Workbook, req: PreviewRequest): SheetPreview | null {
  const ws = wb.getWorksheet(req.sheet);
  if (!ws) return null;
  const usedRows = ws.rowCount;
  const usedCols = ws.columnCount;
  const m = model(ws);
  const merges = m.merges.map(rangeOf);
  const wantRow = Math.max(req.needRow, req.probe?.startRow ?? 0);
  const rows = Math.min(
    PREVIEW_MAX_ROWS,
    Math.max(PREVIEW_MIN_ROWS, Math.min(PREVIEW_ROWS, usedRows + 5), wantRow > 0 ? wantRow + 8 : 0),
  );
  const mergeCols = merges.filter((g) => g.r1 <= rows).reduce((n, g) => Math.max(n, g.c2), 0);
  const cols = Math.min(PREVIEW_MAX_COLS, Math.max(PREVIEW_MIN_COLS, usedCols, mergeCols));

  const props = ws.properties as Partial<ExcelJS.WorksheetProperties>;
  const defWidth = props.defaultColWidth ?? 8.43;
  const defHeightPt = props.defaultRowHeight ?? 15;
  const colPx: number[] = [];
  for (let c = 1; c <= cols; c++) {
    const col = ws.getColumn(c);
    colPx.push(col.hidden ? 4 : widthPx(col.width ?? defWidth));
  }
  const rowPx: number[] = [];
  for (let r = 1; r <= rows; r++) {
    const row = ws.getRow(r);
    const pt = (row.height as number | undefined) ?? defHeightPt;
    rowPx.push(row.hidden ? 4 : Math.max(4, Math.round((pt * 4) / 3)));
  }

  // Cells inside a merge but not its first: drawn by the first.
  const covered = new Set<string>();
  const spans = new Map<string, PreviewRange>();
  for (const g of merges) {
    if (g.r1 > rows || g.c1 > cols) continue;
    spans.set(`${String(g.r1)}:${String(g.c1)}`, g);
    for (let r = g.r1; r <= g.r2; r++)
      for (let c = g.c1; c <= g.c2; c++)
        if (r !== g.r1 || c !== g.c1) covered.add(`${String(r)}:${String(c)}`);
  }

  const cells: PreviewCell[] = [];
  for (let r = 1; r <= Math.min(rows, usedRows); r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= cols; c++) {
      const key = `${String(r)}:${String(c)}`;
      if (covered.has(key)) continue;
      const cell = row.getCell(c);
      const s = cell.style as Partial<ExcelJS.Style> | undefined;
      const { text, formula } = textOf(cell);
      const out: PreviewCell = { r, c, text: text.slice(0, MAX_TEXT) };
      const span = spans.get(key);
      if (span) {
        out.rs = Math.min(span.r2, rows) - span.r1 + 1;
        out.cs = Math.min(span.c2, cols) - span.c1 + 1;
      }
      if (formula) out.formula = true;
      const fill = s?.fill as { type?: string; pattern?: string; fgColor?: unknown } | undefined;
      if (fill?.type === 'pattern' && fill.pattern && fill.pattern !== 'none') {
        const bg = cssColor(fill.fgColor);
        if (bg) out.fill = bg;
      }
      const font = s?.font;
      if (font) {
        const color = cssColor(font.color);
        if (color) out.color = color;
        if (font.bold) out.bold = true;
        if (font.italic) out.italic = true;
        if (font.underline) out.underline = true;
        if (font.size && font.size !== 11) out.size = font.size;
      }
      const al = s?.alignment;
      if (al) {
        if (al.horizontal === 'left' || al.horizontal === 'right') out.h = al.horizontal;
        else if (al.horizontal === 'center' || al.horizontal === 'centerContinuous')
          out.h = 'center';
        if (al.vertical === 'top' || al.vertical === 'bottom') out.v = al.vertical;
        else if (al.vertical === 'middle') out.v = 'middle';
        if (al.wrapText) out.wrap = true;
      }
      const b = s?.border;
      if (b) {
        const top = edgeOf(b.top);
        const right = edgeOf(b.right);
        const bottom = edgeOf(b.bottom);
        const left = edgeOf(b.left);
        if (top) out.top = top;
        if (right) out.right = right;
        if (bottom) out.bottom = bottom;
        if (left) out.left = left;
      }
      // A merge's right and bottom edges come from its last cells.
      if (span) {
        const lastRow = Math.min(span.r2, rows);
        const lastCol = Math.min(span.c2, cols);
        const rb = (ws.getCell(span.r1, lastCol).style as Partial<ExcelJS.Style> | undefined)
          ?.border?.right;
        const bb = (ws.getCell(lastRow, span.c1).style as Partial<ExcelJS.Style> | undefined)
          ?.border?.bottom;
        const right = edgeOf(rb);
        const bottom = edgeOf(bb);
        if (right) out.right = right;
        if (bottom) out.bottom = bottom;
      }
      const plain =
        !out.text &&
        !out.rs &&
        !out.fill &&
        !out.top &&
        !out.right &&
        !out.bottom &&
        !out.left &&
        !out.formula;
      if (!plain) cells.push(out);
    }
  }
  // Merge masters beyond the used rows still span (an empty boxed area).
  for (const [key, g] of spans) {
    if (g.r1 <= Math.min(rows, usedRows)) continue;
    const [r, c] = key.split(':').map(Number) as [number, number];
    cells.push({
      r,
      c,
      text: '',
      rs: Math.min(g.r2, rows) - g.r1 + 1,
      cs: Math.min(g.c2, cols) - g.c1 + 1,
    });
  }

  const pictures: PreviewRange[] = [];
  for (const media of m.media) {
    if (media.type !== 'image') continue;
    const tl = media.range.tl;
    const br = media.range.br;
    const r1 = Math.floor(tl.nativeRow) + 1;
    const c1 = Math.floor(tl.nativeCol) + 1;
    let r2 = br ? Math.max(r1, br.nativeRow + (br.nativeRowOff > 0 ? 1 : 0)) : r1;
    let c2 = br ? Math.max(c1, br.nativeCol + (br.nativeColOff > 0 ? 1 : 0)) : c1;
    if (!br && media.range.ext) {
      // Walk the cells the picture's size covers.
      let w = media.range.ext.width;
      while (c2 <= cols && w > (colPx[c2 - 1] ?? 64)) w -= colPx[c2++ - 1] ?? 64;
      let h = media.range.ext.height;
      while (r2 <= rows && h > (rowPx[r2 - 1] ?? 20)) h -= rowPx[r2++ - 1] ?? 20;
    }
    if (r1 <= rows && c1 <= cols)
      pictures.push({ r1, c1, r2: Math.min(r2, rows), c2: Math.min(c2, cols) });
  }

  let lastPreDrawn: number | null = null;
  const p = req.probe;
  if (p && p.startRow >= 1) {
    const columns = p.columns.length ? p.columns : boxedColumns(ws, p.startRow, cols);
    lastPreDrawn = columns.length
      ? lastPreDrawnOf(ws, p.startRow, columns, p.lastPreDrawn)
      : (p.lastPreDrawn ?? p.startRow);
  }

  const shown = merges
    .filter((g) => g.r1 <= rows && g.c1 <= cols)
    .map((g) => ({ ...g, r2: Math.min(g.r2, rows), c2: Math.min(g.c2, cols) }));
  return {
    sheet: ws.name,
    rows,
    cols,
    usedRows,
    usedCols,
    colPx,
    rowPx,
    cells,
    merges: shown,
    pictures,
    lastPreDrawn,
  };
}
