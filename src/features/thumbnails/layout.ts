// Thumbnail list geometry (M2-08): every page's box at a fixed width, stacked
// with a label under each; which items a scroll position shows. Pure, so the
// list can hold thousands of pages and render only the visible ones.

export interface ThumbLayout {
  /** Top of item i (CSS px); tops[n] is the total height. */
  tops: Float64Array;
  /** Image height of item i at the thumbnail width. */
  imageHeights: Float64Array;
}

export interface LayoutOptions {
  width: number;
  labelHeight: number;
  gap: number;
}

/** `sizes` are the pages as shown (rotation already applied). */
export function thumbLayout(
  sizes: readonly { width: number; height: number }[],
  o: LayoutOptions,
): ThumbLayout {
  const n = sizes.length;
  const tops = new Float64Array(n + 1);
  const imageHeights = new Float64Array(n);
  let y = o.gap;
  for (let i = 0; i < n; i++) {
    const s = sizes[i] ?? { width: 1, height: 1 };
    const h = Math.round((o.width * s.height) / Math.max(1, s.width));
    tops[i] = y;
    imageHeights[i] = h;
    y += h + o.labelHeight + o.gap;
  }
  tops[n] = y;
  return { tops, imageHeights };
}

/** Index of the item containing `y` (clamped to the list). */
export function itemAt(layout: ThumbLayout, y: number): number {
  const n = layout.imageHeights.length;
  if (n === 0) return 0;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((layout.tops[mid] ?? 0) <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** First and last item to render for a viewport, with `overscan` extra on each side. */
export function visibleRange(
  layout: ThumbLayout,
  scrollTop: number,
  viewHeight: number,
  overscan = 2,
): [number, number] {
  const n = layout.imageHeights.length;
  if (n === 0) return [0, -1];
  const first = Math.max(0, itemAt(layout, scrollTop) - overscan);
  const last = Math.min(n - 1, itemAt(layout, scrollTop + viewHeight) + overscan);
  return [first, last];
}
