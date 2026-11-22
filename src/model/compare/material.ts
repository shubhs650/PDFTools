// What a comparison is computed from (M12-07, D-66, ADR-031, ADR-032): the
// material the Work worker reads from each document — a page's frame, its
// signature, its positioned text and its analysis raster in bands — in the
// typed-array form the Compare worker works on. Pure code: no PDFium, no DOM.
//
// Every coordinate is in the **displayed page's space**: points, origin top
// left, y down, /Rotate and the CropBox applied, as the viewer shows the page
// (the space the spikes S28 – S30 measured in).

/** An affine map [a, b, c, d, e, f]: (x, y) → (a x + c y + e, b x + d y + f). */
export type Affine = [number, number, number, number, number, number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export const applyAffine = (m: Affine, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

/** The first map, then the second. */
export const thenAffine = (first: Affine, second: Affine): Affine => [
  second[0] * first[0] + second[2] * first[1],
  second[1] * first[0] + second[3] * first[1],
  second[0] * first[2] + second[2] * first[3],
  second[1] * first[2] + second[3] * first[3],
  second[0] * first[4] + second[2] * first[5] + second[4],
  second[1] * first[4] + second[3] * first[5] + second[5],
];

/** A page as displayed. */
export interface PageFrame {
  /** Displayed size in points (after /Rotate). */
  width: number;
  height: number;
  /** /Rotate in quarter turns. */
  rotation: 0 | 1 | 2 | 3;
  /** The page's user space → displayed space. */
  toDisplay: Affine;
}

/** Side length of the signature's ink picture (S28: 32 × 32). */
export const SIGNATURE_GRID = 32;

/**
 * A page's signature for pairing (D-60, S28): a coarse picture of its ink
 * (the page squeezed to a fixed grid, so the same sheet at A1 and A3 looks
 * the same) and the words on it.
 */
export interface PageSignature {
  frame: PageFrame;
  /** SIGNATURE_GRID² values, zero mean and unit length (all zero on a blank page). */
  ink: Float32Array;
  /** The page's words in content order (positioned characters joined on a line). */
  words: string[];
}

/** Bits of `PageText.flags`. */
export const TEXT_GENERATED = 1;
/** Render mode 3: an OCR layer over a scan. */
export const TEXT_INVISIBLE = 2;
export const TEXT_BOLD = 4;

/**
 * A page's positioned characters (D-61's text layer, D-63's input), in typed
 * arrays: S30 measured 250 MB as objects on the 500-page contract.
 */
export interface PageText {
  frame: PageFrame;
  /** One code point per character. */
  codes: Uint32Array;
  /** Loose box per character: x0, y0, x1, y1. */
  boxes: Float32Array;
  /** Baseline origin per character: x, y. */
  origins: Float32Array;
  /** Font size per character, in points. */
  sizes: Float32Array;
  /** Text direction per character, degrees (0 = left to right). */
  angles: Float32Array;
  /** TEXT_GENERATED | TEXT_INVISIBLE | TEXT_BOLD. */
  flags: Uint8Array;
}

/** Analysis resolution (S28: 150 dpi; 100 dpi is the fallback for very large sheets). */
export const ANALYSIS_DPI = 150;
/** Rows a band holds at most (S28: the detector must work in bands, never a whole sheet). */
export const BAND_ROWS = 512;
/** Largest analysis raster side PDFium is asked for (an ARCH E sheet at 150 dpi is 7,500 px). */
export const MAX_RASTER_SIDE = 16_000;

/**
 * Rows `top` … `top + rows − 1` of an analysis raster: ink per pixel,
 * 255 − the darkest of R, G and B (coloured lines count, light fills hardly),
 * page content only (no comments, no form fields).
 */
export interface RasterBand {
  /** Raster width in pixels (the whole frame). */
  width: number;
  /** Raster height in pixels (the whole frame). */
  height: number;
  top: number;
  rows: number;
  /** width × rows ink values. */
  data: Uint8Array;
}

/** The analysis raster's size for a frame of `width` × `height` points at `dpi`. */
export function rasterSize(
  width: number,
  height: number,
  dpi: number,
): { width: number; height: number } {
  const s = dpi / 72;
  return {
    width: Math.max(1, Math.round(width * s)),
    height: Math.max(1, Math.round(height * s)),
  };
}

/** Row ranges of a raster `height` px tall in bands of at most `rows`. */
export function bandRanges(height: number, rows = BAND_ROWS): { top: number; rows: number }[] {
  const out: { top: number; rows: number }[] = [];
  const step = Math.max(1, Math.floor(rows));
  for (let top = 0; top < height; top += step)
    out.push({ top, rows: Math.min(step, height - top) });
  return out;
}

/** In-place box blur of a w × h grid with radius r (zero outside). */
export function boxBlur(img: Float32Array, w: number, h: number, r: number): void {
  if (r <= 0) return;
  const line = new Float32Array(Math.max(w, h));
  const pass = (n: number, at: (i: number) => number): void => {
    for (let i = 0; i < n; i++) line[i] = img[at(i)] ?? 0;
    let acc = 0;
    for (let i = 0; i <= Math.min(r, n - 1); i++) acc += line[i] ?? 0;
    for (let i = 0; i < n; i++) {
      img[at(i)] = acc / (2 * r + 1);
      const add = i + r + 1;
      const sub = i - r;
      if (add < n) acc += line[add] ?? 0;
      if (sub >= 0) acc -= line[sub] ?? 0;
    }
  };
  for (let y = 0; y < h; y++) pass(w, (i) => y * w + i);
  for (let x = 0; x < w; x++) pass(h, (i) => i * w + x);
}

/**
 * The signature's ink picture from an ink raster of any size (S28): the
 * raster summed onto the grid, square-rooted (tames the frame and solid
 * fills), blurred by one cell (tolerates a shift), then zero mean and unit
 * length so a dot product is a correlation.
 */
export function inkPicture(ink: Uint8Array, w: number, h: number): Float32Array {
  const n = SIGNATURE_GRID;
  const g = new Float32Array(n * n);
  if (w <= 0 || h <= 0) return g;
  for (let y = 0; y < h; y++) {
    const gy = Math.min(n - 1, Math.floor((y * n) / h)) * n;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const v = ink[row + x] ?? 0;
      if (v === 0) continue;
      const gx = Math.min(n - 1, Math.floor((x * n) / w));
      g[gy + gx] = (g[gy + gx] ?? 0) + v / 255;
    }
  }
  for (let i = 0; i < g.length; i++) g[i] = Math.sqrt(g[i] ?? 0);
  boxBlur(g, n, n, 1);
  let mean = 0;
  for (const v of g) mean += v;
  mean /= g.length;
  let norm = 0;
  for (let i = 0; i < g.length; i++) {
    const v = (g[i] ?? 0) - mean;
    g[i] = v;
    norm += v * v;
  }
  norm = Math.sqrt(norm);
  if (norm < 1e-9) return g.fill(0);
  for (let i = 0; i < g.length; i++) g[i] = (g[i] ?? 0) / norm;
  return g;
}

/**
 * Words from positioned characters in content order (S28): a character joins
 * the current word when it is on the same line and close after the last one,
 * along the text's own direction (a sheet's vertical labels read as words).
 * Generated characters (spaces and line ends PDFium adds) and blanks split.
 */
export function wordsOf(t: PageText): string[] {
  const out: string[] = [];
  let cur = '';
  let lx = 0;
  let ly = 0;
  let ls = 0;
  let la = 0;
  let has = false;
  for (let i = 0; i < t.codes.length; i++) {
    const code = t.codes[i] ?? 0;
    const blank = code <= 32 || code === 0xa0 || ((t.flags[i] ?? 0) & TEXT_GENERATED) !== 0;
    if (blank) {
      if (cur) out.push(cur);
      cur = '';
      has = false;
      continue;
    }
    const x0 = t.boxes[i * 4] ?? 0;
    const y0 = t.boxes[i * 4 + 1] ?? 0;
    const x1 = t.boxes[i * 4 + 2] ?? 0;
    const y1 = t.boxes[i * 4 + 3] ?? 0;
    const x = (x0 + x1) / 2;
    const y = (y0 + y1) / 2;
    const a = ((t.angles[i] ?? 0) * Math.PI) / 180;
    // Direction of reading in displayed space (y down) and the size across it.
    const dx = Math.cos(a);
    const dy = -Math.sin(a);
    const s = Math.max(Math.abs((x1 - x0) * dy) + Math.abs((y1 - y0) * dx), 0.1);
    let near = false;
    if (has && Math.abs(a - la) < 0.1) {
      const along = (x - lx) * dx + (y - ly) * dy;
      const across = Math.abs((x - lx) * dy - (y - ly) * dx);
      const size = Math.max(s, ls);
      near = across < size * 0.5 && along > -0.1 && along < size * 1.2;
    }
    if (!near && cur) {
      out.push(cur);
      cur = '';
    }
    cur += String.fromCodePoint(code);
    lx = x;
    ly = y;
    ls = s;
    la = a;
    has = true;
  }
  if (cur) out.push(cur);
  return out;
}

/** Bytes a page's text holds (the Compare worker's memory account). */
export function textBytes(t: PageText): number {
  return (
    t.codes.byteLength +
    t.boxes.byteLength +
    t.origins.byteLength +
    t.sizes.byteLength +
    t.angles.byteLength +
    t.flags.byteLength
  );
}

/** Bytes a signature holds (words counted as UTF-16). */
export function signatureBytes(s: PageSignature): number {
  let n = s.ink.byteLength;
  for (const w of s.words) n += w.length * 2;
  return n;
}

/** The buffers of a page's text, to transfer instead of copy. */
export function textBuffers(t: PageText): ArrayBuffer[] {
  return [
    ...new Set(
      [t.codes, t.boxes, t.origins, t.sizes, t.angles, t.flags].map((a) => a.buffer as ArrayBuffer),
    ),
  ];
}
