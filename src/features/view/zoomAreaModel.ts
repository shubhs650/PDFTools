// Zoom to Area (M11-08·O4, ADR-028): drag a rectangle over the view and it
// fills the window. The rectangle is in viewport pixels (the visible part of
// the scroller), so a drag may start in the grey around the pages, cross page
// gaps and work at any view rotation. Pure.
import { clampZoom } from './zoom';

/** A rectangle in viewport pixels (left/top from the scroller's visible top-left). */
export interface Area {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * A side shorter than this (CSS px) does not limit the zoom: a thin drag
 * along a dimension line fits its length, not its 2 px height.
 */
export const MIN_AREA_SIDE = 8;

/** The rectangle between two pointer positions. */
export function areaBetween(a: Point, b: Point): Area {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** Whether a drag of this size zooms to its area (smaller is a click). */
export function isAreaDrag(area: Area): boolean {
  return area.width >= MIN_AREA_SIDE || area.height >= MIN_AREA_SIDE;
}

/**
 * The zoom at which `area` (drawn at the zoom `current`) fills a viewport of
 * `view` pixels, less `gap` on each side; clamped to the zoom range. The
 * longer side relative to the window decides, so all of the area stays in view.
 */
export function areaZoom(
  area: Area,
  view: { width: number; height: number },
  current: number,
  gap: number,
): number {
  const fits: number[] = [];
  const w = view.width - 2 * gap;
  const h = view.height - 2 * gap;
  if (area.width >= MIN_AREA_SIDE && w > 0) fits.push(w / area.width);
  if (area.height >= MIN_AREA_SIDE && h > 0) fits.push(h / area.height);
  if (fits.length === 0) return clampZoom(current);
  return clampZoom(current * Math.min(...fits));
}

/** Where `p` lies in `box` as fractions of its width and height (0–1 inside it). */
export function fractionIn(p: Point, box: DOMRectLike): Point {
  return {
    x: box.width > 0 ? (p.x - box.left) / box.width : 0.5,
    y: box.height > 0 ? (p.y - box.top) / box.height : 0.5,
  };
}

export interface DOMRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Squared distance from `p` to `box` (0 inside it): the nearest page to a press. */
export function distanceTo(p: Point, box: DOMRectLike): number {
  const dx = Math.max(box.left - p.x, 0, p.x - (box.left + box.width));
  const dy = Math.max(box.top - p.y, 0, p.y - (box.top + box.height));
  return dx * dx + dy * dy;
}

/**
 * How far to scroll so the point at fraction `f` of `box` comes to `target`
 * (all in client pixels).
 */
export function scrollToPlace(box: DOMRectLike, f: Point, target: Point): Point {
  return {
    x: box.left + f.x * box.width - target.x,
    y: box.top + f.y * box.height - target.y,
  };
}
