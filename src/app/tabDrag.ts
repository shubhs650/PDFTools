// Drag to reorder the file tabs (M11-04, ADR-028 D-50): the pure geometry. The strip
// measures each tab once when a drag starts (its left edge and width in the row's
// content coordinates, so scrolling the row does not move them); everything else per
// pointer move is arithmetic, and only `transform` changes on screen (rule 1).

/** One tab (the tab and its ×) in the row's content coordinates, in tab order. */
export interface TabSlot {
  left: number;
  width: number;
}

/** A press becomes a drag after the pointer moves this far (mouse and pen). */
export const DRAG_THRESHOLD_PX = 4;
/** On touch, holding a tab this long lifts it; moving first scrolls the row. */
export const TOUCH_HOLD_MS = 300;
/** Within this distance of either end of a scrolling row, the row scrolls. */
export const AUTO_SCROLL_ZONE_PX = 40;
/** The fastest auto-scroll, in pixels per frame (at or past the row's end). */
export const AUTO_SCROLL_MAX_PX = 14;

const centre = (s: TabSlot): number => s.left + s.width / 2;

/**
 * Where the dragged tab may be: from the first tab's left edge to the last tab's right
 * edge (it never leaves the row).
 */
export function clampLeft(slots: readonly TabSlot[], from: number, left: number): number {
  const first = slots[0];
  const last = slots[slots.length - 1];
  const dragged = slots[from];
  if (!first || !last || !dragged) return left;
  const max = last.left + last.width - dragged.width;
  return Math.min(Math.max(left, first.left), Math.max(first.left, max));
}

/**
 * The index the dragged tab drops at when its left edge is at `left`: it passes a
 * neighbour once its leading edge crosses the neighbour's centre (half of the neighbour
 * covered, Chrome-like), so held against either end of the row it always reaches that
 * end. The thresholds are the neighbours' resting centres, so the result is a step
 * function of the position and never flickers between two answers.
 */
export function dropIndex(slots: readonly TabSlot[], from: number, left: number): number {
  const dragged = slots[from];
  if (!dragged) return from;
  const right = left + dragged.width;
  let to = from;
  slots.forEach((s, j) => {
    if (j < from && left < centre(s)) to--;
    else if (j > from && right > centre(s)) to++;
  });
  return to;
}

/**
 * How far tab `j` slides while the dragged tab (from `from`, `width` wide) would drop
 * at `to`: the tabs it passed make room on the side it came from.
 */
export function shiftFor(j: number, from: number, to: number, width: number): number {
  if (from < to && j > from && j <= to) return -width;
  if (to < from && j >= to && j < from) return width;
  return 0;
}

/**
 * Auto-scroll speed (pixels per frame, negative to the left) for the pointer at `x`,
 * with the row's visible part from `start` to `end`: zero in the middle, ramping up
 * inside the zone at either end, the maximum at or past the end.
 */
export function edgeSpeed(
  x: number,
  start: number,
  end: number,
  zone = AUTO_SCROLL_ZONE_PX,
  max = AUTO_SCROLL_MAX_PX,
): number {
  if (end - start <= 2 * zone) return 0;
  if (x < start + zone) return -Math.ceil(max * Math.min(1, (start + zone - x) / zone));
  if (x > end - zone) return Math.ceil(max * Math.min(1, (x - (end - zone)) / zone));
  return 0;
}

/**
 * Drop a tab on a tab (M12-21·O4, D-58): the lifted tab held still this long over another
 * document tab makes that tab the drop target ("Compare these two"); moving on reorders.
 */
export const COMPARE_HOLD_MS = 500;
/** The pointer moves less than this while the hold time runs (it is held still). */
export const COMPARE_STILL_PX = 4;
/** Once a target is taken, moving this far lets it go and the reorder goes on. */
export const COMPARE_RELEASE_PX = 12;
/** The lifted tab covers at least this share of the narrower tab to drop on it. */
export const COMPARE_COVER = 0.25;

/**
 * The tab the lifted tab (from `from`, its left edge at `left`, dropping at `to`) is
 * over, for dropping it on that tab: of the tabs `eligible` accepts, the one it covers
 * most where they are shown now (each at its slot, moved by `shiftFor`), covering at
 * least `COMPARE_COVER` of the narrower of the two. Null when none.
 */
export function coveredTab(
  slots: readonly TabSlot[],
  from: number,
  to: number,
  left: number,
  eligible: (j: number) => boolean = () => true,
): number | null {
  const dragged = slots[from];
  if (!dragged) return null;
  const right = left + dragged.width;
  let best: number | null = null;
  let bestCover = 0;
  slots.forEach((s, j) => {
    if (j === from || !eligible(j)) return;
    const l = s.left + shiftFor(j, from, to, dragged.width);
    const cover = Math.min(right, l + s.width) - Math.max(left, l);
    const narrower = Math.min(dragged.width, s.width);
    if (narrower <= 0 || cover < COMPARE_COVER * narrower || cover <= bestCover) return;
    best = j;
    bestCover = cover;
  });
  return best;
}
