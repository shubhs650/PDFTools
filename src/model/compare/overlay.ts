// The overlay's pixel work (M12-11, D-59, ADR-032 S29): pure functions run by
// the Render worker next to its renders, never on the main thread (rule 1).
//
// Input: each revision rendered at the current zoom, without comments, as an
// 8-bit grey picture (paper 255, full ink 0). Output: opaque RGBA. Each
// revision's ink is a tint of its colour (ink 0 = the full colour, paper =
// white) and the two tints are multiplied: red ink over green ink is black,
// ink over paper keeps its colour. Three 256 × 256 lookup tables per style
// make composing a tile one table read per pixel (S29: 2–5 ms a 512 px tile).

export type Rgb = readonly [number, number, number];

export const RED: Rgb = [255, 0, 0];
export const GREEN: Rgb = [0, 255, 0];
export const BLUE: Rgb = [0, 0, 255];
export const MAGENTA: Rgb = [255, 0, 255];

/** The colour presets (D-59, Q12): red/green, red/blue, magenta/green (colour-blind safe). */
export type ColourPreset = 'redGreen' | 'redBlue' | 'magentaGreen';

export const PRESETS: Record<ColourPreset, { a: Rgb; b: Rgb }> = {
  redGreen: { a: RED, b: GREEN },
  redBlue: { a: RED, b: BLUE },
  magentaGreen: { a: MAGENTA, b: GREEN },
};

export const PRESET_ORDER: readonly ColourPreset[] = ['redGreen', 'redBlue', 'magentaGreen'];

export interface OverlayStyle {
  /** Document A's (old) and Document B's (new) colour. */
  colA: Rgb;
  colB: Rgb;
  /** Show the old / new revision (the floating bar's switches). */
  showA: boolean;
  showB: boolean;
  /** −1 old only … 0 both … +1 new only. */
  balance: number;
  /** Fade unchanged: 0 off … 1 (shared ink drawn as FADE_GREY). */
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

/** One channel of the result for inks ia, ib (0 … 1) and the tint channels ca, cb (0 … 1). */
function channel(ia: number, ib: number, ca: number, cb: number, fade: number): number {
  let v = (1 - ia * (1 - ca)) * (1 - ib * (1 - cb));
  if (fade > 0) {
    const both = Math.min(ia, ib);
    v += (FADE_GREY / 255 - v) * both * fade;
  }
  return v;
}

/** The three lookup tables of a style, indexed by (grey A << 8 | grey B). */
export type StyleTables = readonly [Uint8Array, Uint8Array, Uint8Array];

/** The style as three 256 × 256 tables: about 3 ms to build, once per style change. */
export function styleTables(style: OverlayStyle): StyleTables {
  const [wa, wb] = weights(style);
  const fade = style.fade > 0 && wa > 0 && wb > 0 ? style.fade : 0;
  const table = (c: 0 | 1 | 2): Uint8Array => {
    const t = new Uint8Array(65536);
    const ca = style.colA[c] / 255;
    const cb = style.colB[c] / 255;
    for (let ga = 0; ga < 256; ga++) {
      const ia = (1 - ga / 255) * wa;
      for (let gb = 0; gb < 256; gb++) {
        const ib = (1 - gb / 255) * wb;
        t[ga * 256 + gb] = Math.round(255 * channel(ia, ib, ca, cb, fade));
      }
    }
    return t;
  };
  return [table(0), table(1), table(2)];
}

/** A key that is the same for two styles exactly when their tables are. */
export const styleKey = (s: OverlayStyle): string =>
  [...s.colA, ...s.colB, s.showA ? 1 : 0, s.showB ? 1 : 0, s.balance, s.fade].join(',');

/**
 * Tint and Multiply. `a` and `b` are grey pictures of the same size; null is a
 * blank side (a sheet only in one revision). Returns opaque RGBA.
 */
export function compose(
  a: Uint8Array | null,
  b: Uint8Array | null,
  width: number,
  height: number,
  tables: StyleTables,
  out: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(width * height * 4),
): Uint8ClampedArray<ArrayBuffer> {
  const [tr, tg, tb] = tables;
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
 * Draws straight-alpha RGBA (comments) over opaque RGBA, in place. A side's
 * comments are drawn on top in their own colours (D-59, Q10).
 */
export function over(dst: Uint8ClampedArray, src: Uint8ClampedArray | Uint8Array): void {
  const n = Math.min(dst.length, src.length);
  for (let o = 0; o < n; o += 4) {
    const al = src[o + 3] ?? 0;
    if (al === 0) continue;
    if (al === 255) {
      dst[o] = src[o] ?? 0;
      dst[o + 1] = src[o + 1] ?? 0;
      dst[o + 2] = src[o + 2] ?? 0;
      continue;
    }
    const k = al / 255;
    for (let c = 0; c < 3; c++) dst[o + c] = (src[o + c] ?? 0) * k + (dst[o + c] ?? 0) * (1 - k);
  }
}

/**
 * Thicken thin lines: grey dilation of ink (a minimum filter over a square of
 * side 2r+1), separable. r = 1 turns a one-pixel hairline into three pixels.
 * The source must carry r pixels of margin on each side so tiles join without
 * seams (the caller renders the tile r pixels larger and crops).
 */
export function thicken(src: Uint8Array, width: number, height: number, r = 1): Uint8Array {
  const tmp = new Uint8Array(src.length);
  const out = new Uint8Array(src.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let m = 255;
      const x1 = Math.min(width - 1, x + r);
      for (let k = Math.max(0, x - r); k <= x1; k++) {
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

/** Cuts the inner w × h from a picture `fullW` wide with `m` pixels of margin on each side. */
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
  return Math.max(a[0] * b[0], a[1] * b[1], a[2] * b[2]) / 255 < limit;
}

/** `#rrggbb` → Rgb. */
export function rgbOf(hex: string): Rgb {
  const v = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? '000000';
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Rgb → `#rrggbb`. */
export const hexOf = (c: Rgb): string =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** The preset two colours make, or null (custom colours). */
export function presetOf(a: Rgb, b: Rgb): ColourPreset | null {
  const same = (x: Rgb, y: Rgb): boolean => x[0] === y[0] && x[1] === y[1] && x[2] === y[2];
  return PRESET_ORDER.find((p) => same(PRESETS[p].a, a) && same(PRESETS[p].b, b)) ?? null;
}

/** Counts of the overlay's pixel classes (tests and e2e checks). */
export interface PixelClasses {
  white: number;
  black: number;
  colA: number;
  colB: number;
  other: number;
}

/**
 * Sorts RGBA pixels by what they show: "black" when every channel ≤ tol,
 * "colA"/"colB" when close to that tint at any strength, white when every
 * channel ≥ 255 − tol.
 */
export function classify(
  rgba: Uint8ClampedArray | Uint8Array,
  style: Pick<OverlayStyle, 'colA' | 'colB'> = DEFAULT_STYLE,
  tol = 8,
): PixelClasses {
  const res: PixelClasses = { white: 0, black: 0, colA: 0, colB: 0, other: 0 };
  // A tint of colour c at strength s is 255 − s·(255 − c) per channel.
  const near = (ch: readonly number[], col: Rgb): boolean => {
    let s = -1;
    for (let c = 0; c < 3; c++) {
      const span = 255 - col[c as 0 | 1 | 2];
      if (span > 40) {
        const sc = (255 - (ch[c] ?? 0)) / span;
        if (s < 0) s = sc;
        else if (Math.abs(sc - s) * span > tol * 2) return false;
      }
    }
    if (s < 0.15) return false;
    for (let c = 0; c < 3; c++) {
      const want = 255 - s * (255 - col[c as 0 | 1 | 2]);
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
    else if (near([r, g, b], style.colA)) res.colA++;
    else if (near([r, g, b], style.colB)) res.colB++;
    else res.other++;
  }
  return res;
}
