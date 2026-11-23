// Page pictures of the input window (M12-24, ADR-033): the width a page is
// drawn at to fit a box, turned by its own /Rotate. Pure.

export interface PageShape {
  width: number;
  height: number;
  /** Quarter turns of the page's own /Rotate. */
  rotation: number;
}

/** The page's size as shown (its /Rotate applied), in its own units. */
export function shownSize(p: PageShape): { width: number; height: number } {
  return p.rotation % 2 === 1
    ? { width: p.height, height: p.width }
    : { width: p.width, height: p.height };
}

/**
 * The width (CSS px, whole) a page is shown at to fit inside a `box` of
 * width × height, keeping its shape: a landscape drawing takes the box's
 * width, a portrait page its height. Never less than 1 px.
 */
export function fitWidth(p: PageShape, box: { width: number; height: number }): number {
  const s = shownSize(p);
  if (s.width <= 0 || s.height <= 0) return Math.max(1, Math.round(box.width));
  const k = Math.min(box.width / s.width, box.height / s.height);
  return Math.max(1, Math.round(s.width * k));
}

/** The height shown for a page drawn `width` px wide. */
export function heightAt(p: PageShape, width: number): number {
  const s = shownSize(p);
  return s.width > 0 ? Math.round((width * s.height) / s.width) : width;
}
