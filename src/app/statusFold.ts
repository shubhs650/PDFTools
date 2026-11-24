// The status bar's fold (M13-04, D-70): 0 = everything shown, 1 = the view modes
// folded into a menu, 2 = also the status toggles' words hidden (names stay). Pure.

export type Fold = 0 | 1 | 2;

/**
 * The next fold level: one more while the current one does not fit `room`, one less
 * once the level below needed no more than `room` when it was last shown.
 * `needs[level]` is the width a level took when last measured.
 */
export function nextFold(level: Fold, room: number, needs: readonly (number | undefined)[]): Fold {
  const need = needs[level];
  if (need !== undefined && need > room + 0.5 && level < 2) return (level + 1) as Fold;
  const below = level > 0 ? needs[level - 1] : undefined;
  if (below !== undefined && below <= room + 0.5) return (level - 1) as Fold;
  return level;
}
