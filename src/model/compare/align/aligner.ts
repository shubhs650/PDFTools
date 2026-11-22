// Automatic alignment of a sheet pair (M12-10, D-60) on spike S28's route 1,
// our own code (ADR-032: OpenCV is not used). Pure maths: it runs in the
// Compare worker on material the Work worker read.
//
//   as is    the share of A's feature points (line ends, corners, junctions)
//            with a feature of B within 0.1 pt, with no transform; ≥ 0.3
//            means the sheets already line up (S28: a raster score cannot
//            tell a 1 pt move from none).
//   coarse   Fourier–Mellin on a small ink raster (Reddy & Chatterji 1996):
//            the magnitude spectrum's log-polar form turns rotation and scale
//            into a shift, found by phase correlation; then phase correlation
//            again for the shift. Searched near 0° and, for a sheet drawn a
//            quarter turn round, near 90° (ADR-032's known gap).
//   vector   the features matched with RANSAC to a similarity and refined by
//            closest-point least squares, coarse to fine.
//   image    scans: tile phase correlation on finer rasters (0.5, 1 and
//            2 px per pt), each tile one displacement, RANSAC over the tiles.
//
// Every result is a similarity from A's displayed page to B's (pt, y down):
// the old revision drawn in the new revision's frame. /Rotate and the page
// boxes are already in the displayed spaces (material.ts), so pages that
// differ only there line up as they are.
import type { Affine } from '../material';
import { fft2, nextPow2, phaseCorrelate, type Peak } from './fft';
import { resample, sample, shrink, warp, inkShare, type Ink } from './ink';
import { PointGrid } from './pointGrid';
import {
  SIM_IDENTITY,
  affineToSim,
  applySim,
  degOf,
  fitSim,
  invertSim,
  ransacSim,
  scaleOf,
  simFrom,
  simToAffine,
  thenSim,
  type Sim,
} from './similarity';

/** Feature agreement at or above which a sheet is used as it is (S28). */
export const AS_IS_AGREEMENT = 0.3;
/** Distance (pt) within which a feature of B agrees with one of A for the as-is check (S28). */
export const AS_IS_RADIUS = 0.1;
/** Fewer feature points than this on either page: the image method (a scan, or next to none). */
export const MIN_FEATURES = 24;
/** Share of A's features matched within 0.5 pt below which a vector alignment is low confidence (S28). */
export const LOW_SHARE = 0.3;
/** Agreeing tiles below which an image alignment is low confidence (S28). */
export const MIN_TILES = 6;
/** Canvas of the coarse step (S28: 512 × 512). */
export const COARSE_CANVAS = 512;
/** Finest level of the image method, px per pt (S28: 0.5, 1 and 2). */
export const IMAGE_SCALE = 2;
/** The image method's rasters stay under this many pixels per page (an ARCH E sheet at 2 px/pt is 36 MP). */
export const IMAGE_MAX_PIXELS = 48_000_000;

/** As is, aligned automatically, low confidence (needs points), or set by hand (M12-13). */
export type AlignStatus = 'as-is' | 'auto' | 'low' | 'manual';

/** A sheet's alignment and how sure it is (D-60: the status per sheet). */
export interface SheetAlignment {
  status: AlignStatus;
  /** Vector geometry, or the image method (scans, pages with next to no line work). */
  method: 'vector' | 'image';
  /** A's displayed page → B's displayed page (pt). */
  place: Affine;
  /** Vector: share of A's features with a B feature within 0.5 pt. Image: tiles agreeing. */
  score: number;
}

/** The values shown for an alignment: shift (pt), one scale and a rotation (degrees). */
export function alignmentValues(place: Affine): {
  dx: number;
  dy: number;
  scale: number;
  deg: number;
} {
  const s = affineToSim(place);
  return { dx: s.tx, dy: s.ty, scale: scaleOf(s), deg: degOf(s) };
}

// ---------------------------------------------------------------- coarse ---

export interface CoarseInput {
  /** Both pages' ink at the same px-per-pt scale, each no larger than the canvas. */
  a: Ink;
  b: Ink;
  /** Pixels per pt of both rasters. */
  scale: number;
}

export interface CoarseOptions {
  /** Canvas size (power of two). */
  n?: number;
  /** Largest rotation searched either side of `around`, degrees. */
  maxDeg?: number;
  /** Centre of the rotation search: 0, or 90 for a sheet drawn a quarter turn round. */
  around?: 0 | 90;
  scaleRange?: [number, number];
}

export interface Coarse {
  sim: Sim;
  /** Peak of the final shift's phase correlation (0…1) and its ratio to the next peak. */
  peak: number;
  ratio: number;
  /** pt per canvas pixel. */
  ptPerPx: number;
}

/** The coarse raster scale for two frames (S28: the larger page fills 90 % of the canvas). */
export function coarseScale(
  a: { width: number; height: number },
  b: { width: number; height: number },
  n = COARSE_CANVAS,
): number {
  return (0.9 * n) / Math.max(a.width, a.height, b.width, b.height, 1);
}

function centred(ink: Ink, n: number): { img: Float64Array; ox: number; oy: number } {
  const img = new Float64Array(n * n);
  const ox = Math.floor((n - ink.w) / 2);
  const oy = Math.floor((n - ink.h) / 2);
  for (let y = 0; y < ink.h; y++) {
    const yy = y + oy;
    if (yy < 0 || yy >= n) continue;
    for (let x = 0; x < ink.w; x++) {
      const xx = x + ox;
      if (xx < 0 || xx >= n) continue;
      img[yy * n + xx] = (ink.data[y * ink.w + x] ?? 0) / 255;
    }
  }
  return { img, ox, oy };
}

/** High-passed log magnitude spectrum, zero frequency in the centre. */
function spectrum(img: Float64Array, n: number): Float64Array {
  const re = Float64Array.from(img);
  const im = new Float64Array(img.length);
  // Hann window against the canvas edges.
  for (let y = 0; y < n; y++) {
    const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * y) / n);
    for (let x = 0; x < n; x++)
      re[y * n + x] = (re[y * n + x] ?? 0) * wy * (0.5 - 0.5 * Math.cos((2 * Math.PI * x) / n));
  }
  fft2(re, im, n, n);
  const out = new Float64Array(n * n);
  const h = n / 2;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const sx = (x + h) % n;
      const sy = (y + h) % n;
      const c = Math.cos((Math.PI * (sx - h)) / n) * Math.cos((Math.PI * (sy - h)) / n);
      const hp = (1 - c) * (2 - c);
      const i = y * n + x;
      out[sy * n + sx] = hp * Math.log1p(Math.hypot(re[i] ?? 0, im[i] ?? 0));
    }
  }
  return out;
}

/** Log-polar resampling of a centred spectrum over θ ∈ [0, π). */
function logPolar(
  spec: Float64Array,
  n: number,
  nT: number,
  nR: number,
  rMin: number,
  rMax: number,
): Float64Array {
  const out = new Float64Array(nT * nR);
  const base = Math.log(rMax / rMin) / nR;
  const c = n / 2;
  for (let t = 0; t < nT; t++) {
    const th = (Math.PI * t) / nT;
    const ct = Math.cos(th);
    const st = Math.sin(th);
    for (let r = 0; r < nR; r++) {
      const rad = rMin * Math.exp(base * r);
      out[t * nR + r] = sample(spec, n, n, c + rad * ct, c - rad * st);
    }
  }
  return out;
}

const subPixel = (l: number, m: number, r: number): number => {
  const d = l - 2 * m + r;
  return Math.abs(d) < 1e-12 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / d));
};

/** Coarse similarity A → B (displayed pt) by Fourier–Mellin. */
export function coarseAlign(input: CoarseInput, o: CoarseOptions = {}): Coarse {
  const n = o.n ?? nextPow2(Math.max(input.a.w, input.a.h, input.b.w, input.b.h));
  const maxDeg = o.maxDeg ?? 10;
  const [smin, smax] = o.scaleRange ?? [0.25, 4];
  const A = centred(input.a, n);
  const B = centred(input.b, n);
  const nT = 512;
  const nR = 256;
  const rMin = 3;
  const rMax = n / 2 - 2;
  const ar = logPolar(spectrum(A.img, n), n, nT, nR, rMin, rMax);
  const br = logPolar(spectrum(B.img, n), n, nT, nR, rMin, rMax);
  const ai = new Float64Array(ar.length);
  const bi = new Float64Array(br.length);
  fft2(ar, ai, nR, nT);
  fft2(br, bi, nR, nT);
  for (let i = 0; i < ar.length; i++) {
    const xr = (br[i] ?? 0) * (ar[i] ?? 0) + (bi[i] ?? 0) * (ai[i] ?? 0);
    const xi = (bi[i] ?? 0) * (ar[i] ?? 0) - (br[i] ?? 0) * (ai[i] ?? 0);
    const m = Math.hypot(xr, xi) + 1e-12;
    ar[i] = xr / m;
    ai[i] = xi / m;
  }
  fft2(ar, ai, nR, nT, true);
  const base = Math.log(rMax / rMin) / nR;
  const tMax = Math.ceil((maxDeg / 180) * nT);
  const tMid = o.around === 90 ? nT / 2 : 0;
  // Scale s shrinks B's spectrum by 1/s: the radial shift is −ln(s)/base.
  const rLo = Math.floor(-Math.log(smax) / base);
  const rHi = Math.ceil(-Math.log(smin) / base);
  const at = (t: number, r: number): number =>
    ar[(((t % nT) + nT) % nT) * nR + (((r % nR) + nR) % nR)] ?? 0;
  let best = -Infinity;
  let bt = 0;
  let br0 = 0;
  for (let dt = tMid - tMax; dt <= tMid + tMax; dt++) {
    for (let dr = rLo; dr <= rHi; dr++) {
      const v = at(dt, dr);
      if (v > best) {
        best = v;
        bt = dt;
        br0 = dr;
      }
    }
  }
  const dt = bt + subPixel(at(bt - 1, br0), at(bt, br0), at(bt + 1, br0));
  const dr = br0 + subPixel(at(bt, br0 - 1), at(bt, br0), at(bt, br0 + 1));
  const scale = Math.exp(-dr * base);
  // A spectrum turned by θ belongs to an image turned by θ. In y-down pixels
  // the log-polar θ runs counter-clockwise, so the image angle is −θ; the
  // spectrum cannot tell θ from θ + 180°, so both are tried.
  const deg = (-dt * 180) / nT;
  let bestPeak: Peak | null = null;
  let bestSim: Sim = SIM_IDENTITY;
  const c = n / 2;
  for (const d of [deg, deg + 180]) {
    const rs = simFrom(scale, d, 0, 0);
    const [cx, cy] = applySim(rs, c, c);
    const about: Sim = { ...rs, tx: c - cx, ty: c - cy };
    const wa = warp(A.img, n, n, about, n, n);
    const p = phaseCorrelate(wa, B.img, n, n);
    if (!bestPeak || p.peak > bestPeak.peak) {
      bestPeak = p;
      bestSim = thenSim(about, { a: 1, b: 0, tx: p.dx, ty: p.dy });
    }
  }
  // Canvas px → displayed pt: pt = (px − o) / s.
  const s = input.scale;
  const toPxA: Sim = { a: s, b: 0, tx: A.ox, ty: A.oy };
  const fromPxB: Sim = { a: 1 / s, b: 0, tx: -B.ox / s, ty: -B.oy / s };
  const sim = thenSim(thenSim(toPxA, bestSim), fromPxB);
  return { sim, peak: bestPeak?.peak ?? 0, ratio: bestPeak?.ratio ?? 0, ptPerPx: 1 / s };
}

// ---------------------------------------------------------------- vector ---

/**
 * Feature points of a page's line geometry (segments [x1, y1, x2, y2, …],
 * displayed pt): line ends, corners and junctions. A point where exactly two
 * segments meet almost in line (inside a flattened curve) is not a feature.
 */
export function features(segs: ArrayLike<number>, minTurnDeg = 25): Float64Array {
  const ends = new Map<number, { x: number; y: number; d0: number; d1: number; n: number }>();
  // Points snapped to a 0.05 pt grid; the key packs both coordinates.
  const key = (x: number, y: number): number => Math.round(x * 20) * 4_194_304 + Math.round(y * 20);
  const add = (x: number, y: number, dx: number, dy: number): void => {
    const k = key(x, y);
    const d = Math.atan2(dy, dx);
    const e = ends.get(k);
    if (!e) ends.set(k, { x, y, d0: d, d1: 0, n: 1 });
    else {
      if (e.n === 1) e.d1 = d;
      e.n++;
    }
  };
  for (let i = 0; i + 3 < segs.length; i += 4) {
    const ax = segs[i] ?? 0;
    const ay = segs[i + 1] ?? 0;
    const bx = segs[i + 2] ?? 0;
    const by = segs[i + 3] ?? 0;
    if (Math.hypot(bx - ax, by - ay) < 0.2) continue;
    add(ax, ay, bx - ax, by - ay);
    add(bx, by, ax - bx, ay - by);
  }
  const cos = Math.cos((minTurnDeg * Math.PI) / 180);
  const out: number[] = [];
  for (const e of ends.values()) {
    // Two directions leaving the point almost opposite: a straight run.
    if (e.n === 2 && Math.cos(e.d0 - e.d1) < -cos) continue;
    out.push(e.x, e.y);
  }
  return Float64Array.from(out);
}

/**
 * A spatially balanced subset: at most `perCell` points per cell of a grid
 * `cells` wide, so a dense cluster (text drawn as curves, hatching, a title
 * block) cannot outvote the rest of the sheet; then evenly thinned to `max`.
 */
export function balance(pts: Float64Array, perCell = 4, cells = 64, max = 20000): Float64Array {
  const n = pts.length / 2;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    x0 = Math.min(x0, pts[2 * i] ?? 0);
    x1 = Math.max(x1, pts[2 * i] ?? 0);
    y0 = Math.min(y0, pts[2 * i + 1] ?? 0);
    y1 = Math.max(y1, pts[2 * i + 1] ?? 0);
  }
  const cell = Math.max(x1 - x0, y1 - y0, 1) / cells;
  const used = new Map<number, number>();
  const keep: number[] = [];
  for (let i = 0; i < n; i++) {
    const k =
      Math.floor(((pts[2 * i + 1] ?? 0) - y0) / cell) * (cells + 1) +
      Math.floor(((pts[2 * i] ?? 0) - x0) / cell);
    const c = used.get(k) ?? 0;
    if (c >= perCell) continue;
    used.set(k, c + 1);
    keep.push(pts[2 * i] ?? 0, pts[2 * i + 1] ?? 0);
  }
  const m = keep.length / 2;
  if (m <= max) return Float64Array.from(keep);
  const out = new Float64Array(max * 2);
  const step = m / max;
  for (let k = 0; k < max; k++) {
    const i = Math.floor(k * step);
    out[2 * k] = keep[2 * i] ?? 0;
    out[2 * k + 1] = keep[2 * i + 1] ?? 0;
  }
  return out;
}

/** Share of A's features with a feature of B within `r` pt once A is moved by `sim`. */
export function agreement(featA: Float64Array, gridB: PointGrid, sim: Sim, r: number): number {
  const n = featA.length / 2;
  if (n === 0) return 0;
  let hit = 0;
  for (let i = 0; i < featA.length; i += 2) {
    const [x, y] = applySim(sim, featA[i] ?? 0, featA[i + 1] ?? 0);
    if (gridB.near(x, y, r, 1).length) hit++;
  }
  return hit / n;
}

export interface Refined {
  sim: Sim;
  /** Matched feature pairs at the end and their RMS distance (pt). */
  matches: number;
  rms: number;
  /** Share of A's features with a B feature within 0.5 pt after alignment. */
  inlierShare: number;
}

/** Vector refinement: closest-feature RANSAC, then trimmed least squares, coarse to fine. */
export function refineVector(
  featA: Float64Array,
  featB: Float64Array,
  start: Sim,
  startRadius: number,
  finalRadius = 0.5,
  gridB = new PointGrid(featB, 4),
): Refined {
  const sampleA = balance(featA);
  let sim = start;
  let r = Math.max(startRadius, finalRadius);
  // Stage 1: RANSAC over up to 3 candidates per feature within r.
  {
    const src: number[] = [];
    const dst: number[] = [];
    for (let i = 0; i < sampleA.length; i += 2) {
      const [x, y] = applySim(sim, sampleA[i] ?? 0, sampleA[i + 1] ?? 0);
      for (const [j] of gridB.near(x, y, r, 3)) {
        src.push(sampleA[i] ?? 0, sampleA[i + 1] ?? 0);
        dst.push(featB[2 * j] ?? 0, featB[2 * j + 1] ?? 0);
      }
    }
    const res = ransacSim(src, dst, {
      threshold: Math.max(r / 4, finalRadius),
      iterations: 800,
      maxDeg: 45,
      aroundDeg: degOf(start),
    });
    if (res) {
      sim = res.sim;
      r = Math.max(finalRadius, Math.min(r / 2, res.rms * 4 + finalRadius));
    }
  }
  // Stage 2: closest-point least squares, the radius halving to the final one.
  let matches = 0;
  let rms = Infinity;
  for (let it = 0; it < 30; it++) {
    const src: number[] = [];
    const dst: number[] = [];
    for (let i = 0; i < sampleA.length; i += 2) {
      const [x, y] = applySim(sim, sampleA[i] ?? 0, sampleA[i + 1] ?? 0);
      const nb = gridB.near(x, y, r, 1)[0];
      if (!nb) continue;
      src.push(sampleA[i] ?? 0, sampleA[i + 1] ?? 0);
      dst.push(featB[2 * nb[0]] ?? 0, featB[2 * nb[0] + 1] ?? 0);
    }
    const next = fitSim(src, dst);
    if (!next) break;
    const moved =
      Math.hypot(next.tx - sim.tx, next.ty - sim.ty) +
      Math.hypot(next.a - sim.a, next.b - sim.b) * 1000;
    sim = next;
    matches = src.length / 2;
    let se = 0;
    for (let k = 0; k < matches; k++) {
      const [x, y] = applySim(sim, src[2 * k] ?? 0, src[2 * k + 1] ?? 0);
      se += (x - (dst[2 * k] ?? 0)) ** 2 + (y - (dst[2 * k + 1] ?? 0)) ** 2;
    }
    rms = Math.sqrt(se / Math.max(1, matches));
    if (r > finalRadius) r = Math.max(finalRadius, r / 2);
    else if (moved < 1e-4) break;
  }
  return { sim, matches, rms, inlierShare: agreement(featA, gridB, sim, 0.5) };
}

// ----------------------------------------------------------------- image ---

export interface TileResult {
  sim: Sim;
  tiles: number;
  used: number;
  rmsPx: number;
}

/**
 * One coarse-to-fine step of the image method. `fillA` and `fillB` write a
 * tile at frame pixel (x0, y0) as 0…1 ink (A already drawn through the
 * current estimate). Returns the correction (B's pt → B's pt) to apply after
 * it, or null when fewer than 6 tiles agree.
 */
export function tileCorrectionBy(
  fillA: (x0: number, y0: number, out: Float64Array) => void,
  fillB: (x0: number, y0: number, out: Float64Array) => void,
  w: number,
  h: number,
  scale: number,
  tile = 128,
  maxTiles = 120,
): TileResult | null {
  const ta = new Float64Array(tile * tile);
  const tb = new Float64Array(tile * tile);
  const win = new Float64Array(tile);
  for (let i = 0; i < tile; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / tile);
  // Candidate tiles on a grid, visited in a spread order (a coprime walk);
  // a tile is used when both sides have ink (1 %), up to `maxTiles`.
  const cand: [number, number][] = [];
  for (let y0 = 0; y0 + tile <= h; y0 += tile)
    for (let x0 = 0; x0 + tile <= w; x0 += tile) cand.push([x0, y0]);
  const seen = new Uint8Array(cand.length);
  const order: number[] = [];
  for (let k = 0, i = 0; k < cand.length; k++, i = (i + 7) % cand.length) {
    while (seen[i]) i = (i + 1) % cand.length;
    seen[i] = 1;
    order.push(i);
  }
  const src: number[] = [];
  const dst: number[] = [];
  const wts: number[] = [];
  let tiles = 0;
  for (const idx of order) {
    if (tiles >= maxTiles) break;
    const [x0, y0] = cand[idx] ?? [0, 0];
    fillB(x0, y0, tb);
    let inkB = 0;
    for (const v of tb) inkB += v;
    if (inkB < tile * tile * 0.01) continue;
    fillA(x0, y0, ta);
    let inkA = 0;
    for (const v of ta) inkA += v;
    if (inkA < tile * tile * 0.01) continue;
    tiles++;
    for (let y = 0; y < tile; y++)
      for (let x = 0; x < tile; x++) {
        const wv = (win[x] ?? 0) * (win[y] ?? 0);
        ta[y * tile + x] = (ta[y * tile + x] ?? 0) * wv;
        tb[y * tile + x] = (tb[y * tile + x] ?? 0) * wv;
      }
    const p = phaseCorrelate(ta, tb, tile, tile);
    if (p.peak < 0.05 || p.ratio < 1.5 || Math.hypot(p.dx, p.dy) > tile / 4) continue;
    const cx = (x0 + tile / 2) / scale;
    const cy = (y0 + tile / 2) / scale;
    src.push(cx, cy);
    dst.push(cx + p.dx / scale, cy + p.dy / scale);
    wts.push(p.peak);
  }
  if (src.length < 2 * MIN_TILES) return null;
  const res = ransacSim(src, dst, {
    threshold: 1.5 / scale,
    iterations: 400,
    maxDeg: 5,
    weights: wts,
  });
  if (!res || res.inliers.length < MIN_TILES) return null;
  return { sim: res.sim, tiles, used: res.inliers.length, rmsPx: res.rms * scale };
}

interface Level {
  ink: Ink;
  scale: number;
}

/** A raster and its 2×, 4× and 8× area-averaged copies. */
function pyramid(ink: Ink, scale: number): Level[] {
  const out = [{ ink, scale }];
  for (const f of [2, 4, 8]) out.push({ ink: shrink(ink, f), scale: scale / f });
  return out;
}

/** Fills a tile of the frame at `scale` px/pt with the raster drawn through `t` (pt → pt). */
function tileSampler(
  pyr: Level[],
  t: Sim,
  scale: number,
  tile: number,
): (x0: number, y0: number, out: Float64Array) => void {
  // The finest copy not much finer than the frame (no aliasing, little work).
  const k = scaleOf(t);
  let lvl = pyr[0];
  if (!lvl) throw new Error('empty pyramid');
  for (const p of pyr) if (p.scale * k >= scale * 0.9) lvl = p;
  // frame px → pt (B) → pt (the raster's page) → raster px
  const m = thenSim(thenSim({ a: 1 / scale, b: 0, tx: 0, ty: 0 }, invertSim(t)), {
    a: lvl.scale,
    b: 0,
    tx: 0,
    ty: 0,
  });
  const { w, h, data } = lvl.ink;
  return (x0, y0, out) => {
    for (let y = 0; y < tile; y++) {
      for (let x = 0; x < tile; x++) {
        const [sx, sy] = applySim(m, x0 + x + 0.5, y0 + y + 0.5);
        out[y * tile + x] = sample(data, w, h, sx - 0.5, sy - 0.5) / 255;
      }
    }
  };
}

export interface ImageAlign {
  sim: Sim;
  /** The finest step's result (null: too few tiles agreed). */
  last: TileResult | null;
}

/** Steps of the image method from `start`, at the levels up to `scale`. */
function imageSteps(
  pa: Level[],
  pb: Level[],
  start: Sim,
  w: number,
  h: number,
  scale: number,
): ImageAlign {
  let sim = start;
  let last: TileResult | null = null;
  for (const lvl of [0.5, 1, 2].filter((l) => l <= scale + 1e-9)) {
    last = tileCorrectionBy(
      tileSampler(pa, sim, lvl, 128),
      tileSampler(pb, SIM_IDENTITY, lvl, 128),
      Math.floor(w * lvl),
      Math.floor(h * lvl),
      lvl,
    );
    if (last) sim = thenSim(sim, last.sim);
  }
  return { sim, last };
}

/** The image raster scale for a page pair (2 px per pt unless the pages are huge). */
export function imageScale(
  a: { width: number; height: number },
  b: { width: number; height: number },
): number {
  const px = Math.max(a.width * a.height, b.width * b.height) * IMAGE_SCALE * IMAGE_SCALE;
  return px <= IMAGE_MAX_PIXELS ? IMAGE_SCALE : 1;
}

// -------------------------------------------------------------- deciding ---

const sheetResult = (
  status: AlignStatus,
  method: SheetAlignment['method'],
  sim: Sim,
  score: number,
): SheetAlignment => ({ status, method, place: simToAffine(sim), score });

/** Whether the two rasters are one portrait and one landscape (a quarter turn is likelier). */
const turned = (a: Ink, b: Ink): boolean => a.w > a.h !== b.w > b.h;

export interface AsIsCheck {
  /** Both pages have line work enough for the vector method. */
  vector: boolean;
  /** Share of A's features with a B feature within 0.1 pt, as is. */
  agreement: number;
}

/** The "as is" check (D-60, S28): no transform, features within 0.1 pt. */
export function asIsCheck(featA: Float64Array, featB: Float64Array): AsIsCheck {
  const vector = featA.length / 2 >= MIN_FEATURES && featB.length / 2 >= MIN_FEATURES;
  if (!vector) return { vector, agreement: 0 };
  return {
    vector,
    agreement: agreement(featA, new PointGrid(featB, 2), SIM_IDENTITY, AS_IS_RADIUS),
  };
}

/** The result for a sheet that passed the as-is check. */
export const asIs = (method: SheetAlignment['method'], score: number): SheetAlignment =>
  sheetResult('as-is', method, SIM_IDENTITY, score);

/**
 * Aligns a vector sheet that failed the as-is check (S28 rule 2): coarse,
 * then refined; the result is kept only when it agrees better than as is.
 * `checkpoint` lets the caller give up between the steps.
 */
export function alignVector(
  featA: Float64Array,
  featB: Float64Array,
  coarse: CoarseInput,
  checkpoint: () => void = () => undefined,
): SheetAlignment {
  const gridB = new PointGrid(featB, 4);
  const arounds: (0 | 90)[] = turned(coarse.a, coarse.b) ? [90, 0] : [0, 90];
  let best: Refined | null = null;
  for (const around of arounds) {
    checkpoint();
    const c = coarseAlign(coarse, { n: COARSE_CANVAS, around });
    checkpoint();
    const r = refineVector(featA, featB, c.sim, Math.max(8, 3 * c.ptPerPx), 0.5, gridB);
    if (!best || r.inlierShare > best.inlierShare) best = r;
    if (best.inlierShare >= LOW_SHARE) break;
  }
  const still = agreement(featA, gridB, SIM_IDENTITY, 0.5);
  if (!best || still >= best.inlierShare)
    return sheetResult(still >= LOW_SHARE ? 'as-is' : 'low', 'vector', SIM_IDENTITY, still);
  return sheetResult(
    best.inlierShare >= LOW_SHARE ? 'auto' : 'low',
    'vector',
    best.sim,
    best.inlierShare,
  );
}

/**
 * Aligns a sheet by the image method (scans, pages with next to no line
 * work). `a` and `b` are both pages' ink at `scale` px per pt. Checked as is
 * first: when the finest step from no transform moves nothing by half a
 * pixel or more, the sheet is used as it is.
 */
export function alignImage(
  a: Ink,
  b: Ink,
  scale: number,
  checkpoint: () => void = () => undefined,
): SheetAlignment {
  // Blank (or next to blank) on either side: nothing to align by.
  if (inkShare(a, 32) < 1e-4 || inkShare(b, 32) < 1e-4) return asIs('image', 0);
  const pa = pyramid(a, scale);
  const pb = pyramid(b, scale);
  const w = b.w / scale;
  const h = b.h / scale;
  checkpoint();
  const fine = Math.min(scale, IMAGE_SCALE);
  const still = tileCorrectionBy(
    tileSampler(pa, SIM_IDENTITY, fine, 128),
    tileSampler(pb, SIM_IDENTITY, fine, 128),
    Math.floor(w * fine),
    Math.floor(h * fine),
    fine,
  );
  if (still && cornerShift(still.sim, w, h) * fine < 0.5) return asIs('image', still.used);
  const arounds: (0 | 90)[] = turned(a, b) ? [90, 0] : [0, 90];
  let best: ImageAlign | null = null;
  for (const around of arounds) {
    checkpoint();
    const s = coarseScale({ width: a.w / scale, height: a.h / scale }, { width: w, height: h });
    const c = coarseAlign(
      { a: resample(a, scale, s), b: resample(b, scale, s), scale: s },
      { n: COARSE_CANVAS, around },
    );
    checkpoint();
    const r = imageSteps(pa, pb, c.sim, w, h, scale);
    if (!best || (r.last?.used ?? 0) > (best.last?.used ?? 0)) best = r;
    if ((best.last?.used ?? 0) >= MIN_TILES) break;
  }
  const used = best?.last?.used ?? 0;
  if (!best || used < MIN_TILES) {
    // Nothing better found: keep the sheet as it is and ask for points.
    return sheetResult('low', 'image', best?.last ? best.sim : SIM_IDENTITY, used);
  }
  return sheetResult('auto', 'image', best.sim, used);
}

/** The largest displacement (pt) a similarity gives a corner of a w × h page. */
export function cornerShift(s: Sim, w: number, h: number): number {
  let d = 0;
  for (const [x, y] of [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ] as const) {
    const [u, v] = applySim(s, x, y);
    d = Math.max(d, Math.hypot(u - x, v - y));
  }
  return d;
}
