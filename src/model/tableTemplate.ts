// Table templates (M4-15, §7.7, M4-Q9): an adjusted grid kept to apply to
// other pages — its dividers relative to the page's origin, header rows and
// merged cells, with the page size and rotation it was made on. A page of
// another size or rotation is skipped (the grid would not line up). Stored in
// IndexedDB (§10.3); validated when read back. Pure.
import { parseGrid, type Merge, type TableGrid } from './tableGrid';

export interface PageFrame {
  width: number;
  height: number;
  /** Crop box origin in user space. */
  originX: number;
  originY: number;
  /** Page rotation, 0/90/180/270. */
  rotation: number;
}

export interface TableTemplate {
  id: string;
  name: string;
  /** Epoch ms. */
  created: number;
  page: { width: number; height: number; rotation: number };
  /** x dividers from the page's left edge (points), ascending. */
  cols: number[];
  /** y dividers from the page's bottom edge (points), descending. */
  rows: number[];
  headerRows: number;
  merges: Merge[];
}

/** Page sizes within this many points match. */
export const SIZE_TOLERANCE = 1;

export const MAX_NAME = 80;

export function templateFromGrid(
  grid: TableGrid,
  frame: PageFrame,
  name: string,
  id: string,
  created: number,
): TableTemplate {
  return {
    id,
    name: name.trim().slice(0, MAX_NAME),
    created,
    page: { width: frame.width, height: frame.height, rotation: frame.rotation },
    cols: grid.cols.map((x) => x - frame.originX),
    rows: grid.rows.map((y) => y - frame.originY),
    headerRows: grid.headerRows,
    merges: grid.merges.map((m) => ({ ...m })),
  };
}

export function fits(t: TableTemplate, frame: PageFrame): boolean {
  return (
    Math.abs(t.page.width - frame.width) <= SIZE_TOLERANCE &&
    Math.abs(t.page.height - frame.height) <= SIZE_TOLERANCE &&
    ((t.page.rotation % 360) + 360) % 360 === ((frame.rotation % 360) + 360) % 360
  );
}

/** The template's grid on `page`, or null when the page's size or rotation differs. */
export function gridFromTemplate(
  t: TableTemplate,
  page: number,
  frame: PageFrame,
): TableGrid | null {
  if (!fits(t, frame)) return null;
  return {
    page,
    cols: t.cols.map((x) => x + frame.originX),
    rows: t.rows.map((y) => y + frame.originY),
    headerRows: t.headerRows,
    merges: t.merges.map((m) => ({ ...m })),
    source: 'template',
  };
}

/** Applies a template to pages: the grids, and the pages skipped (size/rotation). */
export function applyTemplate(
  t: TableTemplate,
  pages: readonly number[],
  frameOf: (page: number) => PageFrame,
): { grids: TableGrid[]; skipped: number[] } {
  const grids: TableGrid[] = [];
  const skipped: number[] = [];
  for (const p of pages) {
    const g = gridFromTemplate(t, p, frameOf(p));
    if (g) grids.push(g);
    else skipped.push(p);
  }
  return { grids, skipped };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A template from untrusted storage, or null when it isn't a valid one. */
export function parseTemplate(v: unknown): TableTemplate | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const { id, name, created, page } = o;
  if (typeof id !== 'string' || !id || typeof name !== 'string' || !name.trim()) return null;
  if (!isNum(created) || typeof page !== 'object' || page === null) return null;
  const { width, height, rotation } = page as Record<string, unknown>;
  if (!isNum(width) || !isNum(height) || width <= 0 || height <= 0) return null;
  if (!isNum(rotation) || rotation % 90 !== 0) return null;
  // The grid part is checked by the grid parser (dividers ordered, merges valid).
  const grid = parseGrid({
    page: 0,
    cols: o['cols'],
    rows: o['rows'],
    headerRows: o['headerRows'],
    merges: o['merges'],
    source: 'template',
  });
  if (!grid) return null;
  return {
    id,
    name: name.trim().slice(0, MAX_NAME),
    created,
    page: { width, height, rotation },
    cols: grid.cols,
    rows: grid.rows,
    headerRows: grid.headerRows,
    merges: grid.merges,
  };
}
