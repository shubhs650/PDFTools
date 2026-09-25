// Zoom math (§5, M1-15). Plugin scale 1 = 100 % = one PDF point per CSS pixel
// (ADR-011 decision 5 set the range 1 %–6400 % as scale 0.01–64). Fit page and
// fit width are the zoom plugin's modes; fit visible and actual size are ours.
import { parseLocaleNumber } from '../../i18n/format';
import { MAX_ZOOM, MIN_ZOOM } from './plugins';

/** Zoom In / Zoom Out stops, as factors (1 = 100 %). */
export const ZOOM_STEPS: readonly number[] = [
  0.01,
  0.02,
  0.03,
  0.05,
  0.0833,
  0.125,
  0.25,
  1 / 3,
  0.5,
  2 / 3,
  0.75,
  1,
  1.25,
  1.5,
  2,
  3,
  4,
  6,
  8,
  12,
  16,
  24,
  32,
  48,
  64,
];

/** The zoom menu's fixed levels. */
export const ZOOM_PRESETS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2, 4, 8];

const EPS = 1e-6;

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** The next stop strictly above (dir 1) or below (dir -1) `current`, clamped. */
export function stepZoom(current: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > current * (1 + EPS)) ?? MAX_ZOOM;
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    const s = ZOOM_STEPS[i];
    if (s !== undefined && s < current * (1 - EPS)) return s;
  }
  return MIN_ZOOM;
}

/** Ctrl+wheel: a smooth factor per wheel delta, clamped. */
export function wheelZoom(current: number, deltaY: number): number {
  return clampZoom(current * Math.exp(-deltaY * 0.002));
}

/** "150", "150%", "150 %", "12,5 %" (de) → 1.5 / 0.125; null if not a zoom. Clamped. */
export function parseZoomInput(text: string, locale: string): number | null {
  const n = parseLocaleNumber(text.replace(/[%٪]/g, ''), locale);
  if (n === null || !(n > 0)) return null;
  return clampZoom(n / 100);
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * A box in an unrotated page's top-left coordinates, as seen after the page
 * is rotated clockwise by `rotation` degrees (0, 90, 180, 270).
 */
export function rotateBox(box: Box, page: Size, rotation: number): Box {
  const { width: w, height: h } = page;
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { left: h - box.bottom, top: box.left, right: h - box.top, bottom: box.right };
    case 180:
      return { left: w - box.right, top: h - box.bottom, right: w - box.left, bottom: h - box.top };
    case 270:
      return { left: box.top, top: w - box.right, right: box.bottom, bottom: w - box.left };
    default:
      return { ...box };
  }
}

/**
 * Fit visible: the zoom at which the page's content (not its margins) fills
 * the viewport width. `box` is already rotated; `gap` is the padding each side.
 */
export function fitVisibleZoom(box: Box, viewportWidth: number, gap: number): number | null {
  const width = box.right - box.left;
  if (!(width > 0)) return null;
  return clampZoom((viewportWidth - 2 * gap) / width);
}

/**
 * Scroll offsets that keep the document point under (vx, vy) — viewport
 * coordinates — in place when the zoom changes from `from` to `to`.
 */
export function zoomAtPoint(
  scroll: { left: number; top: number },
  point: { vx: number; vy: number },
  from: number,
  to: number,
): { left: number; top: number } {
  const k = to / from;
  return {
    left: (scroll.left + point.vx) * k - point.vx,
    top: (scroll.top + point.vy) * k - point.vy,
  };
}
