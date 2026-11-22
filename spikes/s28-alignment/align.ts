// Spike S28 (M12-03), route 1: our own aligner.
//   coarse  Fourier–Mellin on a small ink raster (Reddy & Chatterji 1996):
//           the magnitude spectrum's log-polar form turns rotation and scale
//           into a shift, found by phase correlation; then phase correlation
//           again for the shift. Works for vector pages and scans alike.
//   vector  feature points from the line geometry (line ends, corners,
//           junctions), matched with RANSAC to a similarity and refined by
//           least squares, closest-point iterations from coarse to fine.
//   scan    tile phase correlation on finer rasters (coarse to fine), each
//           tile one displacement, RANSAC + least squares over the tiles.
// All results are similarities from A's displayed page to B's (pt, y down).

import { fft2, findPeak, nextPow2, phaseCorrelate, type Peak } from './fft.ts';
import {
  applySim,
  fitSim,
  IDENTITY,
  invertSim,
  ransacSim,
  simFrom,
  thenSim,
  type Sim,
} from './geom.ts';
import { PointGrid } from './grid.ts';
import { distanceTo, mask, sample, shrink, warp, type Ink } from './image.ts';

// ---------------------------------------------------------------- coarse ---

export interface CoarseOptions {
  /** Canvas size (power of two). */
  n?: number;
  /** Largest rotation searched, degrees (quarter turns come from /Rotate). */
  maxDeg?: number;
  /** Scale range searched. */
  scaleRange?: [number, number];
}

export interface Coarse {
  sim: Sim;
  /** Phase-correlation peak of the final shift (0…1) and its ratio to the next peak. */
  peak: number;
  ratio: number;
  /** pt per canvas pixel. */
  ptPerPx: number;
}

/** The two pages' ink, each centred on its own n × n canvas at a common pt → px scale. */
export interface CoarseInput {
  a: Ink;
  b: Ink;
  /** Pixels per pt used to render both. */
  scale: number;
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
      const fx = (sx - h) / n;
      const fy = (sy - h) / n;
      const c = Math.cos(Math.PI * fx) * Math.cos(Math.PI * fy);
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

/**
 * Coarse similarity A → B (displayed pt). `input` holds both pages rendered
 * at the same px-per-pt scale, each no larger than the canvas.
 */
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
  const lpA = logPolar(spectrum(A.img, n), n, nT, nR, rMin, rMax);
  const lpB = logPolar(spectrum(B.img, n), n, nT, nR, rMin, rMax);
  // Phase correlation of the log-polar images; peak search limited to the
  // allowed rotations and scales.
  const ar = Float64Array.from(lpA);
  const ai = new Float64Array(ar.length);
  const br = Float64Array.from(lpB);
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
  // Scale s shrinks B's spectrum by 1/s: the radial shift is −ln(s)/base.
  const rLo = Math.floor(-Math.log(smax) / base);
  const rHi = Math.ceil(-Math.log(smin) / base);
  let best = -Infinity;
  let bt = 0;
  let br0 = 0;
  for (let dt = -tMax; dt <= tMax; dt++) {
    const row = ((dt % nT) + nT) % nT;
    for (let dr = rLo; dr <= rHi; dr++) {
      const col = ((dr % nR) + nR) % nR;
      const v = ar[row * nR + col] ?? 0;
      if (v > best) {
        best = v;
        bt = dt;
        br0 = dr;
      }
    }
  }
  const at = (t: number, r: number): number =>
    ar[(((t % nT) + nT) % nT) * nR + (((r % nR) + nR) % nR)] ?? 0;
  const sub = (l: number, m: number, r: number): number => {
    const d = l - 2 * m + r;
    return Math.abs(d) < 1e-12 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / d));
  };
  const dt = bt + sub(at(bt - 1, br0), at(bt, br0), at(bt + 1, br0));
  const dr = br0 + sub(at(bt, br0 - 1), at(bt, br0), at(bt, br0 + 1));
  const scale = Math.exp(-dr * base);
  // A spectrum turned by θ belongs to an image turned by θ. In y-down pixels
  // the log-polar θ runs counter-clockwise, so the image angle is −θ.
  const deg = (-dt * 180) / nT;
  // Shift for the rotation/scale found, about the canvas centre.
  let bestPeak: Peak | null = null;
  let bestSim: Sim = IDENTITY;
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
 * Feature points of a page's line geometry: line ends, corners and
 * junctions. A point where exactly two segments meet almost in line (the
 * inside of a flattened curve, a polyline vertex) is not a feature.
 */
export function features(segs: Float32Array, minTurnDeg = 25): Float64Array {
  const key = (x: number, y: number): string =>
    `${String(Math.round(x * 20))},${String(Math.round(y * 20))}`;
  const ends = new Map<string, { x: number; y: number; dirs: number[] }>();
  const add = (x: number, y: number, dx: number, dy: number): void => {
    const k = key(x, y);
    let e = ends.get(k);
    if (!e) {
      e = { x, y, dirs: [] };
      ends.set(k, e);
    }
    e.dirs.push(Math.atan2(dy, dx));
  };
  for (let i = 0; i < segs.length; i += 4) {
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
    if (e.dirs.length === 2) {
      // Directions leaving the point: opposite (cos ≈ −1) means a straight run.
      const d0 = e.dirs[0] ?? 0;
      const d1 = e.dirs[1] ?? 0;
      if (Math.cos(d0 - d1) < -cos) continue;
    }
    out.push(e.x, e.y);
  }
  return Float64Array.from(out);
}

export interface Refined {
  sim: Sim;
  /** Matched feature pairs at the end, and the RMS distance between them (pt). */
  matches: number;
  rms: number;
  /** Share of A's features with a B feature within 0.5 pt after alignment. */
  inlierShare: number;
}

/**
 * Spatially balanced subset: at most `perCell` points per cell of a grid
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

/** Vector refinement: closest-feature RANSAC, then trimmed least squares, coarse to fine. */
export function refineVector(
  featA: Float64Array,
  featB: Float64Array,
  start: Sim,
  startRadius: number,
  finalRadius = 0.5,
): Refined {
  const gridB = new PointGrid(featB, 4);
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
    });
    if (res) {
      sim = res.sim;
      r = Math.max(finalRadius, Math.min(r / 2, res.rms * 4 + finalRadius));
    }
  }
  // Stage 2: closest-point least squares, radius halving to the final one.
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
  let inl = 0;
  for (let i = 0; i < featA.length; i += 2) {
    const [x, y] = applySim(sim, featA[i] ?? 0, featA[i + 1] ?? 0);
    if (gridB.near(x, y, 0.5, 1).length) inl++;
  }
  return { sim, matches, rms, inlierShare: inl / Math.max(1, featA.length / 2) };
}

// ------------------------------------------------------------------ scan ---

export interface TileResult {
  sim: Sim;
  tiles: number;
  used: number;
  rmsPx: number;
}

/**
 * One coarse-to-fine step for scans: `a` is A already drawn through the
 * current estimate into B's frame, at `scale` px per pt. Returns the
 * correction (B's displayed pt → B's displayed pt) to apply after it.
 */
export function tileCorrection(
  a: Ink,
  b: Ink,
  scale: number,
  tile = 128,
  maxTiles = 120,
): TileResult | null {
  const fill =
    (ink: Ink) =>
    (x0: number, y0: number, out: Float64Array): void => {
      for (let y = 0; y < tile; y++)
        for (let x = 0; x < tile; x++)
          out[y * tile + x] = (ink.data[(y0 + y) * ink.w + x0 + x] ?? 0) / 255;
    };
  return tileCorrectionBy(fill(a), fill(b), b.w, b.h, scale, tile, maxTiles);
}

/**
 * The same, with the two pictures sampled tile by tile (`fillA`, `fillB` write
 * a tile at frame pixel x0, y0 as 0…1 ink), so only the tiles used are made.
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
  // Candidate tiles on a grid (no overlap), visited in an even spread order;
  // a tile is used when both sides have ink (1 %), up to `maxTiles`.
  const cand: [number, number][] = [];
  for (let y0 = 0; y0 + tile <= h; y0 += tile)
    for (let x0 = 0; x0 + tile <= w; x0 += tile) cand.push([x0, y0]);
  const order: number[] = [];
  const stride = 7; // coprime walk over the grid spreads the first tiles over the page
  for (let k = 0, i = 0; k < cand.length; k++, i = (i + stride) % cand.length) {
    while (order.includes(i)) i = (i + 1) % cand.length;
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
  if (src.length < 6) return null;
  const res = ransacSim(src, dst, {
    threshold: 1.5 / scale,
    iterations: 400,
    maxDeg: 5,
    weights: wts,
  });
  if (!res) return null;
  return { sim: res.sim, tiles, used: res.inliers.length, rmsPx: res.rms * scale };
}

/** A raster and its 2×, 4× and 8× area-averaged copies. */
export function pyramid(ink: Ink, scale: number): { ink: Ink; scale: number }[] {
  const out = [{ ink, scale }];
  for (const f of [2, 4, 8]) out.push({ ink: shrink(ink, f), scale: scale / f });
  return out;
}

/** Fills a tile of the frame at `scale` px/pt with the raster drawn through `t` (pt → pt). */
function tileSampler(
  pyr: { ink: Ink; scale: number }[],
  t: Sim,
  scale: number,
  tile: number,
): (x0: number, y0: number, out: Float64Array) => void {
  // The finest copy not much finer than the frame (no aliasing, little work).
  const k = Math.hypot(t.a, t.b);
  let lvl = pyr[0];
  if (!lvl) throw new Error('empty pyramid');
  for (const p of pyr) if (p.scale * k >= scale * 0.9) lvl = p;
  // frame px → pt (B) → pt (raster's page) → raster px
  const inv = invertSim(t);
  const m = thenSim(thenSim({ a: 1 / scale, b: 0, tx: 0, ty: 0 }, inv), {
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

/** Resamples a raster made at `from` px per pt to `to` px per pt. */
export function resample(ink: Ink, from: number, to: number): Ink {
  let src = ink;
  let f0 = from;
  const k = Math.floor(from / to);
  if (k >= 2) {
    src = shrink(ink, k);
    f0 = from / k;
  }
  const w = Math.max(1, Math.round((ink.w / from) * to));
  const h = Math.max(1, Math.round((ink.h / from) * to));
  const r = to / f0;
  const out = warp(src.data, src.w, src.h, { a: r, b: 0, tx: 0, ty: 0 }, w, h);
  return { w, h, data: Uint8Array.from(out, (v) => Math.min(255, Math.round(v))) };
}

/** Draws raster `a` (aScale px/pt) through `t` (pt) into a frame of `w` × `h` at `scale` px/pt. */
export function place(a: Ink, aScale: number, t: Sim, scale: number, w: number, h: number): Ink {
  const px = thenSim(thenSim({ a: 1 / aScale, b: 0, tx: 0, ty: 0 }, t), {
    a: scale,
    b: 0,
    tx: 0,
    ty: 0,
  });
  const out = warp(a.data, a.w, a.h, px, w, h);
  return { w, h, data: Uint8Array.from(out, (v) => Math.min(255, Math.round(v))) };
}

export interface ScanAlign {
  sim: Sim;
  coarse: Coarse;
  steps: (TileResult | null)[];
  ms: { coarse: number; fine: number };
}

/**
 * Route 1 for scans: coarse Fourier–Mellin, then tile phase correlation at
 * 0.5, 1 and 2 px per pt (36, 72 and 144 dpi). `a` and `b` are the two pages'
 * ink at their own resolutions.
 */
export function alignRaster(a: Ink, aScale: number, b: Ink, bScale: number, n = 512): ScanAlign {
  const t0 = performance.now();
  const maxPt = Math.max(a.w / aScale, a.h / aScale, b.w / bScale, b.h / bScale);
  const s = (0.9 * n) / maxPt;
  const coarse = coarseAlign(
    { a: resample(a, aScale, s), b: resample(b, bScale, s), scale: s },
    { n },
  );
  const t1 = performance.now();
  let sim = coarse.sim;
  const steps: (TileResult | null)[] = [];
  const pa = pyramid(a, aScale);
  const pb = pyramid(b, bScale);
  const wPt = b.w / bScale;
  const hPt = b.h / bScale;
  const I: Sim = { a: 1, b: 0, tx: 0, ty: 0 };
  for (const lvl of [0.5, 1, 2]) {
    const tile = 128;
    const c = tileCorrectionBy(
      tileSampler(pa, sim, lvl, tile),
      tileSampler(pb, I, lvl, tile),
      Math.floor(wPt * lvl),
      Math.floor(hPt * lvl),
      lvl,
      tile,
    );
    steps.push(c);
    if (c) sim = thenSim(sim, c.sim);
  }
  return { sim, coarse, steps, ms: { coarse: t1 - t0, fine: performance.now() - t1 } };
}

/**
 * Alignment residual of two rasters in one frame: for A's ink pixels, the
 * distance to B's nearest ink, over pixels within `cap` px (real changes are
 * farther). Median and mean, in px.
 */
export function residual(
  a: Ink,
  b: Ink,
  threshold = 96,
  cap = 6,
): { median: number; mean: number; share: number } {
  const ma = mask(a, threshold);
  const d = distanceTo(mask(b, threshold), b.w, b.h);
  const ds: number[] = [];
  let all = 0;
  for (let i = 0; i < ma.length; i++) {
    if (!ma[i]) continue;
    all++;
    const v = d[i] ?? 0;
    if (v <= cap) ds.push(v);
  }
  ds.sort((p, q) => p - q);
  const mean = ds.reduce((p, v) => p + v, 0) / Math.max(1, ds.length);
  return { median: ds[Math.floor(ds.length / 2)] ?? 0, mean, share: ds.length / Math.max(1, all) };
}

export { findPeak };
