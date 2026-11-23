// Difference detection on drawings (M12-14, D-61, S28), banded. The analysis
// rasters of a sheet pair (A already drawn through its alignment into B's
// frame) arrive band by band, top to bottom. For every pixel with ink on one
// side the detector measures how far the nearest ink of the other side is
// (Chebyshev distance, in pixels, up to DISTANCE_CAP) and keeps only counts:
// per grouping cell, how many pixels of A and of B are that far from the
// other side. A mark is unchanged at tolerance `tol` when the other side has
// ink within `tol` pixels, so the counts give every sensitivity at once:
// sensitivity and minimum size are applied later without drawing the sheet
// again (Q22). Only a few rows of each band are held past it (the distance
// looks DISTANCE_CAP rows up and down), never a whole sheet (S28: an ARCH E
// sheet held whole would be 350 MB).
import type { RasterBand } from '../material';

/** Distances are measured up to this (px); a mark farther from any ink counts as this far. */
export const DISTANCE_CAP = 5;
/** The largest tolerance the counts can serve (px). */
export const MAX_TOLERANCE = DISTANCE_CAP - 1;
/** Count bins per side: distance 2, 3, 4 and ≥ 5 (distance 0 and 1 are never changed). */
export const BINS = DISTANCE_CAP - 1;
/** Counts per cell: A's bins (removed), then B's (added). */
export const CELL_COUNTS = 2 * BINS;
/** Ink level (0–255) that counts as a mark (S28): 96 on vector sheets, 128 on scans. */
export const INK_LEVEL = 96;
export const SCAN_INK_LEVEL = 128;
/** Grouping cell (S28): marks within 6 pt join, on cells half that wide. */
export const CELL_PT = 3;

/**
 * A sheet's difference counts: the cells with a mark at least 2 px from the
 * other side's ink (anything less is never a change), in index order.
 */
export interface DiffCells {
  dpi: number;
  /** Raster size (px). */
  width: number;
  height: number;
  /** Cell side (px). */
  cell: number;
  cols: number;
  rows: number;
  /** Cell indexes (row * cols + col), ascending. */
  index: Uint32Array;
  /** CELL_COUNTS per cell: A's pixels 2, 3, 4, ≥ 5 px from B's ink, then B's from A's. */
  counts: Uint16Array;
  /** Pixels with ink on A, on B, on either. */
  inkA: number;
  inkB: number;
  ink: number;
}

/** Bytes a sheet's cells hold (the Compare worker's memory account). */
export const cellsBytes = (c: DiffCells): number => c.index.byteLength + c.counts.byteLength + 64;

/** The cell side in px for an analysis resolution. */
export const cellPx = (dpi: number): number => Math.max(1, Math.round((CELL_PT * dpi) / 72));

/** Distance along a row to the nearest ink, capped (0 on ink). */
function rowDistance(ink: Uint8Array, out: Uint8Array): void {
  const w = ink.length;
  let d = DISTANCE_CAP;
  for (let x = 0; x < w; x++) {
    d = ink[x] ? 0 : Math.min(DISTANCE_CAP, d + 1);
    out[x] = d;
  }
  d = DISTANCE_CAP;
  for (let x = w - 1; x >= 0; x--) {
    d = ink[x] ? 0 : Math.min(DISTANCE_CAP, d + 1);
    if (d < (out[x] ?? DISTANCE_CAP)) out[x] = d;
  }
}

interface Row {
  /** Distance along the row to A's ink, and to B's. */
  da: Uint8Array;
  db: Uint8Array;
}

/**
 * Folds a sheet's band pairs in, in order, and gives the cells at the end.
 * A band starting at row 0 again (the sheet analysed anew) starts over.
 */
export class DiffDetector {
  readonly width: number;
  readonly height: number;
  readonly dpi: number;
  readonly inkLevel: number;
  readonly cell: number;
  readonly cols: number;
  readonly cellRows: number;
  /** Rows received so far, and rows whose distances are counted. */
  private received = 0;
  private counted = 0;
  private rows = new Map<number, Row>();
  /** Counts of the cell rows still open, by cell row. */
  private open = new Map<number, Uint16Array>();
  private index: number[] = [];
  private counts: number[] = [];
  private inkA = 0;
  private inkB = 0;
  private ink = 0;

  constructor(width: number, height: number, dpi: number, inkLevel: number) {
    this.width = width;
    this.height = height;
    this.dpi = dpi;
    this.inkLevel = inkLevel;
    this.cell = cellPx(dpi);
    this.cols = Math.ceil(width / this.cell);
    this.cellRows = Math.ceil(height / this.cell);
  }

  get complete(): boolean {
    return this.counted === this.height;
  }

  /** Bytes held now: the rows kept for the distance and the open cell rows. */
  get bytes(): number {
    return (
      this.rows.size * 2 * this.width +
      this.open.size * this.cols * CELL_COUNTS * 2 +
      this.index.length * (4 + CELL_COUNTS * 2)
    );
  }

  private reset(): void {
    this.received = 0;
    this.counted = 0;
    this.rows = new Map();
    this.open = new Map();
    this.index = [];
    this.counts = [];
    this.inkA = 0;
    this.inkB = 0;
    this.ink = 0;
  }

  add(a: RasterBand, b: RasterBand): void {
    if (a.width !== this.width || b.width !== this.width)
      throw new Error('band width does not match the sheet');
    if (a.height !== this.height || b.height !== this.height)
      throw new Error('band height does not match the sheet');
    if (a.top !== b.top || a.rows !== b.rows) throw new Error('bands of A and B differ');
    if (a.top === 0 && this.received > 0) this.reset();
    // A band sent twice is not counted twice.
    if (a.top + a.rows <= this.received) return;
    if (a.top !== this.received) throw new Error('bands out of order');
    const w = this.width;
    const level = this.inkLevel;
    const ia = new Uint8Array(w);
    const ib = new Uint8Array(w);
    for (let r = 0; r < a.rows; r++) {
      const off = r * w;
      for (let x = 0; x < w; x++) {
        const ka = (a.data[off + x] ?? 0) > level ? 1 : 0;
        const kb = (b.data[off + x] ?? 0) > level ? 1 : 0;
        ia[x] = ka;
        ib[x] = kb;
        this.inkA += ka;
        this.inkB += kb;
        this.ink += ka | kb;
      }
      const row: Row = { da: new Uint8Array(w), db: new Uint8Array(w) };
      rowDistance(ia, row.da);
      rowDistance(ib, row.db);
      this.rows.set(a.top + r, row);
    }
    this.received = a.top + a.rows;
    const last = this.received === this.height;
    this.countUpTo(last ? this.height : this.received - DISTANCE_CAP);
  }

  /** Counts rows up to `end` (their neighbours within DISTANCE_CAP are all in). */
  private countUpTo(end: number): void {
    const w = this.width;
    const cell = this.cell;
    const cap = DISTANCE_CAP;
    for (let y = this.counted; y < end; y++) {
      const row = this.rows.get(y);
      if (!row) throw new Error('row missing');
      const cy = Math.floor(y / cell);
      let counts = this.open.get(cy);
      for (let x = 0; x < w; x++) {
        const onA = row.da[x] === 0;
        const onB = row.db[x] === 0;
        if (onA === onB) continue;
        // The nearest ink of the other side, over the rows around.
        const other = onA ? 'db' : 'da';
        let best = row[other][x] ?? cap;
        for (let dy = 1; dy < best && dy < cap; dy++) {
          const up = this.rows.get(y - dy)?.[other][x] ?? cap;
          const down = this.rows.get(y + dy)?.[other][x] ?? cap;
          const near = Math.max(dy, Math.min(up, down));
          if (near < best) best = near;
        }
        if (best < 2) continue;
        if (!counts) {
          counts = new Uint16Array(this.cols * CELL_COUNTS);
          this.open.set(cy, counts);
        }
        const bin = Math.min(best, cap) - 2;
        const k = Math.floor(x / cell) * CELL_COUNTS + (onA ? 0 : BINS) + bin;
        counts[k] = (counts[k] ?? 0) + 1;
      }
      // Rows below y + 1 − (cap − 1) are not looked at again.
      this.rows.delete(y - cap);
    }
    this.counted = Math.max(this.counted, end);
    // Cell rows wholly counted go into the sparse list.
    const doneCells = this.counted === this.height ? Infinity : Math.floor(this.counted / cell);
    for (const cy of [...this.open.keys()].sort((p, q) => p - q)) {
      if (cy >= doneCells) break;
      this.flush(cy);
    }
    if (this.counted === this.height) this.rows.clear();
  }

  private flush(cy: number): void {
    const counts = this.open.get(cy);
    this.open.delete(cy);
    if (!counts) return;
    for (let cx = 0; cx < this.cols; cx++) {
      const base = cx * CELL_COUNTS;
      let any = false;
      for (let k = 0; k < CELL_COUNTS; k++) if (counts[base + k]) any = true;
      if (!any) continue;
      this.index.push(cy * this.cols + cx);
      for (let k = 0; k < CELL_COUNTS; k++) this.counts.push(counts[base + k] ?? 0);
    }
  }

  /** The sheet's cells; throws before every row is in. */
  cells(): DiffCells {
    if (!this.complete) throw new Error('sheet incomplete');
    // Cell rows were flushed in order, so the indexes ascend.
    return {
      dpi: this.dpi,
      width: this.width,
      height: this.height,
      cell: this.cell,
      cols: this.cols,
      rows: this.cellRows,
      index: Uint32Array.from(this.index),
      counts: Uint16Array.from(this.counts),
      inkA: this.inkA,
      inkB: this.inkB,
      ink: this.ink,
    };
  }
}
