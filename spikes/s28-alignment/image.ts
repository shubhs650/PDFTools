// Spike S28 (M12-03): small image operations on ink rasters (our own code).
// An ink raster is one byte per pixel: 0 = paper, 255 = full ink.

import { applySim, invertSim, type Sim } from './geom.ts';

export interface Ink {
  w: number;
  h: number;
  data: Uint8Array;
}

/** A binary mask of the ink at or above `threshold`. */
export function mask(ink: Ink, threshold: number): Uint8Array {
  const m = new Uint8Array(ink.data.length);
  for (let i = 0; i < m.length; i++) m[i] = (ink.data[i] ?? 0) >= threshold ? 1 : 0;
  return m;
}

export function count(m: Uint8Array): number {
  let n = 0;
  for (const v of m) n += v;
  return n;
}

/** Binary dilation by a (2r+1)² square (Chebyshev radius r), separable. */
export function dilate(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return m.slice();
  const tmp = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let last = -1e9; // last ink x seen
    for (let x = 0; x < w + r; x++) {
      if (x < w && m[o + x]) last = x;
      const t = x - r;
      if (t >= 0 && t < w && x - last <= 2 * r) tmp[o + t] = 1;
    }
    // Ink left of t within r is covered by the forward pass via `last`.
  }
  const out = new Uint8Array(m.length);
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    for (let y = 0; y < h + r; y++) {
      if (y < h && tmp[y * w + x]) last = y;
      const t = y - r;
      if (t >= 0 && t < h && y - last <= 2 * r) out[t * w + x] = 1;
    }
  }
  return out;
}

export interface Component {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  pixels: number;
}

/** 8-connected components of a mask, with a label image. */
export function components(
  m: Uint8Array,
  w: number,
  h: number,
): { labels: Int32Array; comps: Component[] } {
  const labels = new Int32Array(m.length).fill(-1);
  const comps: Component[] = [];
  const stack = new Int32Array(m.length);
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || (labels[s] ?? 0) >= 0) continue;
    const id = comps.length;
    const c: Component = { x0: w, y0: h, x1: -1, y1: -1, pixels: 0 };
    let sp = 0;
    stack[sp++] = s;
    labels[s] = id;
    while (sp > 0) {
      const p = stack[--sp] ?? 0;
      const x = p % w;
      const y = (p - x) / w;
      c.pixels++;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (m[q] && (labels[q] ?? 0) < 0) {
            labels[q] = id;
            stack[sp++] = q;
          }
        }
      }
    }
    comps.push(c);
  }
  return { labels, comps };
}

/** Area-average downsample of an ink raster by an integer factor. */
export function shrink(ink: Ink, f: number): Ink {
  const w = Math.ceil(ink.w / f);
  const h = Math.ceil(ink.h / f);
  const sum = new Float64Array(w * h);
  for (let y = 0; y < ink.h; y++) {
    const oy = Math.floor(y / f) * w;
    for (let x = 0; x < ink.w; x++)
      sum[oy + Math.floor(x / f)] =
        (sum[oy + Math.floor(x / f)] ?? 0) + (ink.data[y * ink.w + x] ?? 0);
  }
  const data = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i++)
    data[i] = Math.min(255, Math.round((sum[i] ?? 0) / (f * f)));
  return { w, h, data };
}

/** Bilinear sample of a float image (0 outside). */
export function sample(img: ArrayLike<number>, w: number, h: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (xx: number, yy: number): number =>
    xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : (img[yy * w + xx] ?? 0);
  return (
    at(x0, y0) * (1 - fx) * (1 - fy) +
    at(x0 + 1, y0) * fx * (1 - fy) +
    at(x0, y0 + 1) * (1 - fx) * fy +
    at(x0 + 1, y0 + 1) * fx * fy
  );
}

/** out(p) = src(sim⁻¹(p)): draws `src` moved by `sim` into an outW × outH image. */
export function warp(
  src: ArrayLike<number>,
  w: number,
  h: number,
  sim: Sim,
  outW: number,
  outH: number,
): Float64Array {
  const inv = invertSim(sim);
  const out = new Float64Array(outW * outH);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const [sx, sy] = applySim(inv, x + 0.5, y + 0.5);
      out[y * outW + x] = sample(src, w, h, sx - 0.5, sy - 0.5);
    }
  }
  return out;
}

/** Separable box blur (radius r) of a float image, in place. */
export function boxBlur(img: Float64Array, w: number, h: number, r: number): void {
  if (r <= 0) return;
  const line = new Float64Array(Math.max(w, h));
  const run = (
    get: (i: number) => number,
    set: (i: number, v: number) => void,
    n: number,
  ): void => {
    for (let i = 0; i < n; i++) line[i] = get(i);
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += i >= 0 && i < n ? (line[i] ?? 0) : 0;
    for (let i = 0; i < n; i++) {
      set(i, acc / (2 * r + 1));
      const add = i + r + 1;
      const sub = i - r;
      if (add < n) acc += line[add] ?? 0;
      if (sub >= 0) acc -= line[sub] ?? 0;
    }
  };
  for (let y = 0; y < h; y++)
    run(
      (i) => img[y * w + i] ?? 0,
      (i, v) => (img[y * w + i] = v),
      w,
    );
  for (let x = 0; x < w; x++)
    run(
      (i) => img[i * w + x] ?? 0,
      (i, v) => (img[i * w + x] = v),
      h,
    );
}

/** Exact Euclidean distance transform (Felzenszwalb & Huttenlocher): distance to the nearest set pixel. */
export function distanceTo(m: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e20;
  const f = new Float64Array(Math.max(w, h));
  const d = new Float64Array(Math.max(w, h));
  const v = new Int32Array(Math.max(w, h));
  const z = new Float64Array(Math.max(w, h) + 1);
  const g = new Float64Array(w * h);
  const dt1 = (n: number): void => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = 0;
      for (;;) {
        const vk = v[k] ?? 0;
        s = ((f[q] ?? 0) + q * q - ((f[vk] ?? 0) + vk * vk)) / (2 * q - 2 * vk);
        if (s <= (z[k] ?? 0) && k > 0) k--;
        else break;
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while ((z[k + 1] ?? 0) < q) k++;
      const vk = v[k] ?? 0;
      d[q] = (q - vk) * (q - vk) + (f[vk] ?? 0);
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = m[y * w + x] ? 0 : INF;
    dt1(h);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y] ?? 0;
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x] ?? 0;
    dt1(w);
    for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x] ?? 0);
  }
  return out;
}
