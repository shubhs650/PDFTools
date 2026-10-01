// The table grid (M4-12, §7.7): a table on a page as column and row dividers,
// header rows and merged cells — the one model behind detection, review,
// templates and export. Coordinates are PDF user space of the page (points,
// y up), unrotated. Merged header cells come from here, not from an engine.
// Pure and dependency-free (TDD).

export type TableSource = 'lattice' | 'stream' | 'manual' | 'template';

/** A merged block: `rs` rows × `cs` columns from (r, c). */
export interface Merge {
  r: number;
  c: number;
  rs: number;
  cs: number;
}

export interface TableGrid {
  /** 0-based page. */
  page: number;
  /** x dividers, left edge first, ascending (columns = length − 1). */
  cols: number[];
  /** y dividers, top edge first, descending (rows = length − 1). */
  rows: number[];
  /** The first `headerRows` rows are header rows. */
  headerRows: number;
  merges: Merge[];
  source: TableSource;
}

/** A word on the page: box in user space [x0, y0, x1, y1] (y up) and its text. */
export interface WordBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  text: string;
}

/** Narrowest column or row a divider move leaves (points). */
export const MIN_GAP = 2;

export const colCount = (g: TableGrid): number => g.cols.length - 1;
export const rowCount = (g: TableGrid): number => g.rows.length - 1;

export function bbox(g: TableGrid): [number, number, number, number] {
  return [g.cols[0] ?? 0, g.rows.at(-1) ?? 0, g.cols.at(-1) ?? 0, g.rows[0] ?? 0];
}

/** A grid with `nc` equal columns and `nr` equal rows over the box. */
export function makeGrid(
  page: number,
  box: [number, number, number, number],
  nc: number,
  nr: number,
  source: TableSource = 'manual',
): TableGrid {
  const [x0, y0, x1, y1] = box;
  const cols = Array.from({ length: nc + 1 }, (_, i) => x0 + ((x1 - x0) * i) / nc);
  const rows = Array.from({ length: nr + 1 }, (_, i) => y1 - ((y1 - y0) * i) / nr);
  return { page, cols, rows, headerRows: 0, merges: [], source };
}

const clone = (g: TableGrid): TableGrid => ({
  ...g,
  cols: [...g.cols],
  rows: [...g.rows],
  merges: g.merges.map((m) => ({ ...m })),
});

// ---- dividers ---------------------------------------------------------------------

/** Adds a column divider at x (inside the table); merges it cuts through stay merged. */
export function addCol(g: TableGrid, x: number): TableGrid {
  const out = clone(g);
  const i = out.cols.findIndex((v) => v > x);
  if (i <= 0 || x - (out.cols[i - 1] ?? 0) < MIN_GAP || (out.cols[i] ?? 0) - x < MIN_GAP) return g;
  out.cols.splice(i, 0, x);
  // Column i − 1 split into i − 1 and i.
  out.merges = out.merges.map((m) =>
    m.c > i - 1 ? { ...m, c: m.c + 1 } : m.c + m.cs - 1 >= i - 1 ? { ...m, cs: m.cs + 1 } : m,
  );
  return out;
}

/** Adds a row divider at y (inside the table). */
export function addRow(g: TableGrid, y: number): TableGrid {
  const out = clone(g);
  const i = out.rows.findIndex((v) => v < y);
  if (i <= 0 || (out.rows[i - 1] ?? 0) - y < MIN_GAP || y - (out.rows[i] ?? 0) < MIN_GAP) return g;
  out.rows.splice(i, 0, y);
  out.merges = out.merges.map((m) =>
    m.r > i - 1 ? { ...m, r: m.r + 1 } : m.r + m.rs - 1 >= i - 1 ? { ...m, rs: m.rs + 1 } : m,
  );
  if (out.headerRows > i - 1) out.headerRows++;
  return out;
}

/** Removes inner column divider `k` (1 … cols − 1): the two columns become one. */
export function removeCol(g: TableGrid, k: number): TableGrid {
  if (k <= 0 || k >= g.cols.length - 1) return g;
  const out = clone(g);
  out.cols.splice(k, 1);
  out.merges = normalizeMerges(
    out.merges.map((m) => {
      const end = m.c + m.cs; // exclusive, in old columns
      const c = m.c >= k ? m.c - 1 : m.c;
      const e = end > k ? end - 1 : end;
      return { ...m, c, cs: Math.max(1, e - c) };
    }),
    rowCount(out),
    colCount(out),
  );
  return out;
}

/** Removes inner row divider `k` (1 … rows − 1). */
export function removeRow(g: TableGrid, k: number): TableGrid {
  if (k <= 0 || k >= g.rows.length - 1) return g;
  const out = clone(g);
  out.rows.splice(k, 1);
  out.merges = normalizeMerges(
    out.merges.map((m) => {
      const end = m.r + m.rs;
      const r = m.r >= k ? m.r - 1 : m.r;
      const e = end > k ? end - 1 : end;
      return { ...m, r, rs: Math.max(1, e - r) };
    }),
    rowCount(out),
    colCount(out),
  );
  if (out.headerRows >= k) out.headerRows--;
  return out;
}

/** Moves column divider `k` to x, kept between its neighbours (edges move the table edge). */
export function moveCol(g: TableGrid, k: number, x: number): TableGrid {
  const out = clone(g);
  const lo = k > 0 ? (out.cols[k - 1] ?? -Infinity) + MIN_GAP : -Infinity;
  const hi = k < out.cols.length - 1 ? (out.cols[k + 1] ?? Infinity) - MIN_GAP : Infinity;
  if (k < 0 || k >= out.cols.length) return g;
  out.cols[k] = Math.min(hi, Math.max(lo, x));
  return out;
}

/** Moves row divider `k` to y, kept between its neighbours. */
export function moveRow(g: TableGrid, k: number, y: number): TableGrid {
  const out = clone(g);
  if (k < 0 || k >= out.rows.length) return g;
  const hi = k > 0 ? (out.rows[k - 1] ?? Infinity) - MIN_GAP : Infinity;
  const lo = k < out.rows.length - 1 ? (out.rows[k + 1] ?? -Infinity) + MIN_GAP : -Infinity;
  out.rows[k] = Math.min(hi, Math.max(lo, y));
  return out;
}

/** Moves the whole table by (dx, dy). */
export function translate(g: TableGrid, dx: number, dy: number): TableGrid {
  return { ...clone(g), cols: g.cols.map((x) => x + dx), rows: g.rows.map((y) => y + dy) };
}

export function setHeaderRows(g: TableGrid, n: number): TableGrid {
  return { ...clone(g), headerRows: Math.max(0, Math.min(rowCount(g), Math.round(n))) };
}

// ---- merges -------------------------------------------------------------------------

const overlaps = (a: Merge, b: Merge): boolean =>
  a.r < b.r + b.rs && b.r < a.r + a.rs && a.c < b.c + b.cs && b.c < a.c + a.cs;

/** Valid, in range, at least two cells, non-overlapping (later ones win). */
export function normalizeMerges(merges: readonly Merge[], nr: number, nc: number): Merge[] {
  const out: Merge[] = [];
  for (const m of merges) {
    const r = Math.max(0, m.r);
    const c = Math.max(0, m.c);
    const rs = Math.min(nr - r, m.rs - (r - m.r));
    const cs = Math.min(nc - c, m.cs - (c - m.c));
    if (rs < 1 || cs < 1 || rs * cs < 2) continue;
    const n = { r, c, rs, cs };
    for (let i = out.length - 1; i >= 0; i--) {
      const o = out[i];
      if (o && overlaps(o, n)) out.splice(i, 1);
    }
    out.push(n);
  }
  return out.sort((a, b) => a.r - b.r || a.c - b.c);
}

/** Merges the block from (r0, c0) to (r1, c1) (inclusive, any order); overlapped merges are replaced. */
export function merge(g: TableGrid, r0: number, c0: number, r1: number, c1: number): TableGrid {
  const m = {
    r: Math.min(r0, r1),
    c: Math.min(c0, c1),
    rs: Math.abs(r1 - r0) + 1,
    cs: Math.abs(c1 - c0) + 1,
  };
  return { ...clone(g), merges: normalizeMerges([...g.merges, m], rowCount(g), colCount(g)) };
}

/** Splits the merge covering (r, c), if any. */
export function unmerge(g: TableGrid, r: number, c: number): TableGrid {
  const m = mergeAt(g, r, c);
  if (!m) return g;
  return { ...clone(g), merges: g.merges.filter((x) => x !== m).map((x) => ({ ...x })) };
}

export function mergeAt(g: TableGrid, r: number, c: number): Merge | undefined {
  return g.merges.find((m) => r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs);
}

/** The anchor (top-left) cell of the cell at (r, c). */
export function anchorOf(g: TableGrid, r: number, c: number): [number, number] {
  const m = mergeAt(g, r, c);
  return m ? [m.r, m.c] : [r, c];
}

// ---- geometry -----------------------------------------------------------------------

/** The cell (row, column) containing the point, or null outside the table. */
export function cellAt(g: TableGrid, x: number, y: number): [number, number] | null {
  const c = g.cols.findIndex((v, i) => i > 0 && x <= v && x >= (g.cols[i - 1] ?? Infinity));
  const r = g.rows.findIndex((v, i) => i > 0 && y >= v && y <= (g.rows[i - 1] ?? -Infinity));
  return c > 0 && r > 0 ? [r - 1, c - 1] : null;
}

/** The box of a cell (or its whole merge when it is an anchor): [x0, y0, x1, y1]. */
export function cellBox(g: TableGrid, r: number, c: number): [number, number, number, number] {
  const m = mergeAt(g, r, c);
  const [rr, cc, rs, cs] = m ? [m.r, m.c, m.rs, m.cs] : [r, c, 1, 1];
  return [g.cols[cc] ?? 0, g.rows[rr + rs] ?? 0, g.cols[cc + cs] ?? 0, g.rows[rr] ?? 0];
}

// ---- text ---------------------------------------------------------------------------

/**
 * Cell texts: each word goes to the cell holding its box centre (merged cells
 * collect into their anchor). In a cell, words on one line (overlapping
 * vertically) join with a space, top to bottom lines with a newline.
 */
export function assignText(g: TableGrid, words: readonly WordBox[]): string[][] {
  const nr = rowCount(g);
  const nc = colCount(g);
  const buckets: WordBox[][][] = Array.from({ length: nr }, () =>
    Array.from({ length: nc }, () => []),
  );
  for (const w of words) {
    const at = cellAt(g, (w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2);
    if (!at) continue;
    const [r, c] = anchorOf(g, at[0], at[1]);
    buckets[r]?.[c]?.push(w);
  }
  return buckets.map((row) => row.map((ws) => joinWords(ws)));
}

/** Words of one cell as text: lines by vertical overlap, top to bottom; left to right in a line. */
export function joinWords(words: readonly WordBox[]): string {
  const sorted = [...words].sort((a, b) => b.y1 - a.y1 || a.x0 - b.x0);
  const lines: WordBox[][] = [];
  for (const w of sorted) {
    const line = lines.find((l) => {
      const f = l[0];
      if (!f) return false;
      const overlap = Math.min(f.y1, w.y1) - Math.max(f.y0, w.y0);
      return overlap > 0.5 * Math.min(f.y1 - f.y0, w.y1 - w.y0);
    });
    if (line) line.push(w);
    else lines.push([w]);
  }
  return lines
    .map((l) =>
      [...l]
        .sort((a, b) => a.x0 - b.x0)
        .map((w) => w.text)
        .join(' '),
    )
    .join('\n')
    .trim();
}

/** Cells for export: text matrix plus the merges and header rows that apply. */
export interface TableData {
  page: number;
  cells: string[][];
  merges: Merge[];
  headerRows: number;
}

export function tableData(g: TableGrid, words: readonly WordBox[]): TableData {
  return { page: g.page, cells: assignText(g, words), merges: g.merges, headerRows: g.headerRows };
}

// ---- serialisation ------------------------------------------------------------------

const isNums = (v: unknown): v is number[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x));
const SOURCES: readonly TableSource[] = ['lattice', 'stream', 'manual', 'template'];

/** A grid from untrusted data (stored templates, messages): null when it isn't one. */
export function parseGrid(v: unknown): TableGrid | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const { page, cols, rows, headerRows, merges, source } = o;
  if (!Number.isInteger(page) || (page as number) < 0) return null;
  if (!isNums(cols) || !isNums(rows) || cols.length < 2 || rows.length < 2) return null;
  for (let i = 1; i < cols.length; i++) if ((cols[i] ?? 0) <= (cols[i - 1] ?? 0)) return null;
  for (let i = 1; i < rows.length; i++) if ((rows[i] ?? 0) >= (rows[i - 1] ?? 0)) return null;
  if (!Number.isInteger(headerRows) || (headerRows as number) < 0) return null;
  if (
    !Array.isArray(merges) ||
    typeof source !== 'string' ||
    !SOURCES.includes(source as TableSource)
  )
    return null;
  const ms: Merge[] = [];
  for (const m of merges) {
    if (typeof m !== 'object' || m === null) return null;
    const { r, c, rs, cs } = m as Record<string, unknown>;
    if (![r, c, rs, cs].every((x) => Number.isInteger(x))) return null;
    ms.push({ r: r as number, c: c as number, rs: rs as number, cs: cs as number });
  }
  const nr = rows.length - 1;
  return {
    page: page as number,
    cols: [...cols],
    rows: [...rows],
    headerRows: Math.min(nr, headerRows as number),
    merges: normalizeMerges(ms, nr, cols.length - 1),
    source: source as TableSource,
  };
}
