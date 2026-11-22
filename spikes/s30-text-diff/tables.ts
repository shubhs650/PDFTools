// Spike S30 (M12-05): tables for the text comparison (D-63, Q30) with the
// app's existing detector (§7.7, src/workers/work/tables/detect.ts): PDF Oxide
// supplies words and table candidates, PDFium the ruling segments, exactly as
// the table export does. Each table becomes rows of cells; boxes are turned
// into the displayed page's space so the reading order can place the table.

import * as nodeOxide from 'pdf-oxide-wasm';
import { extractGeometry } from '../../src/workers/work/geometry.ts';
import { detectPage, type DetectedTable } from '../../src/workers/work/tables/detect.ts';
import { tablesOf, wordsOf } from '../../src/workers/work/tables/oxideInput.ts';
import type { OxideDocument } from '../../src/workers/work/oxide.ts';
import { bbox } from '../../src/model/tableGrid.ts';
import { applyMat } from '../s28-alignment/geom.ts';
import { pageInfo, type Doc } from '../s28-alignment/pdfium.ts';
import type { Box } from './layout.ts';
import { tokenize } from './tokens.ts';

export interface PageTable {
  /** Displayed space. */
  box: Box;
  rows: string[][];
  headerRows: number;
  table: DetectedTable;
}

export function openOxide(bytes: Uint8Array, password = ''): OxideDocument {
  return new (
    nodeOxide as unknown as {
      WasmPdfDocument: new (d: Uint8Array, p?: string | null) => OxideDocument;
    }
  ).WasmPdfDocument(bytes, password || null);
}

export async function pageTables(doc: Doc, ox: OxideDocument, page: number): Promise<PageTable[]> {
  const info = pageInfo(doc, page);
  const { segs } = await extractGeometry(doc.mod, doc.ptr, page, null);
  const words = wordsOf(ox.extractWords(page));
  if (words.length === 0) return [];
  const found = detectPage(page, words, tablesOf(ox.extractTables(page)), segs, false);
  // Running text in columns can look like an unruled table. An unruled table
  // must have short cells (at most 4 words on average) and a good share of
  // cells that are a number or a value (at least 30 %).
  const tables = found.tables.filter((t) => {
    if (t.grid.source !== 'stream') return true;
    const cells = t.cells.flat().filter((c) => c.trim());
    const words = cells.reduce((s, c) => s + c.trim().split(/\s+/).length, 0);
    const numeric = cells.filter((c) =>
      tokenize(c).every(
        (k) => k.kind === 'number' || k.kind === 'value' || k.kind === 'date' || k.kind === 'punct',
      ),
    ).length;
    return cells.length > 0 && words / cells.length <= 4 && numeric >= 0.3 * cells.length;
  });
  return tables.map((t) => {
    const [x0, y0, x1, y1] = bbox(t.grid);
    const [ax, ay] = applyMat(info.toDisplay, x0, y0);
    const [bx, by] = applyMat(info.toDisplay, x1, y1);
    return {
      box: {
        x0: Math.min(ax, bx),
        y0: Math.min(ay, by),
        x1: Math.max(ax, bx),
        y1: Math.max(ay, by),
      },
      rows: t.cells.map((r) => r.map((c) => c.replace(/\s+/g, ' ').trim())),
      headerRows: t.grid.headerRows,
      table: t,
    };
  });
}
