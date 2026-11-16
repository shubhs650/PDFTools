// Create Blank PDF sizes (M10-08·O4, D-49). Pure: shared by the dialog and the
// Work worker's checks.

export type BlankPaper = 'a4' | 'a3' | 'letter' | 'legal' | 'custom';
export type BlankOrientation = 'portrait' | 'landscape';
export type BlankUnit = 'mm' | 'in';

export const BLANK_PAPERS: readonly BlankPaper[] = ['a4', 'a3', 'letter', 'legal', 'custom'];

/** Portrait width and height in points (ISO 216, ANSI). */
export const BLANK_PAPER_POINTS: Record<Exclude<BlankPaper, 'custom'>, [number, number]> = {
  a4: [595.28, 841.89],
  a3: [841.89, 1190.55],
  letter: [612, 792],
  legal: [612, 1008],
};

/** Half an inch: smaller pages are not useful to draw on. */
export const BLANK_MIN_SIDE = 36;
/** PDF's largest page side at unit size 1 (200 in, ISO 32000-1 Annex C). */
export const BLANK_MAX_SIDE = 14_400;
export const BLANK_MAX_PAGES = 1000;

export const POINTS_PER_UNIT: Record<BlankUnit, number> = { mm: 72 / 25.4, in: 72 };

/** A side typed by the user ("210", "8,5") in points, or null when not a number. */
export function sideToPoints(text: string, unit: BlankUnit): number | null {
  const s = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return null;
  return Number(s) * POINTS_PER_UNIT[unit];
}

export const sideOk = (pt: number | null): pt is number =>
  pt !== null && pt >= BLANK_MIN_SIDE - 1e-6 && pt <= BLANK_MAX_SIDE + 1e-6;

/** The limits in `unit`, rounded inwards to one decimal, for the error text. */
export function sideLimits(unit: BlankUnit): { min: number; max: number } {
  const per = POINTS_PER_UNIT[unit];
  return {
    // The epsilon keeps 5080 mm from becoming 5079.9 through float error.
    min: Math.ceil((BLANK_MIN_SIDE / per) * 10 - 1e-6) / 10,
    max: Math.floor((BLANK_MAX_SIDE / per) * 10 + 1e-6) / 10,
  };
}

/**
 * The page's width and height in points. A paper size takes the orientation;
 * a custom size is used as typed (width × height), clamped to the limits.
 */
export function blankPageSize(
  paper: BlankPaper,
  orientation: BlankOrientation,
  custom: { width: number; height: number },
): { width: number; height: number } {
  if (paper === 'custom') {
    const clamp = (v: number) => Math.min(BLANK_MAX_SIDE, Math.max(BLANK_MIN_SIDE, v));
    return { width: clamp(custom.width), height: clamp(custom.height) };
  }
  const [w, h] = BLANK_PAPER_POINTS[paper];
  return orientation === 'landscape' ? { width: h, height: w } : { width: w, height: h };
}

/** The page count typed by the user, or null when not a whole number in range. */
export function pageCountOf(text: string): number | null {
  const s = text.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= BLANK_MAX_PAGES ? n : null;
}

/**
 * The next "Untitled n" number: the smallest n ≥ 1 whose name is not already
 * an open tab's, so each new document gets its own name.
 */
export function nextUntitled(openNames: readonly string[], nameOf: (n: number) => string): string {
  const taken = new Set(openNames.map((s) => s.toLowerCase()));
  for (let n = 1; ; n++) {
    const name = nameOf(n);
    if (!taken.has(name.toLowerCase())) return name;
  }
}
