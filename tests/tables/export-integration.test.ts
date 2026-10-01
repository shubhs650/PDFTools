// M4-13 (§7.7, ADR-015): Express Extract's output over the self-made fixture,
// read back with ExcelJS — a sheet per table named p<page>-t<k>, merged header
// cells kept, header rows bold, numbers as numbers; CSV one file per table.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init } from '@embedpdf/pdfium';
import ExcelJS from 'exceljs';
import * as nodeOxide from 'pdf-oxide-wasm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tablesPdf } from '../../e2e/fixtures/tables';
import { docPtrOf } from '../../src/workers/render/pdfium';
import { extractGeometry } from '../../src/workers/work/geometry';
import type { OxideDocument } from '../../src/workers/work/oxide';
import type { JobSlice } from '../../src/workers/work/scheduler';
import { exportTables, type TableSources } from '../../src/workers/work/tables/job';
import { numeric, tableCsv, tableCsvCell } from '../../src/workers/work/tables/writers';

const require = createRequire(import.meta.url);
let src: TableSources;
let ox: OxideDocument;
const slice: JobSlice = {
  checkpoint: () => Promise.resolve(),
  signal: new AbortController().signal,
};
const noProgress = () => undefined;
const blobOf = (r: { blob?: Blob }): Blob => {
  if (!r.blob) throw new Error('no blob');
  return r.blob;
};

beforeAll(async () => {
  const mod = await init({
    wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')),
  });
  const native = new PdfiumNative(mod, { fontFallback: null });
  const bytes = tablesPdf();
  await native.openDocumentBuffer({ id: 'tx', content: bytes.slice().buffer }).toPromise();
  ox = new (
    nodeOxide as unknown as {
      WasmPdfDocument: new (d: Uint8Array, p?: string | null) => OxideDocument;
    }
  ).WasmPdfDocument(bytes, null);
  src = {
    oxide: ox,
    key: 'tx',
    segments: async (p) => (await extractGeometry(mod, docPtrOf(native, 'tx'), p, null)).segs,
  };
});

afterAll(() => {
  ox.free();
});

describe('table writers', () => {
  it('numbers keep their decimals; part numbers with leading zeros stay text', () => {
    expect(numeric('0.840')).toEqual({ value: 0.84, fmt: '0.000' });
    expect(numeric('12')).toEqual({ value: 12, fmt: '0' });
    expect(numeric('007')).toBeNull();
    expect(numeric('DN 50')).toBeNull();
  });

  it('CSV: formula guard except numbers, RFC 4180 quoting, BOM and CRLF', () => {
    expect(tableCsvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(tableCsvCell('-5')).toBe('-5');
    expect(tableCsvCell('a, "b"')).toBe('"a, ""b"""');
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(
      tableCsv({ page: 0, cells: [['a', 'b\nc']], merges: [], headerRows: 0 }),
    );
    expect(text).toBe('﻿a,"b\nc"\r\n');
  });
});

describe('exportTables on the fixture', () => {
  it('XLSX: a sheet per table, merges, bold headers, numeric values', async () => {
    const res = await exportTables(
      src,
      { pages: [0, 1, 2, 3, 4] },
      'xlsx',
      'single',
      'fixture',
      slice,
      noProgress,
    );
    expect(res.tables).toBe(5);
    expect(res.ocrPages).toEqual([3]);
    expect(res.blob).toBeDefined();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blobOf(res).arrayBuffer());
    expect(wb.worksheets.map((w) => w.name)).toEqual(['p1-t1', 'p1-t2', 'p2-t1', 'p3-t1', 'p3-t2']);
    const pipe = wb.getWorksheet('p1-t1');
    if (!pipe) throw new Error('no sheet');
    // PIPE: header rows 2, merges A1:A2, B1:C1, D1:E1, F1:F2.
    const merges = (pipe.model as { merges?: string[] }).merges ?? [];
    expect([...merges].sort()).toEqual(['A1:A2', 'B1:C1', 'D1:E1', 'F1:F2']);
    expect(pipe.getRow(1).font.bold).toBe(true);
    expect(pipe.getRow(2).font.bold).toBe(true);
    const numbers: number[] = [];
    pipe.eachRow((row, r) => {
      if (r <= 2) return;
      row.eachCell((cell) => {
        if (typeof cell.value === 'number') numbers.push(cell.value);
      });
    });
    expect(numbers.length).toBeGreaterThan(0);
  });

  it('CSV: one file per table, as a ZIP or the folder’s files; no tables → nothing', async () => {
    const zip = await exportTables(src, { pages: [0] }, 'csv', 'zip', 'f', slice, noProgress);
    expect(zip.tables).toBe(2);
    const head = new Uint8Array(await blobOf(zip).arrayBuffer()).subarray(0, 4);
    expect([...head]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const folder = await exportTables(src, { pages: [0] }, 'csv', 'folder', 'f', slice, noProgress);
    expect(folder.files?.map((f) => f.path)).toEqual(['f p1-t1.csv', 'f p1-t2.csv']);
    const one = await exportTables(src, { pages: [1] }, 'csv', 'single', 'f', slice, noProgress);
    expect(one.tables).toBe(1);
    const text = await blobOf(one).text();
    expect(text.split('\r\n').length).toBeGreaterThan(3);
    const none = await exportTables(src, { pages: [4] }, 'xlsx', 'single', 'f', slice, noProgress);
    expect(none).toEqual({ tables: 0, ocrPages: [] });
  });
});
