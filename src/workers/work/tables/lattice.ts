// Lattice (ruled) tables (M4-12, §7.7, ADR-009 decision 4): PDF Oxide finds
// the table and its outline; the dividers and merged cells come from the
// page's own ruling segments (PDFium vector paths, the snap extraction): a
// divider wherever rulings run, and two neighbouring cells are one merged
// cell where the ruling between them is missing. Without rulings (a table
// drawn some other way) Oxide's cell edges are used and nothing is merged.
// Pure.
import { normalizeMerges, type Merge, type TableGrid } from '../../../model/tableGrid';

export interface OxideBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OxideTable {
  bbox: OxideBox;
  rows: { cells: { bbox: OxideBox; text: string }[] }[];
}

/** Rulings within this distance are one divider (double lines, thick rules drawn as thin boxes). */
const TOL = 2.5;
/** A boundary counts as ruled when rulings cover this share of it. */
const COVERED = 0.7;

interface Rule {
  at: number;
  from: number;
  to: number;
}

/** Means of values closer than `tol` to their neighbours (sorted ascending). */
export function cluster(values: readonly number[], tol = TOL): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[][] = [];
  for (const v of sorted) {
    const last = out.at(-1);
    if (last && v - (last.at(-1) ?? v) <= tol) last.push(v);
    else out.push([v]);
  }
  return out.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
}

/** Share of [lo, hi] covered by the intervals. */
export function coverage(rules: readonly Rule[], lo: number, hi: number): number {
  const parts = rules
    .map((r) => [Math.max(lo, r.from), Math.min(hi, r.to)] as const)
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let end = lo;
  for (const [a, b] of parts) {
    if (b <= end) continue;
    covered += b - Math.max(a, end);
    end = b;
  }
  return hi > lo ? covered / (hi - lo) : 0;
}

/** Axis-aligned segments inside the box: horizontal (at = y) and vertical (at = x) rulings. */
export function rulings(
  segs: Float32Array,
  box: [number, number, number, number],
): { h: Rule[]; v: Rule[] } {
  const [x0, y0, x1, y1] = box;
  const inX = (x: number) => x >= x0 - TOL && x <= x1 + TOL;
  const inY = (y: number) => y >= y0 - TOL && y <= y1 + TOL;
  const h: Rule[] = [];
  const v: Rule[] = [];
  for (let i = 0; i + 3 < segs.length; i += 4) {
    const ax = segs[i] ?? 0;
    const ay = segs[i + 1] ?? 0;
    const bx = segs[i + 2] ?? 0;
    const by = segs[i + 3] ?? 0;
    if (Math.abs(ay - by) < 0.5 && Math.abs(ax - bx) >= 3 && inY(ay)) {
      const from = Math.max(x0, Math.min(ax, bx));
      const to = Math.min(x1, Math.max(ax, bx));
      if (to - from >= 3) h.push({ at: (ay + by) / 2, from, to });
    } else if (Math.abs(ax - bx) < 0.5 && Math.abs(ay - by) >= 3 && inX(ax)) {
      const from = Math.max(y0, Math.min(ay, by));
      const to = Math.min(y1, Math.max(ay, by));
      if (to - from >= 3) v.push({ at: (ax + bx) / 2, from, to });
    }
  }
  return { h, v };
}

const near = (rules: readonly Rule[], at: number) =>
  rules.filter((r) => Math.abs(r.at - at) <= TOL);

/**
 * Merged cells from missing rulings: cells joined across unruled boundaries;
 * each joined group that is a rectangle becomes a merge.
 */
export function mergesFromRulings(
  cols: readonly number[],
  rows: readonly number[],
  h: readonly Rule[],
  v: readonly Rule[],
): Merge[] {
  const nr = rows.length - 1;
  const nc = cols.length - 1;
  const parent = Array.from({ length: nr * nc }, (_, i) => i);
  const find = (i: number): number => {
    let p = i;
    while (parent[p] !== p) p = parent[p] ?? p;
    return p;
  };
  const join = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  for (let r = 0; r < nr; r++)
    for (let c = 0; c < nc; c++) {
      const top = rows[r] ?? 0;
      const bottom = rows[r + 1] ?? 0;
      const left = cols[c] ?? 0;
      const right = cols[c + 1] ?? 0;
      if (c + 1 < nc && coverage(near(v, right), bottom, top) < COVERED)
        join(r * nc + c, r * nc + c + 1);
      if (r + 1 < nr && coverage(near(h, bottom), left, right) < COVERED)
        join(r * nc + c, (r + 1) * nc + c);
    }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < nr * nc; i++) {
    const g = groups.get(find(i)) ?? [];
    g.push(i);
    groups.set(find(i), g);
  }
  const merges: Merge[] = [];
  for (const cells of groups.values()) {
    if (cells.length < 2) continue;
    const rs = cells.map((i) => Math.floor(i / nc));
    const cs = cells.map((i) => i % nc);
    const r0 = Math.min(...rs);
    const c0 = Math.min(...cs);
    const m = { r: r0, c: c0, rs: Math.max(...rs) - r0 + 1, cs: Math.max(...cs) - c0 + 1 };
    if (m.rs * m.cs === cells.length) merges.push(m);
  }
  return normalizeMerges(merges, nr, nc);
}

const boxOf = (b: OxideBox): Box => [b.x, b.y, b.x + b.width, b.y + b.height];

/** Pages with more axis-aligned rulings than this (dense drawings) use Oxide's tables only. */
const MAX_RULES = 20_000;

type Box = [number, number, number, number];

/**
 * Ruled regions of a page: groups of horizontal and vertical rulings that
 * cross each other, with at least three distinct lines each way (2 × 2 cells
 * or more; a plain frame is not a table).
 */
export function ruledRegions(segs: Float32Array): Box[] {
  const { h, v } = rulings(segs, [-Infinity, -Infinity, Infinity, Infinity]);
  if (h.length + v.length > MAX_RULES) return [];
  const all = [...h.map((r) => ({ r, hz: true })), ...v.map((r) => ({ r, hz: false }))];
  const parent = all.map((_, i) => i);
  const find = (i: number): number => {
    let p = i;
    while (parent[p] !== p) p = parent[p] ?? p;
    return p;
  };
  // Vertical rulings sorted by x, so each horizontal one only checks those in its span.
  const vi = all.map((_, i) => i).filter((i) => !all[i]?.hz);
  vi.sort((a, b) => (all[a]?.r.at ?? 0) - (all[b]?.r.at ?? 0));
  const vx = vi.map((i) => all[i]?.r.at ?? 0);
  all.forEach((x, i) => {
    if (!x.hz) return;
    let lo = 0;
    let hi = vx.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if ((vx[m] ?? 0) < x.r.from - TOL) lo = m + 1;
      else hi = m;
    }
    for (let k = lo; k < vx.length && (vx[k] ?? 0) <= x.r.to + TOL; k++) {
      const j = vi[k] ?? 0;
      const y = all[j]?.r;
      if (y && x.r.at >= y.from - TOL && x.r.at <= y.to + TOL) parent[find(i)] = find(j);
    }
  });
  const groups = new Map<number, number[]>();
  all.forEach((_, i) => {
    const g = groups.get(find(i)) ?? [];
    g.push(i);
    groups.set(find(i), g);
  });
  const out: Box[] = [];
  for (const g of groups.values()) {
    const members = g.map((i) => all[i]).filter((x) => x !== undefined);
    const hs = members.filter((x) => x.hz).map((x) => x.r);
    const vs = members.filter((x) => !x.hz).map((x) => x.r);
    if (cluster(hs.map((r) => r.at)).length < 3 || cluster(vs.map((r) => r.at)).length < 3)
      continue;
    out.push([
      Math.min(...vs.map((r) => r.at)),
      Math.min(...hs.map((r) => r.at)),
      Math.max(...vs.map((r) => r.at)),
      Math.max(...hs.map((r) => r.at)),
    ]);
  }
  return out;
}

/** The grid of a ruled region: dividers where rulings run, merges where they are missing. */
export function gridInBox(page: number, box: Box, segs: Float32Array): TableGrid | null {
  const { h, v } = rulings(segs, box);
  const cols = cluster(v.map((r) => r.at));
  const rows = cluster(h.map((r) => r.at)).reverse();
  if (cols.length < 3 || rows.length < 3) return null;
  return {
    page,
    cols,
    rows,
    headerRows: 0,
    merges: mergesFromRulings(cols, rows, h, v),
    source: 'lattice',
  };
}

/**
 * The grid of one Oxide table (a table our ruling search did not find): from
 * the rulings in its box, else from its cell edges (each kept where at least
 * two cells agree, nothing merged). Null under 2 × 2 cells.
 */
export function latticeGrid(
  page: number,
  t: OxideTable,
  segs: Float32Array | null,
): TableGrid | null {
  const box = boxOf(t.bbox);
  const ruled = segs ? gridInBox(page, box, segs) : null;
  if (ruled) return ruled;
  const cells = t.rows.flatMap((r) => r.cells.map((c) => boxOf(c.bbox)));
  const edges = (vals: number[]) =>
    cluster(vals).filter((e) => vals.filter((x) => Math.abs(x - e) <= TOL).length >= 2);
  const cols = edges(cells.flatMap((c) => [c[0], c[2]]));
  const rows = edges(cells.flatMap((c) => [c[1], c[3]])).reverse();
  if (cols.length < 3 || rows.length < 3) return null;
  return { page, cols, rows, headerRows: 0, merges: [], source: 'lattice' };
}
