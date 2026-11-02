// Variable-height virtualization for the Comments pane (M6-05, ADR-021
// consequences): cards are measured once drawn, estimated before; the list
// draws only the rows in view, so 10,000 comments stay smooth (rule 1). Pure.

/** Row tops: `tops[i]` is where row i starts, `tops[n]` the total height. */
export function offsetsOf(heights: ArrayLike<number>): Float64Array {
  const tops = new Float64Array(heights.length + 1);
  for (let i = 0; i < heights.length; i++) tops[i + 1] = (tops[i] ?? 0) + (heights[i] ?? 0);
  return tops;
}

/** The row at height `y` (clamped to the rows; 0 when there are none). */
export function indexAt(tops: Float64Array, y: number): number {
  const n = tops.length - 1;
  if (n <= 0) return 0;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((tops[mid] ?? 0) <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The rows to draw: those in view and `overscan` more on each side (inclusive). */
export function visibleRange(
  tops: Float64Array,
  scrollTop: number,
  viewHeight: number,
  overscan: number,
): [number, number] {
  const n = tops.length - 1;
  if (n <= 0) return [0, -1];
  const first = indexAt(tops, scrollTop);
  const last = indexAt(tops, scrollTop + Math.max(0, viewHeight - 1));
  return [Math.max(0, first - overscan), Math.min(n - 1, last + overscan)];
}

/** The scroll position that shows row i whole (or its top when taller than the view). */
export function scrollToShow(
  tops: Float64Array,
  i: number,
  scrollTop: number,
  viewHeight: number,
): number {
  const top = tops[i];
  const bottom = tops[i + 1];
  if (top === undefined || bottom === undefined) return scrollTop;
  if (top < scrollTop || bottom - top > viewHeight) return top;
  if (bottom > scrollTop + viewHeight) return bottom - viewHeight;
  return scrollTop;
}

/** The row a page away from row i (PageDown / PageUp): about one view's height on. */
export function pageFrom(tops: Float64Array, i: number, viewHeight: number, dir: 1 | -1): number {
  const n = tops.length - 1;
  if (n <= 0) return 0;
  const from = tops[Math.max(0, Math.min(n - 1, i))] ?? 0;
  const to = indexAt(tops, from + dir * Math.max(1, viewHeight - 1));
  // Always move at least one row (a card taller than the view).
  if (to === i) return Math.max(0, Math.min(n - 1, i + dir));
  return to;
}
