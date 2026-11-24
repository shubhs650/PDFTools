// Checking a CRS template at import and while it is set up (M13-07, D-71,
// ADR-034 Amendment 1): the file's kind, whether ExcelJS can load it, its
// sheets, the parts a load and write would lose, Excel tables on the chosen
// sheet, and the last pre-drawn row for a start row and columns (C3). Names
// and counts only go back to the page; nothing is logged (rule 10).
import type ExcelJS from 'exceljs';
import { loadTemplate, lastPreDrawnOf, TemplateError } from './fill';
import { lostParts, workbookKind, type LostPart, type WorkbookFileKind } from './kind';
import { model } from './sheetModel';

export interface TemplateSheetInfo {
  name: string;
  /** "visible", "hidden" or "veryHidden". */
  state: string;
  /** Last used row and column. */
  rows: number;
  cols: number;
  /** Excel tables (list objects) on the sheet: the export grows or moves them. */
  tables: number;
}

export interface TemplateProbe {
  sheet: string;
  startRow: number;
  columns: number[];
  lastPreDrawn: number | null;
}

export type TemplateInspection =
  | {
      ok: true;
      kind: 'xlsx' | 'xltx';
      sheets: TemplateSheetInfo[];
      lost: LostPart[];
      /** With a probe: the last pre-drawn row (C3), or null when the sheet is missing. */
      lastPreDrawn: number | null;
    }
  | { ok: false; kind: WorkbookFileKind | 'unreadable' };

export async function inspectTemplate(
  lib: typeof ExcelJS,
  bytes: ArrayBuffer,
  probe: TemplateProbe | null,
): Promise<TemplateInspection> {
  const kind = workbookKind(new Uint8Array(bytes));
  if (kind !== 'xlsx' && kind !== 'xltx') return { ok: false, kind };
  let wb: ExcelJS.Workbook;
  try {
    wb = await loadTemplate(lib, bytes);
  } catch (err) {
    if (err instanceof TemplateError) return { ok: false, kind: 'unreadable' };
    throw err;
  }
  const sheets = wb.worksheets.map((ws) => ({
    name: ws.name,
    state: (ws.state as string | undefined) ?? 'visible',
    rows: ws.rowCount,
    cols: ws.columnCount,
    tables: model(ws).tables.length,
  }));
  let last: number | null = null;
  if (probe) {
    const ws = wb.getWorksheet(probe.sheet);
    if (ws) last = lastPreDrawnOf(ws, probe.startRow, probe.columns, probe.lastPreDrawn);
  }
  return { ok: true, kind, sheets, lost: lostParts(new Uint8Array(bytes)), lastPreDrawn: last };
}
