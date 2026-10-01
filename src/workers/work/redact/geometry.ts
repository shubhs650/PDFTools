// Re-cutting paths that cross a redacted rectangle (M4-17, ADR-017 decision 3):
// pure geometry. PDFium's redaction removes paths wholly inside a rectangle
// but keeps every path that crosses one; we replace such a path by the parts
// of it outside the rectangles, through PDFium's page-object API (pathRecut.ts;
// no content stream is written by us, ADR-001 B8).
//   - Strokes: each segment cut where it enters/leaves a rectangle grown by
//     the stroke's reach (half the width, more for square caps and miters);
//     lines by Liang–Barsky, cubic Béziers exactly (de Casteljau at the
//     parameters where the curve crosses the rectangle's edges).
//   - Fills: the area outside a rectangle is four convex regions (left,
//     right, below, above); clipping every subpath to a convex region keeps
//     each point's winding number inside it, so one object per region with
//     the original fill rule paints exactly the original fill there. Curves
//     are flattened for fills (tolerance FLAT_TOL).
// Coordinates are page space (points); rects are [x0, y0, x1, y1].

export type Pt = [number, number];
export type Rect = [number, number, number, number];

export type Seg = { kind: 'line'; to: Pt } | { kind: 'cubic'; c1: Pt; c2: Pt; to: Pt };

export interface Subpath {
  start: Pt;
  segs: Seg[];
  closed: boolean;
}

/** Fill flattening tolerance (points). */
export const FLAT_TOL = 0.05;

const EPS = 1e-9;

export const overlaps = (a: Rect, b: Rect): boolean =>
  a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

export const grow = (r: Rect, d: number): Rect => [r[0] - d, r[1] - d, r[2] + d, r[3] + d];

const inside = (p: Pt, r: Rect): boolean =>
  p[0] > r[0] && p[0] < r[2] && p[1] > r[1] && p[1] < r[3];

const lerp = (p: Pt, q: Pt, t: number): Pt => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];

/** Bounding box of a subpath's points (control points included: a superset). */
export function bounds(subs: readonly Subpath[]): Rect {
  let b: Rect = [Infinity, Infinity, -Infinity, -Infinity];
  const add = (p: Pt) => {
    b = [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])];
  };
  for (const s of subs) {
    add(s.start);
    for (const g of s.segs) {
      if (g.kind === 'cubic') {
        add(g.c1);
        add(g.c2);
      }
      add(g.to);
    }
  }
  return b;
}

// ---- cubic Béziers -------------------------------------------------------------------

export function cubicAt(p0: Pt, c1: Pt, c2: Pt, p3: Pt, t: number): Pt {
  const s = 1 - t;
  const a = s * s * s;
  const b = 3 * s * s * t;
  const c = 3 * s * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * c1[0] + c * c2[0] + d * p3[0],
    a * p0[1] + b * c1[1] + c * c2[1] + d * p3[1],
  ];
}

/** The piece of a cubic between t0 and t1, exactly (two de Casteljau splits). */
export function cubicPiece(
  p0: Pt,
  c1: Pt,
  c2: Pt,
  p3: Pt,
  t0: number,
  t1: number,
): [Pt, Pt, Pt, Pt] {
  const split = (a: Pt, b: Pt, c: Pt, d: Pt, t: number) => {
    const ab = lerp(a, b, t);
    const bc = lerp(b, c, t);
    const cd = lerp(c, d, t);
    const abc = lerp(ab, bc, t);
    const bcd = lerp(bc, cd, t);
    const m = lerp(abc, bcd, t);
    return {
      left: [a, ab, abc, m] as [Pt, Pt, Pt, Pt],
      right: [m, bcd, cd, d] as [Pt, Pt, Pt, Pt],
    };
  };
  // Right part from t0, then its left part up to (t1 − t0)/(1 − t0).
  const r = t0 > EPS ? split(p0, c1, c2, p3, t0).right : ([p0, c1, c2, p3] as [Pt, Pt, Pt, Pt]);
  if (t1 >= 1 - EPS) return r;
  const u = (t1 - t0) / (1 - t0);
  return split(r[0], r[1], r[2], r[3], u).left;
}

/** Real roots in [0, 1] of a·t³ + b·t² + c·t + d. */
export function cubicRoots(a: number, b: number, c: number, d: number): number[] {
  const out: number[] = [];
  const keep = (t: number) => {
    if (t >= -EPS && t <= 1 + EPS) out.push(Math.min(1, Math.max(0, t)));
  };
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d), 1e-300);
  if (Math.abs(a) / scale < 1e-12) {
    if (Math.abs(b) / scale < 1e-12) {
      if (Math.abs(c) / scale > 1e-12) keep(-d / c);
      return out;
    }
    const disc = c * c - 4 * b * d;
    if (disc < 0) return out;
    const sq = Math.sqrt(disc);
    keep((-c + sq) / (2 * b));
    keep((-c - sq) / (2 * b));
    return out;
  }
  // Depressed cubic t = x − B/3.
  const B = b / a;
  const C = c / a;
  const D = d / a;
  const p = C - (B * B) / 3;
  const q = (2 * B * B * B) / 27 - (B * C) / 3 + D;
  const off = -B / 3;
  const disc = (q * q) / 4 + (p * p * p) / 27;
  if (disc > 1e-14) {
    const sq = Math.sqrt(disc);
    keep(Math.cbrt(-q / 2 + sq) + Math.cbrt(-q / 2 - sq) + off);
  } else if (disc < -1e-14) {
    const r = Math.sqrt((-p * p * p) / 27);
    const phi = Math.acos(Math.max(-1, Math.min(1, -q / (2 * r))));
    const m = 2 * Math.cbrt(r);
    for (let k = 0; k < 3; k++) keep(m * Math.cos((phi + 2 * Math.PI * k) / 3) + off);
  } else {
    const u = Math.cbrt(-q / 2);
    keep(2 * u + off);
    keep(-u + off);
  }
  return out;
}

/** Parameters where the cubic's x (axis 0) or y (axis 1) equals v. */
function crossings(p0: Pt, c1: Pt, c2: Pt, p3: Pt, axis: 0 | 1, v: number): number[] {
  const a = -p0[axis] + 3 * c1[axis] - 3 * c2[axis] + p3[axis];
  const b = 3 * p0[axis] - 6 * c1[axis] + 3 * c2[axis];
  const c = -3 * p0[axis] + 3 * c1[axis];
  const d = p0[axis] - v;
  return cubicRoots(a, b, c, d);
}

// ---- strokes ----------------------------------------------------------------------------

/** Parameter ranges [t0, t1] of a segment from p that lie outside every rect. */
export function outsideRanges(p: Pt, seg: Seg, rects: readonly Rect[]): [number, number][] {
  const ts = new Set<number>([0, 1]);
  for (const r of rects) {
    if (seg.kind === 'line') {
      const q = seg.to;
      for (const [axis, v] of [
        [0, r[0]],
        [0, r[2]],
        [1, r[1]],
        [1, r[3]],
      ] as const) {
        const den = q[axis] - p[axis];
        if (Math.abs(den) > EPS) {
          const t = (v - p[axis]) / den;
          if (t > EPS && t < 1 - EPS) ts.add(t);
        }
      }
    } else
      for (const [axis, v] of [
        [0, r[0]],
        [0, r[2]],
        [1, r[1]],
        [1, r[3]],
      ] as const)
        for (const t of crossings(p, seg.c1, seg.c2, seg.to, axis, v))
          if (t > EPS && t < 1 - EPS) ts.add(t);
  }
  const sorted = [...ts].sort((a, b) => a - b);
  const at = (t: number): Pt =>
    seg.kind === 'line' ? lerp(p, seg.to, t) : cubicAt(p, seg.c1, seg.c2, seg.to, t);
  const out: [number, number][] = [];
  for (let i = 1; i < sorted.length; i++) {
    const t0 = sorted[i - 1] ?? 0;
    const t1 = sorted[i] ?? 1;
    if (t1 - t0 < EPS) continue;
    const mid = at((t0 + t1) / 2);
    if (rects.some((r) => inside(mid, r))) continue;
    const last = out.at(-1);
    if (last && Math.abs(last[1] - t0) < EPS) last[1] = t1;
    else out.push([t0, t1]);
  }
  return out;
}

/**
 * The stroke of `sub` with everything inside `rects` cut out: open subpaths,
 * curves kept as exact sub-curves. A closed subpath not touching any rect is
 * returned unchanged.
 */
export function clipStroke(sub: Subpath, rects: readonly Rect[]): Subpath[] {
  const segs: Seg[] = [...sub.segs];
  const end = segs.at(-1)?.to ?? sub.start;
  if (sub.closed && (end[0] !== sub.start[0] || end[1] !== sub.start[1]))
    segs.push({ kind: 'line', to: sub.start });
  const out: Subpath[] = [];
  let cur: Subpath | null = null;
  let whole = true;
  let p = sub.start;
  for (const seg of segs) {
    const ranges = outsideRanges(p, seg, rects);
    if (!(ranges.length === 1 && ranges[0]?.[0] === 0 && ranges[0][1] === 1)) whole = false;
    for (const [t0, t1] of ranges) {
      if (seg.kind === 'line') {
        const a = lerp(p, seg.to, t0);
        const b = lerp(p, seg.to, t1);
        if (!cur || t0 > EPS) {
          cur = { start: a, segs: [], closed: false };
          out.push(cur);
        }
        cur.segs.push({ kind: 'line', to: b });
      } else {
        const [a, c1, c2, b] = cubicPiece(p, seg.c1, seg.c2, seg.to, t0, t1);
        if (!cur || t0 > EPS) {
          cur = { start: a, segs: [], closed: false };
          out.push(cur);
        }
        cur.segs.push({ kind: 'cubic', c1, c2, to: b });
      }
      if (t1 < 1 - EPS) cur = null;
    }
    if (ranges.length === 0) cur = null;
    p = seg.to;
  }
  if (whole) return [sub];
  // A closed outline cut once: join its last piece to its first.
  const first = out[0];
  const last = out.at(-1);
  if (
    sub.closed &&
    out.length > 1 &&
    first &&
    last &&
    Math.abs(first.start[0] - sub.start[0]) < EPS &&
    Math.abs(first.start[1] - sub.start[1]) < EPS
  ) {
    const lastEnd = last.segs.at(-1)?.to;
    if (
      lastEnd &&
      Math.abs(lastEnd[0] - sub.start[0]) < EPS &&
      Math.abs(lastEnd[1] - sub.start[1]) < EPS
    ) {
      last.segs.push(...first.segs);
      out.shift();
    }
  }
  return out.filter((s) => s.segs.length > 0);
}

// ---- fills -----------------------------------------------------------------------------

/** A subpath as a closed polygon (cubics flattened to FLAT_TOL). */
export function flatten(sub: Subpath, tol = FLAT_TOL): Pt[] {
  const pts: Pt[] = [sub.start];
  let p = sub.start;
  for (const seg of sub.segs) {
    if (seg.kind === 'line') pts.push(seg.to);
    else {
      // Segments from the control polygon's length: error ≤ tol for these curves.
      const len =
        Math.hypot(seg.c1[0] - p[0], seg.c1[1] - p[1]) +
        Math.hypot(seg.c2[0] - seg.c1[0], seg.c2[1] - seg.c1[1]) +
        Math.hypot(seg.to[0] - seg.c2[0], seg.to[1] - seg.c2[1]);
      const n = Math.min(512, Math.max(2, Math.ceil(Math.sqrt(len / tol))));
      for (let k = 1; k <= n; k++) pts.push(cubicAt(p, seg.c1, seg.c2, seg.to, k / n));
    }
    p = seg.to;
  }
  return pts;
}

/** Sutherland–Hodgman against the half-plane a·x + b·y + c ≥ 0. */
function clipHalf(poly: Pt[], a: number, b: number, c: number): Pt[] {
  const out: Pt[] = [];
  const f = (q: Pt) => a * q[0] + b * q[1] + c;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] ?? [0, 0];
    const q = poly[(i + 1) % poly.length] ?? [0, 0];
    const fp = f(p);
    const fq = f(q);
    if (fp >= 0) out.push(p);
    if (fp >= 0 !== fq >= 0) out.push(lerp(p, q, fp / (fp - fq)));
  }
  return out;
}

/** The four convex regions outside rect r: x ≤ x0, x ≥ x1, below, above (between x0 and x1). */
const REGIONS = (r: Rect): ((p: Pt[]) => Pt[])[] => {
  const [x0, y0, x1, y1] = r;
  const band = (p: Pt[]) => clipHalf(clipHalf(p, 1, 0, -x0), -1, 0, x1);
  return [
    (p) => clipHalf(p, -1, 0, x0),
    (p) => clipHalf(p, 1, 0, -x1),
    (p) => clipHalf(band(p), 0, -1, y0),
    (p) => clipHalf(band(p), 0, 1, -y1),
  ];
};

/**
 * The fill of `polys` (closed polygons, one fill rule) minus every rect: a
 * list of polygon groups, each group to be filled with the original rule.
 */
export function clipFill(polys: readonly Pt[][], rects: readonly Rect[]): Pt[][][] {
  let groups: Pt[][][] = [polys.map((p) => [...p])];
  for (const r of rects) {
    const next: Pt[][][] = [];
    for (const g of groups) {
      if (!overlaps(polyBounds(g), r)) {
        next.push(g);
        continue;
      }
      for (const region of REGIONS(r)) {
        const clipped = g.map(region).filter((p) => p.length >= 3 && Math.abs(area(p)) > 1e-6);
        if (clipped.length) next.push(clipped);
      }
    }
    groups = next;
  }
  return groups;
}

function polyBounds(polys: readonly Pt[][]): Rect {
  let b: Rect = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of polys)
    for (const q of p)
      b = [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[0]), Math.max(b[3], q[1])];
  return b;
}

export function area(p: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i] ?? [0, 0];
    const b = p[(i + 1) % p.length] ?? [0, 0];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** How far a stroke reaches beyond its centre line (points). */
export function strokeReach(width: number, cap: number, join: number, miterLimit = 10): number {
  const half = width / 2;
  // Square caps reach half the width further along the line (√2 at a corner);
  // miter joins up to min(miterLimit, 4) × half (sharper spikes are rare and thin);
  // a small margin for antialiasing.
  const capReach = cap === 2 ? half * Math.SQRT2 : half;
  const joinReach = join === 0 ? half * Math.min(miterLimit, 4) : half;
  return Math.max(capReach, joinReach) + 0.5;
}
