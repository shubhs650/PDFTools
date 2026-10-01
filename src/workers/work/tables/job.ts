// Table jobs in the Work worker (M4-12 … M4-15, §7.7): detection over pages
// (cancellable and with progress per page, rule 2) and the text of given
// grids (review edits, templates, export). PDF Oxide supplies words and its
// table candidates, PDFium the ruling segments; the page's words are cached
// (a few pages) so moving a divider re-assigns text without reading the page
// again. The caller has checked the copy permission (rule 9).
import { tableData, type TableData, type TableGrid } from '../../../model/tableGrid';
import type { OxideDocument } from '../oxide';
import type { JobSlice } from '../scheduler';
import { detectPage, type PageTables } from './detect';
import { tablesOf, wordsOf } from './oxideInput';
import type { StreamWord } from './stream';
import { buildTablesWorkbook, nameTables, tableCsv } from './writers';
import { zipBlob } from '../zip';

export interface TableSources {
  oxide: OxideDocument;
  /** Cache key of this state of the document (its engine id and applied tail). */
  key: string;
  /** The page's segments (user space), or null when they can't be read. */
  segments(page: number): Promise<Float32Array | null>;
}

const WORDS_CACHED = 24;
const wordCache = new Map<string, StreamWord[]>();

export function wordsFor(src: TableSources, page: number): StreamWord[] {
  const k = `${src.key}:${String(page)}`;
  let words = wordCache.get(k);
  if (!words) {
    words = wordsOf(src.oxide.extractWords(page));
    wordCache.set(k, words);
    while (wordCache.size > WORDS_CACHED) {
      const first = wordCache.keys().next().value;
      if (first === undefined) break;
      wordCache.delete(first);
    }
  } else {
    // Most recently used last.
    wordCache.delete(k);
    wordCache.set(k, words);
  }
  return words;
}

export async function detectTables(
  src: TableSources,
  pages: readonly number[],
  slice: JobSlice,
  progress: (p: { done: number; total: number }) => void,
): Promise<PageTables[]> {
  const out: PageTables[] = [];
  for (const [i, page] of pages.entries()) {
    await slice.checkpoint();
    const words = wordsFor(src, page);
    const segs = await src.segments(page);
    const images = words.length === 0 && (src.oxide.extractImages(page) as unknown[]).length > 0;
    out.push(detectPage(page, words, tablesOf(src.oxide.extractTables(page)), segs, images));
    progress({ done: i + 1, total: pages.length });
  }
  return out;
}

/** Cells (and merges, header rows) of each grid, from its page's words. */
export async function tableCells(
  src: TableSources,
  grids: readonly TableGrid[],
  slice: JobSlice,
): Promise<TableData[]> {
  const out: TableData[] = [];
  for (const g of grids) {
    await slice.checkpoint();
    out.push(tableData(g, wordsFor(src, g.page)));
  }
  return out;
}

/** Forget a document's cached words (closed, reloaded). */
export function dropTableWords(prefix: string): void {
  for (const k of [...wordCache.keys()]) if (k.startsWith(prefix)) wordCache.delete(k);
}

export type TableFormat = 'xlsx' | 'csv';
export type TablePackaging = 'single' | 'zip' | 'folder';

export interface TableExportResult {
  /** single / zip: one file. */
  blob?: Blob;
  /** folder: the files to write. */
  files?: { path: string; blob: Blob }[];
  tables: number;
  /** Pages that need OCR (no text layer). */
  ocrPages: number[];
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Express Extract (M4-13) and Review & Extract's export (M4-14): the tables
 * of `pages` (detected), the given grids, or tables already read (Express
 * Extract's detection result) → one workbook, or one CSV per
 * table (a single file when there is one, else a ZIP or the folder's files).
 * No tables: `tables` is 0 and nothing is built.
 */
export async function exportTables(
  src: TableSources,
  input:
    | { pages: readonly number[] }
    | { grids: readonly TableGrid[] }
    | { tables: readonly TableData[] },
  format: TableFormat,
  packaging: TablePackaging,
  baseName: string,
  slice: JobSlice,
  progress: (p: { done: number; total: number }) => void,
): Promise<TableExportResult> {
  let datas: TableData[];
  let ocrPages: number[] = [];
  if ('pages' in input) {
    const pages = await detectTables(src, input.pages, slice, progress);
    ocrPages = pages.filter((p) => p.ocr).map((p) => p.page);
    datas = pages.flatMap((p) =>
      p.tables.map((t) => ({
        page: p.page,
        cells: t.cells,
        merges: t.grid.merges,
        headerRows: t.grid.headerRows,
      })),
    );
  } else if ('grids' in input) datas = await tableCells(src, input.grids, slice);
  else datas = [...input.tables];
  if (datas.length === 0) return { tables: 0, ocrPages };
  const named = nameTables(datas);
  if (format === 'xlsx') {
    const { default: lib } = await import('exceljs');
    const bytes = await buildTablesWorkbook(lib, named, () => slice.checkpoint());
    return { blob: new Blob([bytes], { type: XLSX }), tables: named.length, ocrPages };
  }
  const files = named.map((t) => ({
    path: `${baseName} ${t.name}.csv`,
    blob: new Blob([tableCsv(t.data)], { type: 'text/csv;charset=utf-8' }),
  }));
  if (packaging === 'folder') return { files, tables: files.length, ocrPages };
  const [only] = files;
  if (packaging === 'single' && files.length === 1 && only)
    return { blob: only.blob, tables: 1, ocrPages };
  const entries = named.map((t) => ({ name: `${baseName} ${t.name}.csv`, data: tableCsv(t.data) }));
  return { blob: zipBlob(entries), tables: files.length, ocrPages };
}
