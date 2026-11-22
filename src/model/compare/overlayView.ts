// The overlay window's geometry (M12-11, D-59): which tiles cover the view,
// in what order, and the matrices that draw each revision into a tile. Pure:
// the window asks the Render worker for tiles by these numbers.
//
// Spaces: a sheet is drawn in Document B's displayed space (points, top left,
// y down, /Rotate and the crop box applied; D-60: the old revision is drawn
// in the new revision's frame). A sheet only in Document A uses A's own
// displayed space. A tile is `TILE` device pixels square at `scale` device
// pixels per point.
import { IDENTITY, thenAffine, type Affine } from './material';

/** Tile side in device pixels (S29: 512 px, centre first). */
export const TILE = 512;

/** Zoom limits (fraction of 100 %), as the document view's. */
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 64;

/** CSS pixels per point at 100 % (96 / 72). */
export const CSS_PER_PT = 96 / 72;

export interface TileSpec {
  /** Unique per zoom: `${col}:${row}`. */
  key: string;
  col: number;
  row: number;
  /** Top-left corner and size in device pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The tiles of a `sheetW` × `sheetH` device-pixel sheet that meet the view
 * rectangle (device pixels, relative to the sheet's top left), centre first.
 */
export function visibleTiles(
  sheetW: number,
  sheetH: number,
  view: { x: number; y: number; w: number; h: number },
  tile = TILE,
): TileSpec[] {
  const x0 = Math.max(0, view.x);
  const y0 = Math.max(0, view.y);
  const x1 = Math.min(sheetW, view.x + view.w);
  const y1 = Math.min(sheetH, view.y + view.h);
  if (x1 <= x0 || y1 <= y0) return [];
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const out: (TileSpec & { d: number })[] = [];
  for (let row = Math.floor(y0 / tile); row * tile < y1; row++)
    for (let col = Math.floor(x0 / tile); col * tile < x1; col++) {
      const x = col * tile;
      const y = row * tile;
      const w = Math.min(tile, sheetW - x);
      const h = Math.min(tile, sheetH - y);
      if (w <= 0 || h <= 0) continue;
      out.push({
        key: `${String(col)}:${String(row)}`,
        col,
        row,
        x,
        y,
        w,
        h,
        d: Math.hypot(x + w / 2 - cx, y + h / 2 - cy),
      });
    }
  return out.sort((a, b) => a.d - b.d).map(({ d: _d, ...t }) => t);
}

/**
 * A sheet's displayed space → the tile's pixels at `scale` px/pt, with the
 * side's placement first (A's alignment into B's frame; identity for B).
 */
export function tileMatrix(scale: number, x: number, y: number, place: Affine = IDENTITY): Affine {
  return thenAffine(place, [scale, 0, 0, scale, -x, -y]);
}

/** Device pixels of a `w` × `h` pt sheet at `scale` px/pt (at least one). */
export const sheetPixels = (w: number, h: number, scale: number): { w: number; h: number } => ({
  w: Math.max(1, Math.round(w * scale)),
  h: Math.max(1, Math.round(h * scale)),
});

export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Zoom that fits a `w` × `h` pt sheet in a `vw` × `vh` CSS px view, with a margin. */
export function fitZoom(
  mode: 'page' | 'width',
  w: number,
  h: number,
  vw: number,
  vh: number,
  margin = 24,
): number {
  const sw = Math.max(1, vw - 2 * margin) / (w * CSS_PER_PT);
  const sh = Math.max(1, vh - 2 * margin) / (h * CSS_PER_PT);
  return clampZoom(mode === 'width' ? sw : Math.min(sw, sh));
}

/** The zoom steps of Zoom in / Zoom out (percent), as the document view's. */
export const ZOOM_STEPS = [
  0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64,
];

export function stepZoom(z: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > z * 1.001) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((s) => s < z / 1.001) ?? MIN_ZOOM;
}

/**
 * Scroll position that keeps the sheet point under (px, py) — CSS pixels in
 * the view — in place when the zoom changes from z0 to z1. `pad` is the space
 * around the sheet in the scroll area.
 */
export function zoomScroll(
  scroll: { left: number; top: number },
  at: { x: number; y: number },
  z0: number,
  z1: number,
  pad: { x: number; y: number } = { x: 0, y: 0 },
): { left: number; top: number } {
  const k = z1 / z0;
  return {
    left: (scroll.left + at.x - pad.x) * k + pad.x - at.x,
    top: (scroll.top + at.y - pad.y) * k + pad.y - at.y,
  };
}
