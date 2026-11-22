// Spike S28 (M12-03): an iterative radix-2 FFT (textbook Cooley–Tukey) and
// phase correlation (Kuglin & Hines 1975), our own code, no dependency.

/** In-place FFT of length n (a power of two); `inverse` scales by 1/n. */
export function fft1(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i] ?? 0;
      re[i] = re[j] ?? 0;
      re[j] = tr;
      const ti = im[i] ?? 0;
      im[i] = im[j] ?? 0;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const br = re[b] ?? 0;
        const bi = im[b] ?? 0;
        const xr = br * cr - bi * ci;
        const xi = br * ci + bi * cr;
        re[b] = (re[a] ?? 0) - xr;
        im[b] = (im[a] ?? 0) - xi;
        re[a] = (re[a] ?? 0) + xr;
        im[a] = (im[a] ?? 0) + xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] = (re[i] ?? 0) / n;
      im[i] = (im[i] ?? 0) / n;
    }
  }
}

/** In-place 2-D FFT of a w × h complex image (both powers of two). */
export function fft2(
  re: Float64Array,
  im: Float64Array,
  w: number,
  h: number,
  inverse = false,
): void {
  const rr = new Float64Array(w);
  const ri = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    rr.set(re.subarray(o, o + w));
    ri.set(im.subarray(o, o + w));
    fft1(rr, ri, inverse);
    re.set(rr, o);
    im.set(ri, o);
  }
  const cr = new Float64Array(h);
  const ci = new Float64Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      cr[y] = re[y * w + x] ?? 0;
      ci[y] = im[y * w + x] ?? 0;
    }
    fft1(cr, ci, inverse);
    for (let y = 0; y < h; y++) {
      re[y * w + x] = cr[y] ?? 0;
      im[y * w + x] = ci[y] ?? 0;
    }
  }
}

export const isPow2 = (n: number): boolean => n > 0 && (n & (n - 1)) === 0;
export const nextPow2 = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

export interface Peak {
  /** Shift of `b` relative to `a` (b(x) ≈ a(x − d)), wrapped to [−n/2, n/2). */
  dx: number;
  dy: number;
  /** Height of the correlation peak (1 = identical images). */
  peak: number;
  /** Peak over the next best peak outside its neighbourhood. */
  ratio: number;
}

/**
 * Phase correlation of two real w × h images: the shift that best maps `a`
 * onto `b`, with a sub-pixel estimate from a 3-point parabola per axis.
 */
export function phaseCorrelate(a: Float64Array, b: Float64Array, w: number, h: number): Peak {
  const ar = Float64Array.from(a);
  const ai = new Float64Array(a.length);
  const br = Float64Array.from(b);
  const bi = new Float64Array(b.length);
  fft2(ar, ai, w, h);
  fft2(br, bi, w, h);
  // Cross-power spectrum B·conj(A) / |B·conj(A)|.
  for (let i = 0; i < ar.length; i++) {
    const xr = (br[i] ?? 0) * (ar[i] ?? 0) + (bi[i] ?? 0) * (ai[i] ?? 0);
    const xi = (bi[i] ?? 0) * (ar[i] ?? 0) - (br[i] ?? 0) * (ai[i] ?? 0);
    const m = Math.hypot(xr, xi) + 1e-12;
    ar[i] = xr / m;
    ai[i] = xi / m;
  }
  fft2(ar, ai, w, h, true);
  return findPeak(ar, w, h);
}

export function findPeak(c: Float64Array, w: number, h: number): Peak {
  let best = 0;
  for (let i = 1; i < c.length; i++) if ((c[i] ?? 0) > (c[best] ?? 0)) best = i;
  const px = best % w;
  const py = Math.floor(best / w);
  const at = (x: number, y: number): number => c[((y + h) % h) * w + ((x + w) % w)] ?? 0;
  const p = at(px, py);
  const sub = (l: number, m: number, r: number): number => {
    const d = l - 2 * m + r;
    return Math.abs(d) < 1e-12 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / d));
  };
  let dx = px + sub(at(px - 1, py), p, at(px + 1, py));
  let dy = py + sub(at(px, py - 1), p, at(px, py + 1));
  if (dx >= w / 2) dx -= w;
  if (dy >= h / 2) dy -= h;
  // Second peak: the best value at least 3 cells (cyclic) away from the first.
  let second = 1e-9;
  for (let y = 0; y < h; y++) {
    const ddy = Math.min(Math.abs(y - py), h - Math.abs(y - py));
    for (let x = 0; x < w; x++) {
      const ddx = Math.min(Math.abs(x - px), w - Math.abs(x - px));
      if (ddx <= 2 && ddy <= 2) continue;
      const v = c[y * w + x] ?? 0;
      if (v > second) second = v;
    }
  }
  return { dx, dy, peak: p, ratio: p / second };
}
