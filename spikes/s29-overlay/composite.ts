// Spike S29 (M12-04, D-59): the overlay's pixel work, as pure functions.
//
// Input: each revision rendered at the current zoom, without comments, as an
// 8-bit grey picture (PDFium renders straight into an FPDFBitmap_Gray, which
// is the "turned to grey" step). Paper is 255, full ink is 0.
//
// Output: RGBA. Each revision's ink is a tint of its colour (ink 0 = the full
// colour, paper = white) and the two tints are multiplied: red ink over green
// ink is black, ink over paper keeps its colour. No main-thread use (rule 1):
// these run in a worker, next to the render.

export type Rgb = readonly [number, number, number];

export const RED: Rgb = [255, 0, 0];
export const GREEN: Rgb = [0, 255, 0];
export const BLUE: Rgb = [0, 0, 255];
export const MAGENTA: Rgb = [255, 0, 255];

export interface OverlayStyle {
  colA: Rgb;
  colB: Rgb;
  /** Show the old / new revision (the floating bar's eye buttons). */
  showA: boolean;
  showB: boolean;
  /** −1 old only … 0 both … +1 new only. */
  balance: number;
  /** Fade unchanged: 0 off … 1 (overlap drawn as FADE_GREY). */
  fade: number;
}

export const DEFAULT_STYLE: OverlayStyle = {
  colA: RED,
  colB: GREEN,
  showA: true,
  showB: true,
  balance: 0,
  fade: 0,
};

/** Where Fade unchanged takes the shared ink (light grey, still visible). */
export const FADE_GREY = 200;

/** Ink weights of the two sides from show/hide and balance (each 0 … 1). */
export function weights(s: OverlayStyle): [number, number] {
  const a = s.showA ? Math.min(1, 1 - s.balance) : 0;
  const b = s.showB ? Math.min(1, 1 + s.balance) : 0;
  return [Math.max(0, a), Math.max(0, b)];
}

/**
 * How shared ink is drawn. "multiply": the two tints multiplied, as the
 * browser's compositor and the PDF Multiply blend mode do; where both sides
 * have the same anti-aliased edge (a thin line that did not change) the
 * product is olive, not grey. "neutral": the ink both sides share is drawn
 * as neutral grey and only the rest is tinted, so an unchanged line looks as
 * it does in the normal view; full ink on both sides is black either way.
 */
export type OverlapMode = 'multiply' | 'neutral';

/** One channel of the result for inks ia, ib (0 … 1) and the tint channels ca, cb (0 … 1). */
function channel(
  ia: number,
  ib: number,
  ca: number,
  cb: number,
  mode: OverlapMode,
  fade: number,
): number {
  if (mode === 'multiply') {
    let v = (1 - ia * (1 - ca)) * (1 - ib * (1 - cb));
    if (fade > 0) {
      const both = Math.min(ia, ib);
      v += (FADE_GREY / 255 - v) * both * fade;
    }
    return v;
  }
  const shared = Math.min(ia, ib);
  const grey = 1 - shared * (1 - (fade > 0 ? fade * (FADE_GREY / 255) : 0));
  return grey * (1 - (ia - shared) * (1 - ca)) * (1 - (ib - shared) * (1 - cb));
}

/**
 * The whole style as three 256 × 256 tables indexed by (grey A, grey B): the
 * per-pixel loop is three lookups. About 3 ms to build, once per style change.
 */
export function styleTables(style: OverlayStyle, mode: OverlapMode = 'multiply'): Uint8Array[] {
  const [wa, wb] = weights(style);
  const fade = style.fade > 0 && wa > 0 && wb > 0 ? style.fade : 0;
  return [0, 1, 2].map((c) => {
    const t = new Uint8Array(65536);
    const ca = (style.colA[c] ?? 0) / 255;
    const cb = (style.colB[c] ?? 0) / 255;
    for (let ga = 0; ga < 256; ga++) {
      const ia = (1 - ga / 255) * wa;
      for (let gb = 0; gb < 256; gb++) {
        const ib = (1 - gb / 255) * wb;
        t[ga * 256 + gb] = Math.round(255 * channel(ia, ib, ca, cb, mode, fade));
      }
    }
    return t;
  });
}

/**
 * Tint and Multiply. `a` and `b` are grey pictures of the same size (either
 * may be null: that side is blank, e.g. a sheet only in one revision).
 * Returns RGBA, opaque.
 */
export function compose(
  a: Uint8Array | null,
  b: Uint8Array | null,
  width: number,
  height: number,
  style: OverlayStyle | Uint8Array[] = DEFAULT_STYLE,
  out = new Uint8ClampedArray(width * height * 4),
): Uint8ClampedArray {
  const [tr, tg, tb] = (Array.isArray(style) ? style : styleTables(style)) as [
    Uint8Array,
    Uint8Array,
    Uint8Array,
  ];
  const n = width * height;
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const k = ((a ? (a[i] ?? 255) : 255) << 8) | (b ? (b[i] ?? 255) : 255);
    out[o] = tr[k] ?? 255;
    out[o + 1] = tg[k] ?? 255;
    out[o + 2] = tb[k] ?? 255;
    out[o + 3] = 255;
  }
  return out;
}

/**
 * Thicken thin lines: grey dilation of ink (a minimum filter over a square of
 * side 2r+1), separable. r = 1 turns a one-pixel hairline into three pixels.
 * In place on a copy; the source tile must carry r pixels of margin on each
 * side so tile edges match (the caller renders the tile r pixels larger).
 */
export function thicken(src: Uint8Array, width: number, height: number, r = 1): Uint8Array {
  const tmp = new Uint8Array(src.length);
  const out = new Uint8Array(src.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let m = 255;
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width - 1, x + r);
      for (let k = x0; k <= x1; k++) {
        const v = src[row + k] ?? 255;
        if (v < m) m = v;
      }
      tmp[row + x] = m;
    }
  }
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(height - 1, y + r);
    for (let x = 0; x < width; x++) {
      let m = 255;
      for (let k = y0; k <= y1; k++) {
        const v = tmp[k * width + x] ?? 255;
        if (v < m) m = v;
      }
      out[y * width + x] = m;
    }
  }
  return out;
}

/** Cuts the inner w × h from a picture with `m` pixels of margin on each side. */
export function crop(src: Uint8Array, fullW: number, m: number, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    out.set(src.subarray((y + m) * fullW + m, (y + m) * fullW + m + w), y * w);
  return out;
}

/**
 * Whether two colours give a dark overlap (the custom-colour warning, D-59):
 * the product's brightest channel must stay below `limit`.
 */
export function darkOverlap(a: Rgb, b: Rgb, limit = 64): boolean {
  return Math.max(...[0, 1, 2].map((c) => ((a[c] ?? 0) * (b[c] ?? 0)) / 255)) < limit;
}

/** Counts of the overlay's pixel classes (for tests and the spike's checks). */
export interface PixelClasses {
  white: number;
  black: number;
  colA: number;
  colB: number;
  other: number;
}

/**
 * Sorts RGBA pixels by what they show. A pixel is "black" when every channel
 * is ≤ tol, "colA"/"colB" when it is close to that tint (any strength), white
 * when every channel ≥ 255 − tol.
 */
export function classify(
  rgba: Uint8ClampedArray | Uint8Array,
  style: Pick<OverlayStyle, 'colA' | 'colB'> = DEFAULT_STYLE,
  tol = 8,
): PixelClasses {
  const res: PixelClasses = { white: 0, black: 0, colA: 0, colB: 0, other: 0 };
  // A tint of colour c at strength s is 255 − s·(255 − c) per channel.
  const near = (r: number, g: number, b: number, col: Rgb): boolean => {
    const ch = [r, g, b];
    let s = -1;
    for (let c = 0; c < 3; c++) {
      const span = 255 - (col[c] ?? 0);
      if (span > 40) {
        const sc = (255 - (ch[c] ?? 0)) / span;
        if (s < 0) s = sc;
        else if (Math.abs(sc - s) * span > tol * 2) return false;
      }
    }
    if (s < 0.15) return false;
    for (let c = 0; c < 3; c++) {
      const want = 255 - s * (255 - (col[c] ?? 0));
      if (Math.abs((ch[c] ?? 0) - want) > tol * 2) return false;
    }
    return true;
  };
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i] ?? 0;
    const g = rgba[i + 1] ?? 0;
    const b = rgba[i + 2] ?? 0;
    if (r >= 255 - tol && g >= 255 - tol && b >= 255 - tol) res.white++;
    else if (r <= tol && g <= tol && b <= tol) res.black++;
    else if (near(r, g, b, style.colA)) res.colA++;
    else if (near(r, g, b, style.colB)) res.colB++;
    else res.other++;
  }
  return res;
}
