// Side pane widths (M2-08 left pane; M11-10 Properties pane, ADR-028 D-56). Pure, so the
// splitter's arithmetic is unit tested apart from the DOM.

export const PANE_WIDTH_MIN = 160;
export const PANE_WIDTH_MAX = 480;
export const PANE_WIDTH_DEFAULT = 260; // --pane-width
/** Arrow-key step of a pane splitter, in CSS px. */
export const PANE_RESIZE_STEP = 16;

/**
 * Which side of the document a pane is on. The left pane's splitter is on its right edge and
 * the Properties pane's on its left edge, so the same key or drag widens one and narrows the
 * other.
 */
export type PaneSide = 'left' | 'right';

/** A whole-pixel width within the limits. */
export function clampPaneWidth(px: number): number {
  return Math.round(Math.min(PANE_WIDTH_MAX, Math.max(PANE_WIDTH_MIN, px)));
}

/**
 * The width after `key` on a pane's splitter, or null when the key does not resize. The arrow
 * moves the splitter (ArrowLeft moves it left: the left pane narrows, the Properties pane
 * widens); Home and End go to the narrowest and widest pane.
 */
export function widthForKey(key: string, width: number, side: PaneSide): number | null {
  const sign = side === 'left' ? 1 : -1;
  switch (key) {
    case 'ArrowLeft':
      return clampPaneWidth(width - sign * PANE_RESIZE_STEP);
    case 'ArrowRight':
      return clampPaneWidth(width + sign * PANE_RESIZE_STEP);
    case 'Home':
      return PANE_WIDTH_MIN;
    case 'End':
      return PANE_WIDTH_MAX;
    default:
      return null;
  }
}

/** The width after dragging the splitter `dx` CSS px to the right from a pane `start` wide. */
export function widthForDrag(start: number, dx: number, side: PaneSide): number {
  return clampPaneWidth(side === 'left' ? start + dx : start - dx);
}
