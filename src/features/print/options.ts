// Print options (D-25, §7.13, M2-15): pure parsing and math for the dialog
// and the print job. Page numbers in ranges are 1-based for people; indexes
// out of here are 0-based.

export type RangeKind = 'all' | 'current' | 'view' | 'area' | 'custom';
export type ScaleMode = 'fit' | 'actual' | 'custom';
export type Markups = 'on' | 'off' | 'only';
export type Quality = 'standard' | 'high';
/** Raster pages in our print frame, or the print-ready copy in the browser's PDF viewer (M2-16). */
export type Method = 'raster' | 'viewer';

export interface PrintOptions {
  range: RangeKind;
  /** Custom range text, e.g. "1-3, 8". */
  custom: string;
  scale: ScaleMode;
  /** Custom scale in percent. */
  percent: number;
  markups: Markups;
  quality: Quality;
  method: Method;
}

export const DEFAULT_OPTIONS: PrintOptions = {
  range: 'all',
  custom: '',
  scale: 'fit',
  percent: 100,
  markups: 'on',
  quality: 'standard',
  method: 'raster',
};

/** Raster resolution per quality (ADR-013 finding 5). */
export const DPI: Record<Quality, number> = { standard: 150, high: 300 };
/** Pixels per printed page at most (ADR-013 decision 5: ~100 MP, A0 at ≤ 200 DPI). */
export const MAX_PIXELS = 100_000_000;
/** Rows per rendered band (ADR-013 finding 5). */
export const BAND_ROWS = 1024;
export const PERCENT_MIN = 10;
export const PERCENT_MAX = 400;

export type RangeError = 'empty' | 'syntax' | 'outOfRange';
export type RangeResult = { ok: true; pages: number[] } | { ok: false; error: RangeError };

/**
 * A custom range: numbers and spans ("3-5", "5-" to the end, "-3" from the
 * start) separated by commas, semicolons or spaces; any dash (-, –, —).
 * Pages keep the order written; repeats print again, as typed.
 */
export function parseRange(text: string, pageCount: number): RangeResult {
  const parts = text
    .normalize('NFKC') // full-width digits and punctuation
    .split(/[,;\s]+/)
    .filter((p) => p !== '');
  if (parts.length === 0) return { ok: false, error: 'empty' };
  const pages: number[] = [];
  for (const part of parts) {
    let from: number;
    let to: number;
    const span = /^(\d*)[-‐‑‒–—](\d*)$/.exec(part);
    if (span) {
      if (span[1] === '' && span[2] === '') return { ok: false, error: 'syntax' };
      from = span[1] ? Number(span[1]) : 1;
      to = span[2] ? Number(span[2]) : pageCount;
    } else if (/^\d+$/.test(part)) {
      from = to = Number(part);
    } else return { ok: false, error: 'syntax' };
    if (from < 1 || to < 1 || from > pageCount || to > pageCount)
      return { ok: false, error: 'outOfRange' };
    const step = from <= to ? 1 : -1;
    for (let p = from; p !== to + step; p += step) pages.push(p - 1);
  }
  return { ok: true, pages };
}

/** A region of a page in points, from its top-left corner (the viewer's page space). */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Raster {
  /** Pixels per point. */
  scale: number;
  /** Resolution used (lower than asked when the pixel cap applies). */
  dpi: number;
  width: number;
  height: number;
  capped: boolean;
}

/** Pixel size of a region printed at `dpi`, capped at MAX_PIXELS. */
export function rasterSize(region: Pick<Region, 'width' | 'height'>, dpi: number): Raster {
  const at = (d: number) => ({
    width: Math.max(1, Math.round((region.width * d) / 72)),
    height: Math.max(1, Math.round((region.height * d) / 72)),
  });
  let used = dpi;
  let size = at(used);
  const capped = size.width * size.height > MAX_PIXELS;
  if (capped) {
    used = Math.floor(dpi * Math.sqrt(MAX_PIXELS / (size.width * size.height)));
    size = at(used);
    while (size.width * size.height > MAX_PIXELS && used > 1) size = at(--used);
  }
  return { scale: used / 72, dpi: used, ...size, capped };
}

/** Band tops for a raster `height` px tall. */
export function bands(height: number, rows = BAND_ROWS): { top: number; rows: number }[] {
  const out: { top: number; rows: number }[] = [];
  for (let top = 0; top < height; top += rows)
    out.push({ top, rows: Math.min(rows, height - top) });
  return out;
}

/**
 * The printed size of a page in points: null = fit to the paper (the print
 * document scales it); actual = its own size; custom = size × percent.
 */
export function printedSize(
  region: Pick<Region, 'width' | 'height'>,
  mode: ScaleMode,
  percent: number,
): { width: number; height: number } | null {
  if (mode === 'fit') return null;
  const f = mode === 'actual' ? 1 : clampPercent(percent) / 100;
  return { width: region.width * f, height: region.height * f };
}

export const clampPercent = (p: number): number =>
  Math.min(PERCENT_MAX, Math.max(PERCENT_MIN, Number.isFinite(p) ? p : 100));

export const isPercentValid = (p: number): boolean =>
  Number.isFinite(p) && p >= PERCENT_MIN && p <= PERCENT_MAX;

/** Orientation auto: a landscape page prints on landscape paper. */
export const isLandscape = (r: Pick<Region, 'width' | 'height'>): boolean => r.width > r.height;

export type ViewerBlock = 'range' | 'markups' | 'quality';

/**
 * Why the browser-viewer route can't print these options (null: it can). It
 * prints whole pages of the flattened copy, with or without markups, at full
 * (vector) quality: not a view or an area, not markups only, and not when
 * the document allows only standard-quality printing (rule 9).
 */
export function viewerBlock(
  opts: Pick<PrintOptions, 'range' | 'markups'>,
  highQualityAllowed: boolean,
): ViewerBlock | null {
  if (!highQualityAllowed) return 'quality';
  if (opts.range === 'view' || opts.range === 'area') return 'range';
  if (opts.markups === 'only') return 'markups';
  return null;
}
