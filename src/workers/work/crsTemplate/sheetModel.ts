// CRS project templates (M13-07, D-71, ADR-034 Amendment 1 items 3 – 5): the
// worksheet model work that fills a project's own form. From spike S33.
//
// ExcelJS's own `spliceRows` / `insertRows` / `duplicateRow` move cell values
// and styles but not merges (it re-merges cells without updating the sheet's
// merge list), data validations, conditional formatting, pictures, print
// areas, tables, other sheets' formulas or the moved formulas themselves. So
// rows are inserted on the worksheet's plain MODEL instead (`ws.model` → edit
// → `ws.model = …`), in one pass whatever the number of rows: every
// row-bearing part is rewritten by the same rule (a1.ts `shiftRows`). Sheet
// copies use the same model. Runs in the Work worker only (rule 1).
import type ExcelJS from 'exceljs';
import {
  cellName,
  parseCell,
  renameSheetRefs,
  shiftRows,
  shiftSqref,
  slideRows,
  type Shift,
} from '../../../model/crs/a1';

// The parts of ExcelJS's worksheet model the engine touches (its .d.ts has none).
interface Edge {
  style?: string;
  color?: unknown;
}
interface Borders {
  left?: Edge | undefined;
  right?: Edge | undefined;
  top?: Edge | undefined;
  bottom?: Edge | undefined;
  [k: string]: unknown;
}
export interface CellStyle {
  border?: Borders;
  fill?: { fgColor?: unknown; pattern?: string; [k: string]: unknown };
  [k: string]: unknown;
}
export interface CellModel {
  address: string;
  type: number;
  value?: unknown;
  formula?: string;
  sharedFormula?: string;
  shareType?: string;
  ref?: string;
  result?: unknown;
  master?: string;
  style?: CellStyle;
  [k: string]: unknown;
}
export interface RowModel {
  number: number;
  cells: CellModel[];
  height?: number;
  min?: number;
  max?: number;
  style?: CellStyle;
  [k: string]: unknown;
}
interface Anchor {
  nativeCol: number;
  nativeColOff: number;
  nativeRow: number;
  nativeRowOff: number;
}
export interface Medium {
  type: string;
  imageId: number;
  range: { tl: Anchor; br?: Anchor; ext?: { width: number; height: number }; editAs?: string };
}
/** An Excel table (list object) on the sheet. */
interface TableModel {
  name: string;
  tableRef: string;
  autoFilterRef?: string;
  [k: string]: unknown;
}
interface CfModel {
  ref: string;
  rules: { formulae?: string[]; [k: string]: unknown }[];
}
export interface SheetModel {
  id: number;
  name: string;
  rows: RowModel[];
  merges: string[];
  mergeCells?: string[];
  dataValidations: Record<string, { formulae?: unknown[]; [k: string]: unknown }>;
  conditionalFormattings: CfModel[];
  media: Medium[];
  pageSetup: { printArea?: string; printTitlesRow?: string; [k: string]: unknown };
  rowBreaks?: { id: number; [k: string]: unknown }[];
  autoFilter?: unknown;
  tables: TableModel[];
  views: unknown[];
  state?: string;
  [k: string]: unknown;
}

export const model = (ws: ExcelJS.Worksheet) => ws.model as unknown as SheetModel;
const setModel = (ws: ExcelJS.Worksheet, m: SheetModel) => {
  // Merged cells come back from the getter as "merge" cells naming their
  // master; the setter re-merges from the list and refuses cells that are
  // already merged, so they go in as empty styled cells.
  for (const r of m.rows) {
    for (const c of r.cells) {
      if (c.type === 1 || c.master) {
        c.type = 0;
        delete c.master;
      }
    }
  }
  // The setter adds merges to the ones the sheet already has (and refuses
  // overlaps), so the old list goes first.
  (ws as unknown as { _merges: Record<string, unknown> })._merges = {};
  // The getter calls the list `merges`, the setter reads `mergeCells`.
  (ws as unknown as { model: SheetModel }).model = { ...m, mergeCells: m.merges };
  // Not restored by the setter.
  if (m.rowBreaks) (ws as unknown as { rowBreaks: unknown }).rowBreaks = m.rowBreaks;
  if (m.state) ws.state = m.state as ExcelJS.WorksheetState;
};

const clone = <T>(v: T): T => structuredClone(v);

/** "C4" → "C9" for a row move of +5 (absolute and relative alike). */
const moveAddr = (addr: string, d: number) => {
  const { col, row } = parseCell(addr);
  return cellName(col, row + d);
};

// ---------------------------------------------------------------------------
// Shared formulas: a child cell only names its master ("K10"); moving rows
// apart would break the link, so the sheet's shared formulas are turned into
// plain ones first (the text a fill down would give, a1.ts `slideRows`).

export function unshareFormulas(m: SheetModel): number {
  const masters = new Map<string, CellModel>();
  for (const r of m.rows)
    for (const c of r.cells) if (c.shareType === 'shared') masters.set(c.address, c);
  let n = 0;
  for (const r of m.rows) {
    for (const c of r.cells) {
      if (c.sharedFormula) {
        const master = masters.get(c.sharedFormula);
        if (master?.formula) {
          c.formula = slideRows(
            master.formula,
            parseCell(c.address).row - parseCell(master.address).row,
          );
          delete c.sharedFormula;
          n++;
        }
      }
    }
  }
  for (const c of masters.values()) {
    delete c.shareType;
    delete c.ref;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Pre-drawn rows (C3): empty rows from the start row down that carry the
// start row's side borders and fill in every table column. The last such row
// may close the table with a different bottom edge; that edge moves to the
// new last row when rows are inserted.

const sideKey = (style: CellStyle | undefined) => {
  const b: Borders = style?.border ?? {};
  const f = style?.fill;
  return JSON.stringify([b.left?.style, b.right?.style, f?.pattern ?? 'none', f?.fgColor ?? null]);
};
const hasValue = (c: CellModel) =>
  c.type !== 0 && c.type !== 1 && c.formula === undefined && c.sharedFormula === undefined;

export function detectPreDrawn(
  ws: ExcelJS.Worksheet,
  startRow: number,
  cols: number[],
  formulaCols: ReadonlySet<number> = new Set(),
): number {
  const rows = new Map(model(ws).rows.map((r) => [r.number, r]));
  const cellOf = (r: number, c: number) =>
    rows.get(r)?.cells.find((x) => parseCell(x.address).col === c);
  const want = cols.map((c) => sideKey(cellOf(startRow, c)?.style));
  if (want.every((k) => k === sideKey(undefined))) return startRow; // no borders: just the start row
  let last = startRow;
  for (let r = startRow + 1; r <= startRow + 5000; r++) {
    // Same side borders and fill in every table column, and no typed value
    // (formulas, such as a "Days open" column, are allowed).
    const same = cols.every((c, i) => sideKey(cellOf(r, c)?.style) === want[i]);
    const empty = cols.every((c) => {
      const cell = cellOf(r, c);
      return !cell || formulaCols.has(c) || !hasValue(cell);
    });
    if (!same || !empty) break;
    last = r;
  }
  return last;
}

// ---------------------------------------------------------------------------
// Row insert on the model.

export interface InsertReport {
  movedRows: number;
  merges: number;
  validations: number;
  conditional: number;
  pictures: number;
  unshared: number;
  tables: number;
}

/**
 * Inserts `n` rows after `last` (the table's last pre-drawn row, or the start
 * row) on `ws`, each a copy of `styleRow`: styles, height, merges inside the
 * row, formulas slid to the new row, drop-downs. Everything below moves down;
 * ranges reaching `last` grow (print area, conditional formatting, totals
 * such as COUNTA(E10:E24), names). Other sheets' formulas and the workbook's
 * names that point at `ws` are moved the same way.
 */
export function insertRows(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  last: number,
  n: number,
  styleRow: number,
): InsertReport {
  const m = clone(model(ws));
  const rep: InsertReport = {
    movedRows: 0,
    merges: 0,
    validations: 0,
    conditional: 0,
    pictures: 0,
    unshared: unshareFormulas(m),
    tables: m.tables.length,
  };
  if (n <= 0) return rep;
  const s: Shift = { sheet: ws.name, home: ws.name, after: last, n };
  const fx = (f: string) => shiftRows(f, s);

  // Rows and their cells.
  const template = m.rows.find((r) => r.number === styleRow);
  const lastRow = m.rows.find((r) => r.number === last);
  const rows: RowModel[] = [];
  for (const r of m.rows) {
    const moving = r.number > last;
    if (moving) rep.movedRows++;
    const d = moving ? n : 0;
    for (const c of r.cells) {
      if (d) c.address = moveAddr(c.address, d);
      if (c.master && parseCell(c.master).row > last) c.master = moveAddr(c.master, n);
      if (c.formula) c.formula = fx(c.formula);
      if (c.ref && c.shareType === 'array') c.ref = shiftSqref(c.ref, s);
    }
    r.number += d;
    rows.push(r);
    if (r.number === last && template) {
      for (let k = 1; k <= n; k++) rows.push(copyRow(template, last + k, last + k - styleRow));
    }
  }
  if (!template) {
    // An empty start row with no model: plain new rows.
    for (let k = 1; k <= n; k++) rows.push({ number: last + k, cells: [] });
  }
  rows.sort((a, b) => a.number - b.number);
  m.rows = rows;

  // The closing bottom edge of the last pre-drawn row moves to the new last row.
  if (template && lastRow && last !== styleRow) {
    const newLast = rows.find((r) => r.number === last + n);
    for (const c of lastRow.cells) {
      const col = parseCell(c.address).col;
      const t = template.cells.find((x) => parseCell(x.address).col === col);
      const edge = c.style?.border?.bottom;
      const tEdge = t?.style?.border?.bottom;
      if (JSON.stringify(edge) === JSON.stringify(tEdge)) continue;
      const nc = newLast?.cells.find((x) => parseCell(x.address).col === col);
      if (nc?.style) nc.style = { ...nc.style, border: { ...nc.style.border, bottom: edge } };
      if (c.style) c.style = { ...c.style, border: { ...c.style.border, bottom: tEdge } };
    }
  }

  // Merges: moved or grown; the template row's own merges repeated.
  const merges = m.merges.map((r) => shiftSqref(r, s));
  for (const r of m.merges) {
    const [a, b] = ends(r);
    const ra = parseCell(a).row;
    const rb = parseCell(b).row;
    if (ra === styleRow && rb === styleRow) {
      for (let k = 1; k <= n; k++) {
        const row = last + k;
        merges.push(`${moveTo(a, row)}:${moveTo(b, row)}`);
        rep.merges++;
      }
    }
  }
  m.merges = merges;

  // Data validations (ExcelJS keeps one entry per cell).
  const dv: SheetModel['dataValidations'] = {};
  for (const [addr, rule] of Object.entries(m.dataValidations)) {
    const r = {
      ...rule,
      ...(rule.formulae
        ? { formulae: rule.formulae.map((f) => (typeof f === 'string' ? fx(f) : f)) }
        : {}),
    };
    const { row } = parseCell(addr);
    dv[row > last ? moveAddr(addr, n) : addr] = r;
    if (row === styleRow) {
      for (let k = 1; k <= n; k++) {
        dv[moveTo(addr, last + k)] = clone(r);
        rep.validations++;
      }
    }
  }
  m.dataValidations = dv;

  // Conditional formatting: ranges grow or move; rule formulas move with them.
  for (const cf of m.conditionalFormattings) {
    const before = cf.ref;
    cf.ref = shiftSqref(cf.ref, s);
    if (cf.ref !== before) rep.conditional++;
    for (const rule of cf.rules) if (rule.formulae) rule.formulae = rule.formulae.map(fx);
  }

  // Pictures (0-based anchors).
  for (const p of m.media) {
    for (const a of [p.range.tl, p.range.br]) {
      if (a && a.nativeRow >= last) {
        a.nativeRow += n;
        rep.pictures++;
      }
    }
  }

  // Print area, print titles, page breaks, filter.
  if (m.pageSetup.printArea) {
    m.pageSetup.printArea = m.pageSetup.printArea
      .split('&&')
      .map((a) => shiftSqref(a, s))
      .join('&&');
  }
  if (m.rowBreaks) for (const b of m.rowBreaks) if (b.id > last) b.id += n;
  if (typeof m.autoFilter === 'string') m.autoFilter = shiftSqref(m.autoFilter, s);
  // Excel tables (list objects) on this sheet: a table holding the comment
  // rows grows with them, one below moves down (ADR-034 Amendment 1 item 8).
  for (const t of m.tables) {
    t.tableRef = shiftSqref(t.tableRef, s);
    if (t.autoFilterRef) t.autoFilterRef = shiftSqref(t.autoFilterRef, s);
  }

  setModel(ws, m);

  // Other sheets' formulas, validations and formatting pointing here; names.
  for (const other of wb.worksheets) {
    if (other === ws) continue;
    let changed = false;
    const om = clone(model(other));
    const ox = (f: string) => shiftRows(f, { ...s, home: other.name });
    for (const r of om.rows) {
      for (const c of r.cells) {
        if (c.formula) {
          const f = ox(c.formula);
          if (f !== c.formula) {
            c.formula = f;
            changed = true;
          }
        }
      }
    }
    if (changed) setModel(other, om);
  }
  const names = wb.definedNames as unknown as { model: { name: string; ranges: string[] }[] };
  names.model = names.model.map((d) => ({
    ...d,
    ranges: d.ranges.map((r) => shiftRows(r, { ...s, home: null })),
  }));
  return rep;
}

/** "A1:B2" → ["A1", "B2"]; "C4" → ["C4", "C4"]. */
export const ends = (range: string): [string, string] => {
  const [a = range, b = a] = range.split(':');
  return [a, b];
};

const moveTo = (addr: string, row: number) => cellName(parseCell(addr).col, row);

function copyRow(t: RowModel, row: number, d: number): RowModel {
  const r = clone(t);
  r.number = row;
  r.cells = r.cells.map((c) => {
    const out: CellModel = { address: moveTo(c.address, row), type: 0 };
    if (c.style) out.style = c.style;
    if (c.master) out.master = moveTo(c.master, row);
    if (c.master) out.type = 1;
    const f = c.formula;
    if (f) {
      out.formula = slideRows(f, d);
      out.type = 6;
    }
    return out;
  });
  return r;
}

// ---------------------------------------------------------------------------
// Sheet copies (C5, C15) and renaming.

/** Renames a sheet and every reference to it (formulas anywhere, names). */
export function renameSheet(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, to: string): void {
  const from = ws.name;
  ws.name = to;
  for (const sh of wb.worksheets) {
    const m = clone(model(sh));
    let changed = false;
    for (const r of m.rows) {
      for (const c of r.cells) {
        if (c.formula) {
          const f = renameSheetRefs(c.formula, from, to);
          if (f !== c.formula) {
            c.formula = f;
            changed = true;
          }
        }
      }
    }
    for (const rule of Object.values(m.dataValidations)) {
      if (rule.formulae) {
        const f = rule.formulae.map((x) =>
          typeof x === 'string' ? renameSheetRefs(x, from, to) : x,
        );
        if (JSON.stringify(f) !== JSON.stringify(rule.formulae)) {
          rule.formulae = f;
          changed = true;
        }
      }
    }
    if (changed) setModel(sh, m);
  }
  const names = wb.definedNames as unknown as { model: { name: string; ranges: string[] }[] };
  names.model = names.model.map((d) => ({
    ...d,
    ranges: d.ranges.map((r) => renameSheetRefs(r, from, to)),
  }));
}

/**
 * A copy of `src` as a new sheet right after `after` (default: after src).
 * Everything on the sheet model comes along: cells, styles, merges, column
 * widths, row heights, drop-downs, conditional formatting, pictures (they
 * share the workbook's image), print area and titles, page setup, frozen
 * panes, header and footer. References to the sheet itself in its own
 * formulas point at the copy. `pristine` is a model taken before filling.
 */
export function copySheet(
  wb: ExcelJS.Workbook,
  src: ExcelJS.Worksheet,
  name: string,
  pristine: SheetModel = model(src),
  after: ExcelJS.Worksheet = src,
): ExcelJS.Worksheet {
  const dst = wb.addWorksheet(name);
  const m = clone(pristine);
  m.id = dst.id;
  m.name = name;
  for (const r of m.rows) {
    for (const c of r.cells) {
      if (c.formula) c.formula = renameSheetRefs(c.formula, pristine.name, name);
    }
  }
  setModel(dst, m);
  // Sheet order: right after `after`.
  const order = wb.worksheets;
  const at = order.indexOf(after);
  order.splice(order.indexOf(dst), 1);
  order.splice(at + 1, 0, dst);
  order.forEach((w, i) => ((w as unknown as { orderNo: number }).orderNo = i + 1));
  return dst;
}

// ---------------------------------------------------------------------------
// Drop-down ranges. ExcelJS keeps one validation per cell and squeezes them
// back into ranges when writing, but it sorts the cells as TEXT ("E10" before
// "E7"), so a range that crosses row 9→10 or 99→100 is written twice,
// overlapping (E10:E18 and E7:E18) — even for a template saved back
// untouched. Before writing, the engine hands ExcelJS ready ranges instead
// (column runs of equal rules, in row order); ranges pass through as they are.

export function compactValidations(ws: ExcelJS.Worksheet): number {
  const dv = (ws as unknown as { dataValidations: { model: SheetModel['dataValidations'] } })
    .dataValidations;
  const byCol = new Map<
    number,
    { row: number; key: string; rule: SheetModel['dataValidations'][string] }[]
  >();
  const out: SheetModel['dataValidations'] = {};
  for (const [addr, rule] of Object.entries(dv.model)) {
    if (addr.includes(':')) {
      out[addr] = rule;
      continue;
    }
    const { col, row } = parseCell(addr);
    const list = byCol.get(col) ?? [];
    list.push({ row, key: JSON.stringify(rule), rule });
    byCol.set(col, list);
  }
  let ranges = 0;
  for (const [col, list] of byCol) {
    list.sort((a, b) => a.row - b.row);
    for (let i = 0; i < list.length;) {
      let j = i;
      while (
        list[j + 1] &&
        list[j + 1]?.row === (list[j]?.row ?? 0) + 1 &&
        list[j + 1]?.key === list[i]?.key
      )
        j++;
      const a = list[i];
      const b = list[j];
      if (a && b) {
        out[
          a.row === b.row ? cellName(col, a.row) : `${cellName(col, a.row)}:${cellName(col, b.row)}`
        ] = a.rule;
        ranges++;
      }
      i = j + 1;
    }
  }
  dv.model = out;
  return ranges;
}

/**
 * ExcelJS leaves out of the file, and out of the sheet model, any column whose
 * width is exactly 9 (its own default), so such a column falls back to the
 * sheet's default width (8.43 in Excel). A width a hair over 9 is kept and
 * looks the same. Run straight after loading.
 */
export function keepWidth9(ws: ExcelJS.Worksheet): number {
  let n = 0;
  const count = ws.columnCount;
  for (let c = 1; c <= count; c++) {
    const col = ws.getColumn(c);
    if (col.width === 9) {
      col.width = 9.0001;
      n++;
    }
  }
  return n;
}

/** Formula cells lose their saved results, so readers work them out again. */
export function dropFormulaResults(ws: ExcelJS.Worksheet): number {
  const m = clone(model(ws));
  let n = 0;
  for (const r of m.rows) {
    for (const c of r.cells) {
      if ((c.formula !== undefined || c.sharedFormula !== undefined) && 'result' in c) {
        delete c.result;
        n++;
      }
    }
  }
  if (n) setModel(ws, m);
  return n;
}

export const takeModel = (ws: ExcelJS.Worksheet): SheetModel => clone(model(ws));
