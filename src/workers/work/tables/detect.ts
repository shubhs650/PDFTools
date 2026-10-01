// Table detection per page (M4-12, §7.7): ruled tables first (lattice.ts),
// then unruled ones (stream.ts) from the words outside them; header rows
// from bold text; each table scored by how many of its cells hold text, weak
// candidates dropped. A page with no text but images needs OCR (planned).
// Pure: the Work worker feeds it Oxide's tables and words and PDFium's
// segments.
import {
  anchorOf,
  assignText,
  bbox,
  cellAt,
  colCount,
  rowCount,
  type TableGrid,
} from '../../../model/tableGrid';
import { gridInBox, latticeGrid, ruledRegions, type OxideTable } from './lattice';
import { streamTables, type StreamWord } from './stream';

export interface DetectedTable {
  grid: TableGrid;
  cells: string[][];
  /** Share of (anchor) cells with text, 0–1. */
  score: number;
}

export interface PageTables {
  page: number;
  tables: DetectedTable[];
  /** No text layer but images: the page needs OCR (planned, §7.7). */
  ocr: boolean;
}

/** Candidates below this fill are not tables. */
const MIN_SCORE = 0.4;
/** Header rows never exceed this many. */
const MAX_HEADER = 3;

/** Leading rows whose words are all bold (and that have text). */
export function boldHeaderRows(grid: TableGrid, words: readonly StreamWord[]): number {
  const nr = rowCount(grid);
  const byRow = Array.from({ length: nr }, () => ({ bold: 0, plain: 0 }));
  for (const w of words) {
    const at = cellAt(grid, (w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2);
    if (!at) continue;
    const [r] = anchorOf(grid, at[0], at[1]);
    const row = byRow[r];
    if (!row) continue;
    if (w.bold) row.bold++;
    else row.plain++;
  }
  let n = 0;
  while (n < Math.min(MAX_HEADER, nr - 1)) {
    const row = byRow[n];
    if (!row || row.plain > 0) break;
    // An empty row inside a header (a merged cell's lower half) continues it.
    if (row.bold === 0 && !grid.merges.some((m) => m.r < n && m.r + m.rs > n)) break;
    n++;
  }
  // Rows covered by a merge that starts in the header belong to it.
  for (const m of grid.merges) if (m.r < n) n = Math.max(n, Math.min(MAX_HEADER, m.r + m.rs));
  return n;
}

export function score(grid: TableGrid, cells: readonly string[][]): number {
  let anchors = 0;
  let filled = 0;
  for (let r = 0; r < rowCount(grid); r++)
    for (let c = 0; c < colCount(grid); c++) {
      const [ar, ac] = anchorOf(grid, r, c);
      if (ar !== r || ac !== c) continue;
      anchors++;
      if (cells[r]?.[c]) filled++;
    }
  return anchors ? filled / anchors : 0;
}

export function detectPage(
  page: number,
  words: readonly StreamWord[],
  oxideTables: readonly OxideTable[],
  segs: Float32Array | null,
  hasImages: boolean,
): PageTables {
  const tables: DetectedTable[] = [];
  const add = (grid: TableGrid) => {
    const g = { ...grid, headerRows: boldHeaderRows(grid, words) };
    const cells = assignText(g, words);
    const s = score(g, cells);
    if (s >= MIN_SCORE) tables.push({ grid: g, cells, score: s });
  };
  // Ruled regions from the page's own rulings, then any Oxide table outside them.
  const regions = segs ? ruledRegions(segs) : [];
  for (const box of regions) {
    const grid = segs ? gridInBox(page, box, segs) : null;
    if (grid) add(grid);
  }
  for (const t of oxideTables) {
    const cx = t.bbox.x + t.bbox.width / 2;
    const cy = t.bbox.y + t.bbox.height / 2;
    if (regions.some(([x0, y0, x1, y1]) => cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1)) continue;
    const grid = latticeGrid(page, t, segs);
    if (grid) add(grid);
  }
  const ruled = tables.map((t) => bbox(t.grid));
  for (const grid of streamTables(page, words, ruled)) add(grid);
  // Top to bottom, then left to right.
  tables.sort((a, b) => {
    const [ax0, , , ay1] = bbox(a.grid);
    const [bx0, , , by1] = bbox(b.grid);
    return Math.abs(ay1 - by1) > 20 ? by1 - ay1 : ax0 - bx0;
  });
  return { page, tables, ocr: words.length === 0 && hasImages };
}
