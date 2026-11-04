// Table output (M4-13, §7.7, ADR-015): one workbook with a sheet per table
// (named p<page>-t<k>, merged cells kept, header rows bold, numbers as
// numbers with their decimals), or one CSV per table (UTF-8 BOM, CRLF,
// RFC 4180, the CRS writer's formula guard — numbers pass unchanged).
// ExcelJS is passed in (lazy in the Work worker, the Node package in tests).
import type ExcelJS from 'exceljs';
import type { TableData } from '../../../model/tableGrid';
import { APP_NAME } from '../../../i18n/appName';

export interface NamedTable<T extends { page: number } = TableData> {
  /** Sheet / file name stem, e.g. "p3-t1". */
  name: string;
  data: T;
}

/** "p<page>-t<k>" per table, k counting tables on each page from 1. */
export function nameTables<T extends { page: number }>(tables: readonly T[]): NamedTable<T>[] {
  const perPage = new Map<number, number>();
  return tables.map((data) => {
    const k = (perPage.get(data.page) ?? 0) + 1;
    perPage.set(data.page, k);
    return { name: `p${String(data.page + 1)}-t${String(k)}`, data };
  });
}

const NUMBER = /^[-+]?\d+(?:\.\d+)?$/u;

/** A decimal string as a number and its display format ("0.840" → 0.84, "0.000"). */
export function numeric(v: string): { value: number; fmt: string } | null {
  const s = v.trim();
  if (!NUMBER.test(s)) return null;
  // Leading zeros on whole numbers (part numbers, "007") stay text.
  if (/^[-+]?0\d/u.test(s)) return null;
  const decimals = s.split('.')[1]?.length ?? 0;
  return { value: Number(s), fmt: decimals ? `0.${'0'.repeat(decimals)}` : '0' };
}

const RISKY = /^[=+\-@\t\r]/u;
const BOM = String.fromCharCode(0xfeff);

/** A CSV field: formula guard (numbers excepted), RFC 4180 quoting. */
export function tableCsvCell(value: string): string {
  const v = RISKY.test(value) && !numeric(value) ? `'${value}` : value;
  return /[",\r\n]/u.test(v) ? `"${v.replace(/"/gu, '""')}"` : v;
}

export function tableCsv(data: TableData): Uint8Array<ArrayBuffer> {
  const text = data.cells.map((row) => row.map(tableCsvCell).join(',')).join('\r\n') + '\r\n';
  return new TextEncoder().encode(BOM + text);
}

export async function buildTablesWorkbook(
  lib: typeof ExcelJS,
  tables: readonly NamedTable[],
  checkpoint: () => Promise<void>,
): Promise<ArrayBuffer> {
  const wb = new lib.Workbook();
  wb.creator = APP_NAME;
  for (const { name, data } of tables) {
    await checkpoint();
    const ws = wb.addWorksheet(name);
    const widths: number[] = [];
    data.cells.forEach((row, r) => {
      const xr = ws.getRow(r + 1);
      row.forEach((text, c) => {
        const cell = xr.getCell(c + 1);
        const n = r >= data.headerRows ? numeric(text) : null;
        if (n) {
          cell.value = n.value;
          cell.numFmt = n.fmt;
        } else if (text) cell.value = text;
        if (text.includes('\n')) cell.alignment = { wrapText: true, vertical: 'top' };
        const longest = Math.max(0, ...text.split('\n').map((l) => l.length));
        widths[c] = Math.max(widths[c] ?? 8, Math.min(60, longest + 2));
      });
      if (r < data.headerRows) xr.font = { bold: true };
    });
    for (const m of data.merges) ws.mergeCells(m.r + 1, m.c + 1, m.r + m.rs, m.c + m.cs);
    widths.forEach((w, i) => {
      ws.getColumn(i + 1).width = w;
    });
    if (data.headerRows > 0) ws.views = [{ state: 'frozen', ySplit: data.headerRows }];
  }
  const buf = await wb.xlsx.writeBuffer();
  return buf instanceof ArrayBuffer ? buf : new Uint8Array(buf).slice().buffer;
}
