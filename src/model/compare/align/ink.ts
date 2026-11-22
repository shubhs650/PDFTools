// Small operations on ink rasters for alignment (M12-10, D-60; spike S28),
// our own code. An ink raster is one byte per pixel: 0 = paper, 255 = ink.
import { applySim, invertSim, type Sim } from './similarity';

export interface Ink {
  w: number;
  h: number;
  data: Uint8Array;
}

/** Area-average downsample by an integer factor. */
export function shrink(ink: Ink, f: number): Ink {
  const w = Math.ceil(ink.w / f);
  const h = Math.ceil(ink.h / f);
  const sum = new Float64Array(w * h);
  for (let y = 0; y < ink.h; y++) {
    const oy = Math.floor(y / f) * w;
    const row = y * ink.w;
    for (let x = 0; x < ink.w; x++) {
      const k = oy + Math.floor(x / f);
      sum[k] = (sum[k] ?? 0) + (ink.data[row + x] ?? 0);
    }
  }
  const data = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i++)
    data[i] = Math.min(255, Math.round((sum[i] ?? 0) / (f * f)));
  return { w, h, data };
}

/** Bilinear sample (0 outside). */
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

/** out(p) = src(sim⁻¹(p)): `src` moved by `sim` into an outW × outH image. */
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

/** A raster made at `from` px per pt, resampled to `to` px per pt. */
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

/** Share of pixels with ink at or above `level`. */
export function inkShare(ink: Ink, level = 96): number {
  let n = 0;
  for (const v of ink.data) if (v >= level) n++;
  return n / Math.max(1, ink.data.length);
}
