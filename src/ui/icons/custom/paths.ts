// Path data for our custom icons, drawn on Fluent's 20 px grid in the Regular
// line style (1-unit strokes as outline shapes, holes by opposite winding) and
// scaled for the 32 px grid (ADR-010 decision 3, rule 15: no third-party artwork).

/** Scales every number in an absolute/relative path made of M/H/V/L/h/v/Z commands. */
export function scalePath(d: string, k: number): string {
  return d.replace(/-?\d*\.?\d+/g, (n) => String(Math.round(Number(n) * k * 100) / 100));
}

/** Rectangle outline (1 unit) as a filled shape: outer clockwise, inner counter-clockwise. */
function outlineRect(x: number, y: number, w: number, h: number): string {
  return `M${String(x)} ${String(y)}h${String(w)}v${String(h)}H${String(x)}Z M${String(x + 1)} ${String(y + 1)}v${String(h - 2)}h${String(w - 2)}V${String(y + 1)}Z`;
}
function solidRect(x: number, y: number, w: number, h: number): string {
  return `M${String(x)} ${String(y)}h${String(w)}v${String(h)}H${String(x)}Z`;
}

// Continuous facing: two stacked pairs of pages (two-up, scrolling).
const PAGES: [number, number][] = [
  [2, 1.5],
  [10.5, 1.5],
  [2, 11],
  [10.5, 11],
];
export const CONTINUOUS_FACING_REGULAR = [
  PAGES.map(([x, y]) => outlineRect(x, y, 7.5, 7.5)).join(' '),
];
export const CONTINUOUS_FACING_FILLED = [
  PAGES.map(([x, y]) => solidRect(x, y, 7.5, 7.5)).join(' '),
];

// Save optimized: a floppy disk (clipped corner, label, shutter) plus a
// "compress" badge: two arrowheads squeezing onto a bar. (An earlier pair of
// inward chevrons read as an "x", i.e. "save cancelled".)
export const SAVE_OPTIMIZED_REGULAR = [
  'M2 2H9.5L12 4.5V12H2Z M3 3V11H11V4.91L9.09 3Z',
  'M5 7.5h4v1H5Z M5 3h3v2H5Z',
  'M13 11.5H19L16 14.5Z',
  'M12.5 15.5h7v1h-7Z',
  'M13 20.5H19L16 17.5Z',
];
