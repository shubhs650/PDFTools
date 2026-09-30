// Insert Blank Page sizes and positions (M4-09, §7.8). Pure.

export type SizeChoice = 'neighbour' | 'a4' | 'letter' | 'a3';
export type Orientation = 'portrait' | 'landscape';
export type Where = 'before' | 'after';

/** Paper sizes in points (ISO 216, ANSI). */
export const PAPER: Record<Exclude<SizeChoice, 'neighbour'>, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  a3: [841.89, 1190.55],
};

export interface PageSize {
  width: number;
  height: number;
  /** Quarter turns of the page's /Rotate. */
  rotation: number;
}

/**
 * The new page's width and height (unrotated). "Neighbour" copies the page
 * as it is shown (a rotated landscape sheet gives a landscape page); a paper
 * size takes the chosen orientation.
 */
export function blankSize(
  choice: SizeChoice,
  orientation: Orientation,
  neighbour: PageSize | undefined,
): { width: number; height: number } {
  if (choice === 'neighbour' && neighbour) {
    const turned = neighbour.rotation % 2 === 1;
    return turned
      ? { width: neighbour.height, height: neighbour.width }
      : { width: neighbour.width, height: neighbour.height };
  }
  const [w, h] = PAPER[choice === 'neighbour' ? 'a4' : choice];
  return orientation === 'landscape' ? { width: h, height: w } : { width: w, height: h };
}

/** Index of the first new page when inserting before or after page `page` (0-based). */
export function insertAt(where: Where, page: number, pageCount: number): number {
  const at = where === 'before' ? page : page + 1;
  return Math.max(0, Math.min(pageCount, at));
}
