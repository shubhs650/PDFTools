// What a text comparison reads from a page besides its characters (M12-18,
// D-63, spike S30): the pictures on it (figures, compared as pictures, and
// how much of the page they cover: a scan), and its tables, recognised by the
// app's own table detector (§7.7: ruled regions from PDFium's segments, then
// unruled tables from the words). The words are PDFium's, the same the text
// comparison reads, turned into the detector's user space; the tables come
// back in the displayed page's space with a box per cell. Read only.
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import {
  applyAffine,
  invertAffine,
  type Affine,
  type PageFigure,
  type PageFrame,
  type PageTable,
  type PageText,
} from '../../model/compare/material';
import { WORD_BOLD, wordsOf } from '../../model/compare/text/layout';
import { tokenize } from '../../model/compare/text/tokens';
import { anchorOf, cellBox, colCount, rowCount } from '../../model/tableGrid';
import { rawCall } from '../render/pdfium';
import { detectPage } from './tables/detect';
import type { StreamWord } from './tables/stream';

const FPDF_PAGEOBJ_PATH = 2;
const FPDF_PAGEOBJ_IMAGE = 3;
/** Smallest picture that is a figure (pt²): bullets, logos in a rule and dots are not. */
const MIN_FIGURE = 400;
/** Pages with fewer path objects and few numbers are not searched for tables (S30). */
const MIN_PATHS = 4;
const MIN_NUMERIC = 0.2;

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
}

const heapOf = (mod: WrappedPdfiumModule): Heap => mod.pdfium as unknown as Heap;

/** A box in one space → the other: [x0, y0, x1, y1] with x0 ≤ x1, y0 ≤ y1. */
export function mapBox(m: Affine, x0: number, y0: number, x1: number, y1: number): number[] {
  const [ax, ay] = applyAffine(m, x0, y0);
  const [bx, by] = applyAffine(m, x1, y1);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}

/** Size and FNV-1a hash of an image object's decoded pixels, and its 16 × 16 grey thumbnail. */
function imagePixels(mod: WrappedPdfiumModule, obj: number): { hash: string; thumb: Uint8Array } {
  const thumb = new Uint8Array(256).fill(255);
  const bmp = rawCall(mod, 'FPDFImageObj_GetBitmap', obj);
  if (!bmp) return { hash: 'none', thumb };
  try {
    const w = rawCall(mod, 'FPDFBitmap_GetWidth', bmp);
    const h = rawCall(mod, 'FPDFBitmap_GetHeight', bmp);
    const stride = rawCall(mod, 'FPDFBitmap_GetStride', bmp);
    const fmt = rawCall(mod, 'FPDFBitmap_GetFormat', bmp);
    const bpp = fmt === 1 ? 1 : fmt === 2 ? 3 : 4;
    const ch = Math.min(bpp, 3);
    const buf = rawCall(mod, 'FPDFBitmap_GetBuffer', bmp);
    const px = heapOf(mod).HEAPU8;
    let hash = 0x811c9dc5;
    const sum = new Float64Array(256);
    const cnt = new Float64Array(256);
    for (let y = 0; y < h; y++) {
      const row = buf + y * stride;
      const ty = Math.min(15, Math.floor((y * 16) / h)) * 16;
      for (let x = 0; x < w; x++) {
        const p = row + x * bpp;
        let g = 0;
        for (let k = 0; k < ch; k++) {
          const v = px[p + k] ?? 0;
          g += v;
          hash = Math.imul(hash ^ v, 0x01000193);
        }
        const i = ty + Math.min(15, Math.floor((x * 16) / w));
        sum[i] = (sum[i] ?? 0) + g / ch;
        cnt[i] = (cnt[i] ?? 0) + 1;
      }
    }
    for (let i = 0; i < 256; i++) if (cnt[i]) thumb[i] = Math.round((sum[i] ?? 0) / (cnt[i] ?? 1));
    return { hash: `${String(w)}x${String(h)}:${(hash >>> 0).toString(16)}`, thumb };
  } finally {
    rawCall(mod, 'FPDFBitmap_Destroy', bmp);
  }
}

export interface PageObjects {
  /** Share of the page covered by pictures. */
  imageCover: number;
  figures: PageFigure[];
  /** Path objects (rulings, drawings) at the page's top level. */
  paths: number;
}

/** A loaded page's pictures and path count (top-level objects). */
export function pageObjects(mod: WrappedPdfiumModule, page: number, frame: PageFrame): PageObjects {
  const heap = heapOf(mod);
  const b = heap.wasmExports.malloc(16);
  const figures: PageFigure[] = [];
  let area = 0;
  let paths = 0;
  try {
    const n = rawCall(mod, 'FPDFPage_CountObjects', page);
    for (let i = 0; i < n; i++) {
      const obj = rawCall(mod, 'FPDFPage_GetObject', page, i);
      if (!obj) continue;
      const type = rawCall(mod, 'FPDFPageObj_GetType', obj);
      if (type === FPDF_PAGEOBJ_PATH) paths++;
      if (type !== FPDF_PAGEOBJ_IMAGE) continue;
      if (!rawCall(mod, 'FPDFPageObj_GetBounds', obj, b, b + 4, b + 8, b + 12)) continue;
      const f = heapOf(mod).HEAPF32;
      const [x0, y0, x1, y1] = mapBox(
        frame.toDisplay,
        f[b >> 2] ?? 0,
        f[(b >> 2) + 1] ?? 0,
        f[(b >> 2) + 2] ?? 0,
        f[(b >> 2) + 3] ?? 0,
      ) as [number, number, number, number];
      // Clipped to the page: a picture bleeding off the edge covers only the page.
      const cx0 = Math.max(0, x0);
      const cy0 = Math.max(0, y0);
      const cx1 = Math.min(frame.width, x1);
      const cy1 = Math.min(frame.height, y1);
      const a = Math.max(0, cx1 - cx0) * Math.max(0, cy1 - cy0);
      area += a;
      if (a > MIN_FIGURE) figures.push({ box: [x0, y0, x1, y1], ...imagePixels(mod, obj) });
    }
  } finally {
    heap.wasmExports.free(b);
  }
  const imageCover = Math.min(1, area / Math.max(1, frame.width * frame.height));
  // A scan's own picture is not a figure of the document.
  return { imageCover, figures: imageCover >= 0.8 ? [] : figures, paths };
}

const NUMERIC = /^[$€£₹¥]?[-+]?[\d.,%]+$/u;

/** Whether a page can hold a table: rulings, or many numbers (S30's gate: detection is not free). */
export function mayHoldTables(text: PageText, paths: number): boolean {
  if (paths >= MIN_PATHS) return true;
  const words = wordsOf(text);
  if (words.length === 0) return false;
  let numeric = 0;
  for (const w of words) if (NUMERIC.test(w.text)) numeric++;
  return numeric >= MIN_NUMERIC * words.length;
}

/**
 * An unruled table must look like one: short cells (at most 4 words on
 * average) and at least 30 % of them a number or a value; otherwise prose in
 * two columns reads as a table (S30).
 */
export function looksTabular(cells: readonly (readonly string[])[]): boolean {
  const filled = cells.flat().filter((c) => c.trim());
  if (filled.length === 0) return false;
  let words = 0;
  let numeric = 0;
  for (const c of filled) {
    words += c.trim().split(/\s+/u).length;
    if (
      tokenize(c).every(
        (k) => k.kind === 'number' || k.kind === 'value' || k.kind === 'date' || k.kind === 'punct',
      )
    )
      numeric++;
  }
  return words / filled.length <= 4 && numeric >= 0.3 * filled.length;
}

/**
 * The page's tables (displayed space) from its characters and its segments
 * (user space, [x1, y1, x2, y2, …]; null when they can't be read).
 */
export function tablesOf(text: PageText, segs: Float32Array | null): PageTable[] {
  const toUser = invertAffine(text.frame.toDisplay);
  const toDisplay = text.frame.toDisplay;
  const words: StreamWord[] = wordsOf(text).map((w) => {
    const [x0, y0, x1, y1] = mapBox(toUser, w.x0, w.y0, w.x1, w.y1) as [
      number,
      number,
      number,
      number,
    ];
    return { x0, y0, x1, y1, text: w.text, bold: (w.flags & WORD_BOLD) !== 0, size: w.size };
  });
  if (words.length === 0) return [];
  const found = detectPage(0, words, [], segs, false);
  const out: PageTable[] = [];
  for (const t of found.tables) {
    const cells = t.cells.map((r) => r.map((c) => c.replace(/\s+/gu, ' ').trim()));
    if (t.grid.source === 'stream' && !looksTabular(cells)) continue;
    const g = t.grid;
    const nr = rowCount(g);
    const nc = colCount(g);
    const cellBoxes = new Float32Array(nr * nc * 4);
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    for (let r = 0; r < nr; r++)
      for (let c = 0; c < nc; c++) {
        const [ar, ac] = anchorOf(g, r, c);
        const [x0, y0, x1, y1] = cellBox(g, ar, ac);
        const d = mapBox(toDisplay, x0, y0, x1, y1);
        cellBoxes.set(d, (r * nc + c) * 4);
        bx0 = Math.min(bx0, d[0] ?? 0);
        by0 = Math.min(by0, d[1] ?? 0);
        bx1 = Math.max(bx1, d[2] ?? 0);
        by1 = Math.max(by1, d[3] ?? 0);
      }
    out.push({
      box: [bx0, by0, bx1, by1],
      cells,
      headerRows: g.headerRows,
      merges: g.merges.map((m) => ({ ...m })),
      cellBoxes,
    });
  }
  // Top to bottom in the displayed page.
  return out.sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
}
