// Snapshot (M6-09, ADR-021 D-38 e, §7.1): the picture's resolution. Twice the
// screen's (zoom × device pixel ratio × 2), so it stays sharp when pasted and
// scaled, with the longer side capped at 4,096 px (a whole A0 sheet at a high
// zoom would otherwise be hundreds of megapixels). Pure.
import type { Rect, Rotation } from '@embedpdf/models';

/** Smaller than this (points) is a click, not a snapshot. */
export const MIN_SNAPSHOT = 4;
/** Longest side of a snapshot, in pixels. */
export const MAX_SNAPSHOT_SIDE = 4096;
/** Pixels per screen pixel. */
export const SNAPSHOT_OVERSAMPLE = 2;

/** Pixels per point for a region of `rect` at the view's `zoom` (CSS px per point). */
export function snapshotScale(rect: Rect, zoom: number, dpr: number): number {
  const wanted = Math.max(0.01, zoom) * Math.max(1, dpr) * SNAPSHOT_OVERSAMPLE;
  const side = Math.max(rect.size.width, rect.size.height, 1e-6);
  return Math.min(wanted, MAX_SNAPSHOT_SIDE / side);
}

/** The picture's size in pixels as PDFium renders it (rounded, sides swapped for 90°/270°). */
export function snapshotPixels(
  rect: Rect,
  scale: number,
  rotation: Rotation | number,
): { width: number; height: number } {
  const swap = (rotation & 1) === 1;
  const w = swap ? rect.size.height : rect.size.width;
  const h = swap ? rect.size.width : rect.size.height;
  return {
    width: Math.min(MAX_SNAPSHOT_SIDE, Math.max(1, Math.round(w * scale))),
    height: Math.min(MAX_SNAPSHOT_SIDE, Math.max(1, Math.round(h * scale))),
  };
}

/** A drag from `a` to `b` on a page of `width` × `height` points; null when too small. */
export function snapshotRect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  width: number,
  height: number,
): Rect | null {
  const x0 = Math.max(0, Math.min(a.x, b.x));
  const y0 = Math.max(0, Math.min(a.y, b.y));
  const x1 = Math.min(width, Math.max(a.x, b.x));
  const y1 = Math.min(height, Math.max(a.y, b.y));
  if (x1 - x0 < MIN_SNAPSHOT || y1 - y0 < MIN_SNAPSHOT) return null;
  return { origin: { x: x0, y: y0 }, size: { width: x1 - x0, height: y1 - y0 } };
}

/** The keyboard rectangle's first place: the middle of the page, a quarter of its width. */
export function startRect(width: number, height: number): Rect {
  const w = Math.max(MIN_SNAPSHOT * 4, width / 4);
  const h = Math.max(MIN_SNAPSHOT * 4, height / 8);
  return { origin: { x: (width - w) / 2, y: (height - h) / 2 }, size: { width: w, height: h } };
}

/** Moves (or with `resize`, grows) the keyboard rectangle by (dx, dy) points, kept on the page. */
export function nudgeRect(
  r: Rect,
  dx: number,
  dy: number,
  resize: boolean,
  width: number,
  height: number,
): Rect {
  if (resize)
    return {
      origin: r.origin,
      size: {
        width: Math.min(width - r.origin.x, Math.max(MIN_SNAPSHOT, r.size.width + dx)),
        height: Math.min(height - r.origin.y, Math.max(MIN_SNAPSHOT, r.size.height + dy)),
      },
    };
  return {
    origin: {
      x: Math.min(width - r.size.width, Math.max(0, r.origin.x + dx)),
      y: Math.min(height - r.size.height, Math.max(0, r.origin.y + dy)),
    },
    size: r.size,
  };
}
