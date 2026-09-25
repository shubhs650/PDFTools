// M0-S7 pure snapping logic (ARCHITECTURE §7.4, D-14). Geometry is a flat
// Float32Array of line segments [x1, y1, x2, y2, …] in PDF user space
// (curves are flattened on extraction). A uniform grid indexes segments by
// bounding box; queries return the best snap in CAD priority order:
// endpoint > intersection > midpoint > nearest point on a segment.

export type SnapKind = 'endpoint' | 'intersection' | 'midpoint' | 'nearest';

export interface Snap {
  kind: SnapKind;
  x: number;
  y: number;
  dist: number;
  /** Segment index (first segment for intersections). */
  seg: number;
}

export interface GridIndex {
  segs: Float32Array;
  x0: number;
  y0: number;
  cell: number;
  cols: number;
  rows: number;
  /** CSR layout: cellStart[c]..cellStart[c+1] indexes into items. */
  cellStart: Uint32Array;
  items: Uint32Array;
}

/** Transform a point by a PDF matrix [a b c d e f]. */
export function apply(m: ArrayLike<number>, x: number, y: number): [number, number] {
  return [
    (m[0] ?? 1) * x + (m[2] ?? 0) * y + (m[4] ?? 0),
    (m[1] ?? 0) * x + (m[3] ?? 1) * y + (m[5] ?? 0),
  ];
}

/** m1 then m2 (PDF row-vector convention): p' = p × m1 × m2. */
export function concat(m1: ArrayLike<number>, m2: ArrayLike<number>): number[] {
  const [a1 = 1, b1 = 0, c1 = 0, d1 = 1, e1 = 0, f1 = 0] = Array.from(m1);
  const [a2 = 1, b2 = 0, c2 = 0, d2 = 1, e2 = 0, f2 = 0] = Array.from(m2);
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

/**
 * Flatten a cubic Bézier into line pieces, enough that the chord error stays
 * under ~`tol` (points), capped at 64 pieces.
 */
export function flattenCubic(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  tol = 0.25,
): [number, number][] {
  const dd = Math.max(
    Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]),
    Math.hypot(p1[0] - 2 * p2[0] + p3[0], p1[1] - 2 * p2[1] + p3[1]),
  );
  const n = Math.min(64, Math.max(1, Math.ceil(Math.sqrt((0.75 * dd) / tol))));
  const out: [number, number][] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

/** Build a uniform grid. `targetPerCell` ≈ average segments per cell. */
export function buildGrid(segs: Float32Array, targetPerCell = 8): GridIndex {
  const n = segs.length / 4;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < segs.length; i += 2) {
    const x = segs[i] ?? 0;
    const y = segs[i + 1] ?? 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (n === 0) {
    x0 = y0 = 0;
    x1 = y1 = 1;
  }
  const w = Math.max(1e-6, x1 - x0);
  const h = Math.max(1e-6, y1 - y0);
  const cells = Math.max(1, Math.min(1 << 20, Math.ceil(n / targetPerCell)));
  const cell = Math.max(1e-3, Math.sqrt((w * h) / cells));
  const cols = Math.max(1, Math.ceil(w / cell) + 1);
  const rows = Math.max(1, Math.ceil(h / cell) + 1);
  const cellOf = (v: number, o: number, max: number): number =>
    Math.min(max - 1, Math.max(0, Math.floor((v - o) / cell)));
  // Pass 1: count; pass 2: fill (CSR).
  const counts = new Uint32Array(cols * rows + 1);
  const forEachCell = (i: number, fn: (c: number) => void): void => {
    const ax = segs[i * 4] ?? 0;
    const ay = segs[i * 4 + 1] ?? 0;
    const bx = segs[i * 4 + 2] ?? 0;
    const by = segs[i * 4 + 3] ?? 0;
    const cx0 = cellOf(Math.min(ax, bx), x0, cols);
    const cx1 = cellOf(Math.max(ax, bx), x0, cols);
    const cy0 = cellOf(Math.min(ay, by), y0, rows);
    const cy1 = cellOf(Math.max(ay, by), y0, rows);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) fn(cy * cols + cx);
  };
  for (let i = 0; i < n; i++) {
    forEachCell(i, (c) => {
      counts[c + 1] = (counts[c + 1] ?? 0) + 1;
    });
  }
  for (let c = 1; c < counts.length; c++) counts[c] = (counts[c] ?? 0) + (counts[c - 1] ?? 0);
  const items = new Uint32Array(counts[counts.length - 1] ?? 0);
  const fill = counts.slice(0, -1);
  for (let i = 0; i < n; i++) {
    forEachCell(i, (c) => {
      items[fill[c] ?? 0] = i;
      fill[c] = (fill[c] ?? 0) + 1;
    });
  }
  return { segs, x0, y0, cell, cols, rows, cellStart: counts, items };
}

/** Segment indices whose cells overlap the square (x±r, y±r), deduplicated. */
export function candidates(
  g: GridIndex,
  x: number,
  y: number,
  r: number,
  seen?: Uint32Array,
  stamp = 1,
): number[] {
  const out: number[] = [];
  const cx0 = Math.max(0, Math.floor((x - r - g.x0) / g.cell));
  const cx1 = Math.min(g.cols - 1, Math.floor((x + r - g.x0) / g.cell));
  const cy0 = Math.max(0, Math.floor((y - r - g.y0) / g.cell));
  const cy1 = Math.min(g.rows - 1, Math.floor((y + r - g.y0) / g.cell));
  const local = seen ? undefined : new Set<number>();
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = cy * g.cols + cx;
      for (let k = g.cellStart[c] ?? 0; k < (g.cellStart[c + 1] ?? 0); k++) {
        const s = g.items[k] ?? 0;
        if (seen) {
          if (seen[s] === stamp) continue;
          seen[s] = stamp;
        } else if (local) {
          if (local.has(s)) continue;
          local.add(s);
        }
        out.push(s);
      }
    }
  }
  return out;
}

function nearestOnSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  x: number,
  y: number,
): [number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
  return [ax + t * dx, ay + t * dy];
}

/** Proper intersection point of two segments, or null (parallel/none). */
export function intersect(s: ArrayLike<number>, i: number, j: number): [number, number] | null {
  const ax = s[i * 4] ?? 0;
  const ay = s[i * 4 + 1] ?? 0;
  const bx = s[i * 4 + 2] ?? 0;
  const by = s[i * 4 + 3] ?? 0;
  const cx = s[j * 4] ?? 0;
  const cy = s[j * 4 + 1] ?? 0;
  const dx = s[j * 4 + 2] ?? 0;
  const dy = s[j * 4 + 3] ?? 0;
  const rx = bx - ax;
  const ry = by - ay;
  const qx = dx - cx;
  const qy = dy - cy;
  const den = rx * qy - ry * qx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((cx - ax) * qy - (cy - ay) * qx) / den;
  const u = ((cx - ax) * ry - (cy - ay) * rx) / den;
  const eps = 1e-9;
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
  return [ax + t * rx, ay + t * ry];
}

const RANK: Record<SnapKind, number> = { endpoint: 0, intersection: 1, midpoint: 2, nearest: 3 };

/**
 * Best snap within `r` of (x, y). Higher-priority kinds win over closer
 * lower-priority ones; ties broken by distance. `maxPairs` bounds the
 * intersection work in very dense areas.
 */
export function snap(
  g: GridIndex,
  x: number,
  y: number,
  r: number,
  maxPairs = 2048,
  seen?: Uint32Array,
  stamp?: number,
): Snap | null {
  const cand = candidates(g, x, y, r, seen, stamp);
  const s = g.segs;
  let best: Snap | null = null;
  const offer = (kind: SnapKind, px: number, py: number, seg: number): void => {
    const d = Math.hypot(px - x, py - y);
    if (d > r) return;
    if (
      !best ||
      RANK[kind] < RANK[best.kind] ||
      (RANK[kind] === RANK[best.kind] && d < best.dist)
    ) {
      best = { kind, x: px, y: py, dist: d, seg };
    }
  };
  // Segments actually within r (nearest distance), used for all kinds.
  const near: number[] = [];
  for (const i of cand) {
    const ax = s[i * 4] ?? 0;
    const ay = s[i * 4 + 1] ?? 0;
    const bx = s[i * 4 + 2] ?? 0;
    const by = s[i * 4 + 3] ?? 0;
    const [nx, ny] = nearestOnSegment(ax, ay, bx, by, x, y);
    if (Math.hypot(nx - x, ny - y) > r) continue;
    near.push(i);
    offer('endpoint', ax, ay, i);
    offer('endpoint', bx, by, i);
    offer('midpoint', (ax + bx) / 2, (ay + by) / 2, i);
    offer('nearest', nx, ny, i);
  }
  // Intersections among nearby segments (skip shared endpoints: already endpoints).
  let pairs = 0;
  outer: for (let a = 0; a < near.length; a++) {
    for (let b = a + 1; b < near.length; b++) {
      if (++pairs > maxPairs) break outer;
      const p = intersect(s, near[a] ?? 0, near[b] ?? 0);
      if (p) offer('intersection', p[0], p[1], near[a] ?? 0);
    }
  }
  return best;
}
