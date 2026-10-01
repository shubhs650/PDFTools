// M4-12 (§7.7, ADR-009 d4) on real engines: PDF Oxide (tables, words) and
// PDFium (ruling segments) over the self-made fixture (e2e/fixtures/tables.ts).
// Lattice 100 % of cells with merged headers rebuilt, stream ≥ 95 %, side-by-side
// tables found as two, the scanned page flagged for OCR, no table in prose.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import * as nodeOxide from 'pdf-oxide-wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { EXPECTED, tablesPdf, type ExpectedTable } from '../../e2e/fixtures/tables';
import { docPtrOf } from '../../src/workers/render/pdfium';
import type { OxideDocument } from '../../src/workers/work/oxide';
import { extractGeometry } from '../../src/workers/work/geometry';
import { detectPage, type PageTables } from '../../src/workers/work/tables/detect';
import { tablesOf, wordsOf } from '../../src/workers/work/tables/oxideInput';

const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
const pages: PageTables[] = [];

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
  const bytes = tablesPdf();
  const doc = await native
    .openDocumentBuffer({ id: 'tables', content: bytes.slice().buffer })
    .toPromise();
  const ox = new (
    nodeOxide as unknown as {
      WasmPdfDocument: new (d: Uint8Array, p?: string | null) => OxideDocument;
    }
  ).WasmPdfDocument(bytes, null);
  for (let p = 0; p < doc.pageCount; p++) {
    const { segs } = await extractGeometry(mod, docPtrOf(native, 'tables'), p, null);
    const images = (ox.extractImages(p) as unknown[]).length > 0;
    pages.push(
      detectPage(p, wordsOf(ox.extractWords(p)), tablesOf(ox.extractTables(p)), segs, images),
    );
  }
  ox.free();
});

function expected(page: number, i: number): ExpectedTable {
  const t = EXPECTED[page]?.[i];
  if (!t) throw new Error('no expected table');
  return t;
}

/** Share of expected non-empty cells found at the same row and column. */
function accuracy(exp: ExpectedTable, got: string[][]): number {
  let total = 0;
  let ok = 0;
  exp.cells.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (!cell) return;
      total++;
      if ((got[r]?.[c] ?? '').replace(/\s+/g, ' ') === cell.replace(/\s+/g, ' ')) ok++;
    });
  });
  return total ? ok / total : 1;
}

describe('table detection on the self-made fixture', () => {
  it('page 1: two ruled tables side by side, 100 % of cells, merged headers rebuilt', () => {
    const [pipe, flange] = pages[0]?.tables ?? [];
    expect(pages[0]?.tables).toHaveLength(2);
    expect(pipe?.grid.source).toBe('lattice');
    expect(accuracy(expected(0, 0), pipe?.cells ?? [])).toBe(1);
    expect(accuracy(expected(0, 1), flange?.cells ?? [])).toBe(1);
    expect(pipe?.grid.merges).toEqual(EXPECTED[0]?.[0]?.merges);
    expect(pipe?.grid.headerRows).toBe(2);
    expect(flange?.grid.headerRows).toBe(1);
  });

  it('page 2: the unruled parts list, wrapped cells included (≥ 95 %)', () => {
    const [parts] = pages[1]?.tables ?? [];
    expect(pages[1]?.tables).toHaveLength(1);
    expect(parts?.grid.source).toBe('stream');
    expect(accuracy(expected(1, 0), parts?.cells ?? [])).toBeGreaterThanOrEqual(0.95);
    expect(parts?.grid.headerRows).toBe(1);
  });

  it('page 3: two unruled tables side by side are two tables', () => {
    const [bolts, gaskets] = pages[2]?.tables ?? [];
    expect(pages[2]?.tables).toHaveLength(2);
    expect(accuracy(expected(2, 0), bolts?.cells ?? [])).toBeGreaterThanOrEqual(0.95);
    expect(accuracy(expected(2, 1), gaskets?.cells ?? [])).toBeGreaterThanOrEqual(0.95);
  });

  it('page 4: scanned → OCR needed; page 5: prose → no table', () => {
    expect(pages[3]).toMatchObject({ ocr: true, tables: [] });
    expect(pages[4]).toMatchObject({ ocr: false, tables: [] });
  });
});
