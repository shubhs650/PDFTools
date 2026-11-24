// CRS export into a project's own Excel template (M13-07, D-71, plan M13 §6,
// ADR-034 Amendment 1): the template is loaded, the chosen sheet is copied
// once per group (a document, C15; a commented page, C5) from a model taken
// before any filling, and each copy is filled: pre-drawn rows first, then
// inserted rows that copy the start row (C2, C3, C11), detail cells, snapshot
// pictures fitted to their column (C9). The first group fills the template
// sheet itself, renamed; the others follow it in order. ExcelJS is passed in
// (lazy in the Work worker; the Node package in tests). Progress counts rows;
// Cancel acts between rows and before the zip is written (rule 2).
import type ExcelJS from 'exceljs';
import { cellOf, parseCell } from '../../../model/crs/a1';
import { sheetName } from '../../../model/crs/sheetName';
import { workbookKind } from './kind';
import {
  compactValidations,
  copySheet,
  detectPreDrawn,
  dropFormulaResults,
  ends,
  insertRows,
  keepWidth9,
  model,
  renameSheet,
  takeModel,
} from './sheetModel';

/** A cell's value: text, a number, a date (an Excel date), or empty. */
export type TemplateCell = string | number | Date | null;

export interface TemplateSnapshot {
  png: ArrayBuffer;
  /** Image size in pixels. */
  width: number;
  height: number;
}

export interface TemplateSheetSpec {
  /** The copy's name before Excel's rules are applied; null keeps the template sheet's name. */
  name: string | null;
  /** Detail cells (A1 on the sheet) and their values. */
  details: { cell: string; value: TemplateCell }[];
  /** One entry per comment, values in `columns` order (the Snapshot column's value is ignored). */
  rows: TemplateCell[][];
}

export interface TemplateFillSpec {
  sheet: string;
  startRow: number;
  /** C3 override; null = detected from the start row's borders. */
  lastPreDrawn: number | null;
  /** The written columns (1-based), in the order of each row's values. */
  columns: number[];
  /** Index in `columns` of the Snapshot field, or -1. */
  snapshotIndex: number;
  /** C9: the picture's height limit in pixels. */
  snapshotMaxPx: number;
  sheets: TemplateSheetSpec[];
}

export interface TemplateFillResult {
  bytes: ArrayBuffer;
  /** The names the filled sheets got. */
  names: string[];
  /** The last pre-drawn row found on the template sheet. */
  lastPreDrawn: number;
}

/** Why a template cannot be used; the message is ours (rule 10: never the workbook's content). */
export class TemplateError extends Error {
  readonly reason: 'refused' | 'unreadable' | 'no-sheet';

  constructor(reason: 'refused' | 'unreadable' | 'no-sheet') {
    super(`crs-template-${reason}`);
    this.name = 'TemplateError';
    this.reason = reason;
  }
}

/** Excel's limit for the text of one cell. */
const MAX_CELL_TEXT = 32767;
/** Picture margin inside its cell (px). */
const PAD = 4;
/** EMU per pixel at 96 dpi. */
const EMU = 9525;

/** Loads a template, refusing what the import refuses (Amendment 1 item 1), with the write fixes applied. */
export async function loadTemplate(
  lib: typeof ExcelJS,
  bytes: ArrayBuffer,
): Promise<ExcelJS.Workbook> {
  const kind = workbookKind(new Uint8Array(bytes));
  if (kind !== 'xlsx' && kind !== 'xltx') throw new TemplateError('refused');
  const wb = new lib.Workbook();
  try {
    await wb.xlsx.load(bytes.slice(0));
  } catch {
    throw new TemplateError('unreadable');
  }
  // First thing after loading: the sheet model leaves out a width of exactly 9.
  for (const ws of wb.worksheets) keepWidth9(ws);
  return wb;
}

/** Writes the workbook with the remaining write fixes (Amendment 1 item 5). */
export async function writeTemplate(wb: ExcelJS.Workbook): Promise<ArrayBuffer> {
  for (const ws of wb.worksheets) compactValidations(ws);
  for (const ws of wb.worksheets) dropFormulaResults(ws);
  wb.calcProperties.fullCalcOnLoad = true;
  // A Buffer view in ExcelJS's browser build: copy out a plain, transferable ArrayBuffer.
  const out: ArrayBufferLike | Uint8Array = await wb.xlsx.writeBuffer();
  return (out instanceof Uint8Array ? out : new Uint8Array(out)).slice().buffer;
}

/** Excel column width (characters of the default font) → pixels at 96 dpi (Calibri 11: 7 px digit). */
export const widthPx = (chars: number, digit = 7): number =>
  Math.trunc(((256 * chars + Math.trunc(128 / digit)) / 256) * digit);

/** The Snapshot cell's width in pixels; a merged cell counts all its columns. */
export function snapshotWidthPx(ws: ExcelJS.Worksheet, row: number, col: number): number {
  const merge = model(ws).merges.find((r) => {
    const [a, b] = ends(r);
    const p = parseCell(a);
    const q = parseCell(b);
    return p.row <= row && row <= q.row && p.col <= col && col <= q.col;
  });
  const [a, b] = merge ? ends(merge) : [null, null];
  const c1 = a ? parseCell(a).col : col;
  const c2 = b ? parseCell(b).col : col;
  let px = 0;
  // ExcelJS types the width as always there; a column without one has none.
  for (let c = c1; c <= c2; c++) px += widthPx(ws.getColumn(c).width ?? 8.43);
  return px;
}

/** The size a snapshot is shown at in a cell `colPx` wide (C9), before rendering. */
export function fitSnapshot(
  width: number,
  height: number,
  colPx: number,
  maxPx: number,
): { width: number; height: number } {
  let w = Math.max(16, colPx - 2 * PAD);
  let h = (height / Math.max(1, width)) * w;
  if (h > maxPx) {
    h = maxPx;
    w = (width / Math.max(1, height)) * h;
  }
  return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) };
}

/**
 * A date as Excel shows it: the local day, without the time of day (a CRS
 * dates comments by day; a hidden time would make a template's "days open"
 * formula fractional). ExcelJS turns a Date into a serial from its UTC time,
 * so the local day is given as midnight UTC (a comment made at 01:00 on the
 * 24th stays on the 24th).
 */
const excelDate = (d: Date): Date => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));

/** Writes a value, keeping the template's own number format; dates get one when the cell has none. */
function setCell(cell: ExcelJS.Cell, v: TemplateCell): void {
  if (v === null || v === '') {
    cell.value = null;
    return;
  }
  if (v instanceof Date) {
    cell.value = excelDate(v);
    const fmt = (cell.numFmt as string | undefined) ?? '';
    if (fmt === '' || fmt === 'General') cell.numFmt = 'yyyy-mm-dd';
    return;
  }
  if (typeof v === 'string') {
    cell.value = v.length > MAX_CELL_TEXT ? `${v.slice(0, MAX_CELL_TEXT - 1)}…` : v;
    return;
  }
  cell.value = v;
}

/**
 * A row whose wrapped text needs more lines than its height gets an explicit
 * height. Without one, LibreOffice grows the row on opening but places the
 * pictures below by the stored heights, so they drift up a row's worth.
 * Lines are estimated from the column's width in characters (about 1.1
 * characters of text per width unit for the default font).
 */
function fitTextHeight(ws: ExcelJS.Worksheet, r: number): void {
  const row = ws.getRow(r);
  let lines = 1;
  let size = 11;
  row.eachCell((cell, c) => {
    // ExcelJS types these as always there; a cell without a style has neither.
    const align = cell.alignment as Partial<ExcelJS.Alignment> | undefined;
    const font = cell.font as Partial<ExcelJS.Font> | undefined;
    if (typeof cell.value !== 'string' || !align?.wrapText) return;
    const per = Math.max(1, Math.floor((ws.getColumn(c).width ?? 9) * 1.1));
    const n = cell.value
      .split('\n')
      .reduce((a, p) => a + Math.max(1, Math.ceil(p.length / per)), 0);
    lines = Math.max(lines, n);
    size = Math.max(size, font?.size ?? 11);
  });
  // Excel's row height limit is 409 points.
  const need = Math.min(409, Math.ceil(lines * size * 1.36));
  const height = row.height as number | undefined;
  if ((height ?? 15) < need) row.height = need;
  else if (height === undefined) row.height = 15;
}

/** C9: a picture fitted to its cell, anchored to it ("move with cells"); the row grows. */
function placeSnapshot(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  r: number,
  c: number,
  s: TemplateSnapshot,
  colPx: number,
  maxPx: number,
): void {
  const fit = fitSnapshot(s.width, s.height, colPx, maxPx);
  const id = wb.addImage({ buffer: s.png, extension: 'png' });
  // ExcelJS's fractional col/row positions assume its own column units, so the
  // native anchor (EMU offsets) is given.
  ws.addImage(id, {
    tl: {
      nativeCol: c - 1,
      nativeColOff: PAD * EMU,
      nativeRow: r - 1,
      nativeRowOff: PAD * EMU,
    } as unknown as ExcelJS.Anchor,
    ext: { width: fit.width, height: fit.height },
    editAs: 'oneCell',
  });
  const row = ws.getRow(r);
  const needPt = Math.min(409, Math.ceil((fit.height + 2 * PAD) * 0.75));
  if (((row.height as number | undefined) ?? 15) < needPt) row.height = needPt;
}

/** The template sheet's last pre-drawn row for these columns (C3). */
export function lastPreDrawnOf(
  ws: ExcelJS.Worksheet,
  startRow: number,
  columns: readonly number[],
  override: number | null,
): number {
  if (override !== null) return Math.max(startRow, override);
  const formulaCols = new Set<number>();
  for (const c of columns) if (ws.getCell(startRow, c).formula) formulaCols.add(c);
  return detectPreDrawn(ws, startRow, [...columns], formulaCols);
}

/**
 * Fills the template. `snapshot(sheet, row, widthPx, maxPx)` renders a row's
 * picture at the size it will be shown (null: none); `checkpoint` throws once
 * cancelled; `progress` gets the rows written so far.
 */
export async function fillTemplate(
  lib: typeof ExcelJS,
  template: ArrayBuffer,
  spec: TemplateFillSpec,
  snapshot:
    | ((
        sheet: number,
        row: number,
        widthPx: number,
        maxPx: number,
      ) => Promise<TemplateSnapshot | null>)
    | null,
  checkpoint: () => Promise<void>,
  progress: (done: number) => void,
): Promise<TemplateFillResult> {
  const wb = await loadTemplate(lib, template);
  const first = wb.getWorksheet(spec.sheet);
  if (!first) throw new TemplateError('no-sheet');
  await checkpoint();
  const last = lastPreDrawnOf(first, spec.startRow, spec.columns, spec.lastPreDrawn);
  const pristine = takeModel(first);
  const taken = new Set(wb.worksheets.filter((w) => w !== first).map((w) => w.name.toLowerCase()));
  const names: string[] = [];
  const snapCol = spec.snapshotIndex >= 0 ? spec.columns[spec.snapshotIndex] : undefined;
  const colPx = snapCol !== undefined ? snapshotWidthPx(first, spec.startRow, snapCol) : 0;
  let prev = first;
  let done = 0;
  for (const [g, sheet] of spec.sheets.entries()) {
    await checkpoint();
    let ws: ExcelJS.Worksheet;
    if (g === 0) {
      ws = first;
      if (sheet.name !== null) {
        const name = sheetName(sheet.name, taken);
        if (name !== first.name) renameSheet(wb, first, name);
      }
    } else {
      ws = copySheet(wb, first, sheetName(sheet.name ?? first.name, taken), pristine, prev);
    }
    taken.add(ws.name.toLowerCase());
    names.push(ws.name);
    prev = ws;

    // C2: pre-drawn rows first, then inserted rows that copy the start row.
    const room = last - spec.startRow + 1;
    insertRows(wb, ws, last, Math.max(0, sheet.rows.length - room), spec.startRow);

    for (const d of sheet.details) {
      if (cellOf(d.cell)) setCell(ws.getCell(d.cell.replace(/\$/gu, '')), d.value);
    }
    for (const [i, values] of sheet.rows.entries()) {
      if (i % 50 === 0) await checkpoint();
      const r = spec.startRow + i;
      const row = ws.getRow(r);
      spec.columns.forEach((c, k) => {
        if (k === spec.snapshotIndex) return;
        setCell(row.getCell(c), values[k] ?? null);
      });
      fitTextHeight(ws, r);
      if (snapshot && snapCol !== undefined) {
        const s = await snapshot(g, i, colPx, spec.snapshotMaxPx);
        if (s) placeSnapshot(wb, ws, r, snapCol, s, colPx, spec.snapshotMaxPx);
      }
      done++;
      progress(done);
    }
  }
  await checkpoint();
  return { bytes: await writeTemplate(wb), names, lastPreDrawn: last };
}
