// Similarity transforms and their robust fit (M12-10, D-60; spike S28's
// route 1, our own code). A similarity maps x' = a·x − b·y + tx,
// y' = b·x + a·y + ty: one scale (hypot(a, b)), one rotation (atan2(b, a))
// and a shift — never an uneven stretch (D-60). Coordinates are a displayed
// page in points, y down. Pure functions: they run in the Compare worker.
import type { Affine } from '../material';

export interface Sim {
  a: number;
  b: number;
  tx: number;
  ty: number;
}

export const SIM_IDENTITY: Sim = { a: 1, b: 0, tx: 0, ty: 0 };

/** A similarity from its scale, rotation (degrees; clockwise as displayed, y down) and shift. */
export function simFrom(scale: number, deg: number, tx: number, ty: number): Sim {
  const r = (deg * Math.PI) / 180;
  return { a: scale * Math.cos(r), b: scale * Math.sin(r), tx, ty };
}

export const scaleOf = (s: Sim): number => Math.hypot(s.a, s.b);
export const degOf = (s: Sim): number => (Math.atan2(s.b, s.a) * 180) / Math.PI;

export function applySim(s: Sim, x: number, y: number): [number, number] {
  return [s.a * x - s.b * y + s.tx, s.b * x + s.a * y + s.ty];
}

/** First `p`, then `q`. */
export function thenSim(p: Sim, q: Sim): Sim {
  return {
    a: q.a * p.a - q.b * p.b,
    b: q.b * p.a + q.a * p.b,
    tx: q.a * p.tx - q.b * p.ty + q.tx,
    ty: q.b * p.tx + q.a * p.ty + q.ty,
  };
}

export function invertSim(s: Sim): Sim {
  const d = s.a * s.a + s.b * s.b;
  const a = s.a / d;
  const b = -s.b / d;
  return { a, b, tx: -(a * s.tx - b * s.ty), ty: -(b * s.tx + a * s.ty) };
}

/** The similarity as an affine map [a, b, c, d, e, f]. */
// `0 - b` keeps the identity's c a plain 0 (not −0).
export const simToAffine = (s: Sim): Affine => [s.a, s.b, 0 - s.b, s.a, s.tx, s.ty];

/** The similarity part of an affine map (exact when the map is one). */
export const affineToSim = (m: Affine): Sim => ({
  a: (m[0] + m[3]) / 2,
  b: (m[1] - m[2]) / 2,
  tx: m[4],
  ty: m[5],
});

/** Least-squares similarity src → dst (optionally over `idx` and weighted by `w`). */
export function fitSim(
  src: ArrayLike<number>,
  dst: ArrayLike<number>,
  idx?: ArrayLike<number>,
  w?: ArrayLike<number>,
): Sim | null {
  const n = idx ? idx.length : src.length / 2;
  if (n < 2) return null;
  let sw = 0;
  let mx = 0;
  let my = 0;
  let mu = 0;
  let mv = 0;
  for (let k = 0; k < n; k++) {
    const i = idx ? (idx[k] ?? 0) : k;
    const wi = w ? (w[i] ?? 1) : 1;
    sw += wi;
    mx += wi * (src[2 * i] ?? 0);
    my += wi * (src[2 * i + 1] ?? 0);
    mu += wi * (dst[2 * i] ?? 0);
    mv += wi * (dst[2 * i + 1] ?? 0);
  }
  if (sw <= 0) return null;
  mx /= sw;
  my /= sw;
  mu /= sw;
  mv /= sw;
  let sxx = 0;
  let sa = 0;
  let sb = 0;
  for (let k = 0; k < n; k++) {
    const i = idx ? (idx[k] ?? 0) : k;
    const wi = w ? (w[i] ?? 1) : 1;
    const x = (src[2 * i] ?? 0) - mx;
    const y = (src[2 * i + 1] ?? 0) - my;
    const u = (dst[2 * i] ?? 0) - mu;
    const v = (dst[2 * i + 1] ?? 0) - mv;
    sxx += wi * (x * x + y * y);
    sa += wi * (x * u + y * v);
    sb += wi * (x * v - y * u);
  }
  if (sxx < 1e-12) return null;
  const a = sa / sxx;
  const b = sb / sxx;
  return { a, b, tx: mu - (a * mx - b * my), ty: mv - (b * mx + a * my) };
}

/** Deterministic PRNG (mulberry32): the same sheets always align the same way. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RansacResult {
  sim: Sim;
  inliers: number[];
  rms: number;
}

export interface RansacOptions {
  threshold: number;
  iterations?: number;
  /** Hypotheses whose scale is outside [min, max] are rejected. */
  scaleRange?: [number, number];
  /** Hypotheses turned more than `maxDeg` degrees from `aroundDeg` (default 0) are rejected. */
  maxDeg?: number;
  aroundDeg?: number;
  seed?: number;
  weights?: ArrayLike<number>;
}

/**
 * RANSAC over putative correspondences src[i] ↔ dst[i] (two-point samples,
 * MSAC scoring), then least squares on the inliers until the inlier set is
 * stable. Null when fewer than 3 inliers agree.
 */
export function ransacSim(
  src: ArrayLike<number>,
  dst: ArrayLike<number>,
  opts: RansacOptions,
): RansacResult | null {
  const n = src.length / 2;
  if (n < 2) return null;
  const rand = rng(opts.seed ?? 1);
  const th2 = opts.threshold * opts.threshold;
  const iters = opts.iterations ?? 500;
  const [smin, smax] = opts.scaleRange ?? [0.05, 20];
  const maxDeg = opts.maxDeg ?? 180;
  const around = opts.aroundDeg ?? 0;
  const turnOff = (d: number): number => Math.abs(((((d - around) % 360) + 540) % 360) - 180);
  const w = opts.weights;
  const score = (s: Sim): number => {
    let sc = 0;
    for (let i = 0; i < n; i++) {
      const [x, y] = applySim(s, src[2 * i] ?? 0, src[2 * i + 1] ?? 0);
      const dx = x - (dst[2 * i] ?? 0);
      const dy = y - (dst[2 * i + 1] ?? 0);
      const d2 = dx * dx + dy * dy;
      if (d2 < th2) sc += (w ? (w[i] ?? 1) : 1) * (1 - d2 / th2);
    }
    return sc;
  };
  let best: Sim | null = null;
  let bestScore = -1;
  const pair = new Int32Array(2);
  for (let it = 0; it < iters; it++) {
    const i = Math.floor(rand() * n);
    let j = Math.floor(rand() * (n - 1));
    if (j >= i) j++;
    const dsx = (src[2 * i] ?? 0) - (src[2 * j] ?? 0);
    const dsy = (src[2 * i + 1] ?? 0) - (src[2 * j + 1] ?? 0);
    if (dsx * dsx + dsy * dsy < th2 * 4) continue; // too close to fix rotation and scale
    pair[0] = i;
    pair[1] = j;
    const s = fitSim(src, dst, pair);
    if (!s) continue;
    const k = scaleOf(s);
    if (k < smin || k > smax || turnOff(degOf(s)) > maxDeg) continue;
    const sc = score(s);
    if (sc > bestScore) {
      bestScore = sc;
      best = s;
    }
  }
  if (!best) return null;
  let inliers: number[] = [];
  for (let round = 0; round < 5; round++) {
    const next: number[] = [];
    for (let i = 0; i < n; i++) {
      const [x, y] = applySim(best, src[2 * i] ?? 0, src[2 * i + 1] ?? 0);
      const dx = x - (dst[2 * i] ?? 0);
      const dy = y - (dst[2 * i + 1] ?? 0);
      if (dx * dx + dy * dy < th2) next.push(i);
    }
    if (next.length < 3) return null;
    const refit = fitSim(src, dst, next, w);
    if (!refit) break;
    const same = next.length === inliers.length;
    inliers = next;
    best = refit;
    if (same) break;
  }
  let se = 0;
  for (const i of inliers) {
    const [x, y] = applySim(best, src[2 * i] ?? 0, src[2 * i + 1] ?? 0);
    se += (x - (dst[2 * i] ?? 0)) ** 2 + (y - (dst[2 * i + 1] ?? 0)) ** 2;
  }
  return { sim: best, inliers, rms: Math.sqrt(se / Math.max(1, inliers.length)) };
}

/**
 * How far an estimate is from another over a w × h page: the largest corner
 * displacement and the displacement of the centre (pt), the scale error (%)
 * and the rotation error (degrees).
 */
export function simError(
  est: Sim,
  truth: Sim,
  w: number,
  h: number,
): { shiftPt: number; maxPt: number; scalePct: number; deg: number } {
  const dist = (x: number, y: number): number => {
    const [ex, ey] = applySim(est, x, y);
    const [tx, ty] = applySim(truth, x, y);
    return Math.hypot(ex - tx, ey - ty);
  };
  let d = 0;
  for (const [x, y] of [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ] as const)
    d = Math.max(d, dist(x, y));
  let dDeg = degOf(est) - degOf(truth);
  if (dDeg > 180) dDeg -= 360;
  if (dDeg < -180) dDeg += 360;
  return {
    shiftPt: dist(w / 2, h / 2),
    maxPt: d,
    scalePct: (scaleOf(est) / scaleOf(truth) - 1) * 100,
    deg: dDeg,
  };
}
