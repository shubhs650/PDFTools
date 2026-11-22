// Spike S28 (M12-03): unit tests for the pure pieces (no PDFium).
import { describe, expect, it } from 'vitest';
import { coarseAlign, features, refineVector, tileCorrection } from './align.ts';
import { fft1, phaseCorrelate } from './fft.ts';
import {
  applySim,
  degOf,
  fitSim,
  invertSim,
  ransacSim,
  rng,
  scaleOf,
  simError,
  simFrom,
  thenSim,
  type Sim,
} from './geom.ts';
import { dilate, distanceTo, type Ink } from './image.ts';
import { assignPairs } from './pairing.ts';

/** A synthetic "drawing": a frame, a grid of rooms and some random lines, as segments. */
function drawing(seed: number, w = 600, h = 420): Float32Array {
  const r = rng(seed);
  const s: number[] = [];
  const rect = (x: number, y: number, ww: number, hh: number): void => {
    s.push(x, y, x + ww, y, x + ww, y, x + ww, y + hh, x + ww, y + hh, x, y + hh, x, y + hh, x, y);
  };
  rect(10, 10, w - 20, h - 20);
  for (let i = 0; i < 40; i++)
    rect(30 + r() * (w - 140), 30 + r() * (h - 140), 20 + r() * 80, 15 + r() * 60);
  for (let i = 0; i < 60; i++) {
    const x = 20 + r() * (w - 40);
    const y = 20 + r() * (h - 40);
    s.push(x, y, x + (r() - 0.5) * 120, y + (r() - 0.5) * 120);
  }
  return Float32Array.from(s);
}

function moveSegs(segs: Float32Array, t: Sim): Float32Array {
  const out = new Float32Array(segs.length);
  for (let i = 0; i < segs.length; i += 2) {
    const [x, y] = applySim(t, segs[i] ?? 0, segs[i + 1] ?? 0);
    out[i] = x;
    out[i + 1] = y;
  }
  return out;
}

/** Rasterises segments 1 px wide at `scale` px per unit. */
function raster(segs: Float32Array, w: number, h: number, scale: number): Ink {
  const data = new Uint8Array(w * h);
  for (let i = 0; i < segs.length; i += 4) {
    const ax = (segs[i] ?? 0) * scale;
    const ay = (segs[i + 1] ?? 0) * scale;
    const bx = (segs[i + 2] ?? 0) * scale;
    const by = (segs[i + 3] ?? 0) * scale;
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 2) + 1;
    for (let k = 0; k <= n; k++) {
      const x = Math.round(ax + ((bx - ax) * k) / n);
      const y = Math.round(ay + ((by - ay) * k) / n);
      if (x >= 0 && y >= 0 && x < w && y < h) data[y * w + x] = 255;
    }
  }
  return { w, h, data };
}

describe('similarity maths', () => {
  it('fits an exact similarity and inverts it', () => {
    const t = simFrom(0.982, 1.2, 14, -9);
    const src = [0, 0, 100, 0, 0, 100, 300, 200];
    const dst: number[] = [];
    for (let i = 0; i < src.length; i += 2) dst.push(...applySim(t, src[i] ?? 0, src[i + 1] ?? 0));
    const f = fitSim(src, dst);
    if (!f) throw new Error('no fit');
    expect(scaleOf(f)).toBeCloseTo(0.982, 9);
    expect(degOf(f)).toBeCloseTo(1.2, 9);
    const back = thenSim(t, invertSim(t));
    expect(back.a).toBeCloseTo(1, 12);
    expect(back.tx).toBeCloseTo(0, 9);
  });

  it('RANSAC ignores 40 % wrong correspondences', () => {
    const t = simFrom(1.01, -0.6, 30, 12);
    const r = rng(3);
    const src: number[] = [];
    const dst: number[] = [];
    for (let i = 0; i < 200; i++) {
      const x = r() * 1000;
      const y = r() * 700;
      src.push(x, y);
      if (i % 5 < 2) dst.push(r() * 1000, r() * 700);
      else {
        const [u, v] = applySim(t, x, y);
        dst.push(u + (r() - 0.5) * 0.2, v + (r() - 0.5) * 0.2);
      }
    }
    const res = ransacSim(src, dst, { threshold: 1 });
    if (!res) throw new Error('no fit');
    const e = simError(res.sim, t, 1000, 700);
    expect(e.maxPt).toBeLessThan(0.2);
    expect(res.inliers.length).toBeGreaterThanOrEqual(115);
  });
});

describe('FFT and phase correlation', () => {
  it('round-trips', () => {
    const re = Float64Array.from({ length: 16 }, (_, i) => Math.sin(i) + i);
    const im = new Float64Array(16);
    const copy = re.slice();
    fft1(re, im);
    fft1(re, im, true);
    for (let i = 0; i < 16; i++) expect(re[i]).toBeCloseTo(copy[i] ?? 0, 9);
  });

  it('finds a sub-pixel shift', () => {
    const n = 64;
    const a = new Float64Array(n * n);
    const b = new Float64Array(n * n);
    const f = (x: number, y: number): number =>
      Math.exp(-((x - 20) ** 2 + (y - 30) ** 2) / 20) +
      Math.exp(-((x - 40) ** 2 + (y - 15) ** 2) / 8);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        a[y * n + x] = f(x, y);
        b[y * n + x] = f(x - 5.3, y + 3);
      }
    const p = phaseCorrelate(a, b, n, n);
    expect(p.dx).toBeCloseTo(5.3, 0);
    expect(p.dy).toBeCloseTo(-3, 1);
  });
});

describe('route 1 aligner', () => {
  const segA = drawing(11);
  const truth = simFrom(0.982, 1.2, 14, -9);
  const segB = moveSegs(segA, truth);

  it('coarse Fourier–Mellin gets within a few pt', () => {
    const s = 0.8;
    const c = coarseAlign(
      { a: raster(segA, 480, 336, s), b: raster(segB, 480, 336, s), scale: s },
      { n: 512 },
    );
    const e = simError(c.sim, truth, 600, 420);
    expect(Math.abs(e.deg)).toBeLessThan(0.5);
    expect(Math.abs(e.scalePct)).toBeLessThan(1);
    expect(e.maxPt).toBeLessThan(8);
  });

  it('vector refinement reaches the acceptance numbers from a rough start', () => {
    const start = thenSim(truth, simFrom(1.004, 0.3, 3, -2));
    const r = refineVector(features(segA), features(segB), start, 12);
    const e = simError(r.sim, truth, 600, 420);
    expect(e.maxPt).toBeLessThan(0.05);
    expect(Math.abs(e.scalePct)).toBeLessThan(0.05);
    expect(Math.abs(e.deg)).toBeLessThan(0.05);
    expect(r.inlierShare).toBeGreaterThan(0.9);
  });

  it('features skip the inside of straight runs', () => {
    // An L made of 3 segments, one split in the middle of a straight run.
    const f = features(Float32Array.from([0, 0, 10, 0, 10, 0, 20, 0, 20, 0, 20, 10]));
    expect(f.length / 2).toBe(3); // two ends and the corner
  });

  it('tile correction recovers a small shift and rotation of a raster', () => {
    const s = 1;
    const corr = simFrom(1, 0.3, 1.5, -1);
    const a = raster(segA, 600, 420, s);
    const b = raster(moveSegs(segA, corr), 600, 420, s);
    const r = tileCorrection(a, b, s, 64);
    if (!r) throw new Error('no fit');
    const e = simError(r.sim, corr, 600, 420);
    expect(e.maxPt).toBeLessThan(1.2);
  });
});

describe('image helpers', () => {
  it('dilates by a square radius', () => {
    const m = new Uint8Array(25);
    m[12] = 1;
    const d = dilate(m, 5, 5, 1);
    expect(Array.from(d).reduce((p, v) => p + v, 0)).toBe(9);
    expect(d[0]).toBe(0);
    expect(d[6]).toBe(1);
  });

  it('distance transform is exact', () => {
    const m = new Uint8Array(100);
    m[0] = 1;
    const d = distanceTo(m, 10, 10);
    expect(d[3 * 10 + 4]).toBeCloseTo(5, 6);
  });
});

describe('pairing', () => {
  it('keeps order, finds a removed and a swapped sheet', () => {
    // A: 6 sheets; B: 1, 2, 4, 6, 5 (sheet 3 removed, 5 and 6 swapped).
    const map = [0, 1, 3, 5, 4];
    const sim = Array.from({ length: 6 }, (_, i) =>
      Array.from({ length: 5 }, (_, j) => (map[j] === i ? 0.9 : 0.3)),
    );
    const p = assignPairs(sim, 0.55);
    expect(p.pairs).toEqual([
      [0, 0],
      [1, 1],
      [3, 2],
      [5, 3],
      [4, 4],
    ]);
    expect(p.removed).toEqual([2]);
    expect(p.added).toEqual([]);
  });
});
