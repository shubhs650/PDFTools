// Crop pages (M11-08·O9, D-55, ADR-028): the page's new /CropBox from margins
// cut off the page as it is shown now. Margins are given as the page is seen
// (its own /Rotate applied, the view's rotation not), in points; the box is in
// PDF user space. Pure: shared by the dialog, the crop tool and the Render
// worker's page operation.
import { POINTS_PER_UNIT, type BlankUnit } from './blankSize';

/** Points cut off each side of the page as it is shown (its /Rotate applied). */
export interface CropMargins {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A rectangle in PDF user space (bottom-left origin), as /CropBox and /MediaBox are. */
export interface UserBox {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

/** PDF's smallest page side at unit size 1 (ISO 32000-1 Annex C): a crop leaves at least this. */
export const CROP_MIN_SIDE = 3;

export const NO_MARGINS: CropMargins = { left: 0, top: 0, right: 0, bottom: 0 };

const SIDES = ['left', 'top', 'right', 'bottom'] as const;

/** Every margin a finite number, none negative (a crop never adds to the page). */
export function marginsValid(m: CropMargins): boolean {
  return SIDES.every((s) => Number.isFinite(m[s]) && m[s] >= 0);
}

export const isZero = (m: CropMargins): boolean => SIDES.every((s) => m[s] === 0);

/**
 * The margins in user space for a page turned `rotation` quarter turns
 * clockwise: which side of the stored page each shown side is. Turned 90°,
 * the stored page's left edge is shown on top (its bottom-left corner moves
 * to the top-left).
 */
export function userInsets(rotation: number, m: CropMargins): CropMargins {
  switch (((rotation % 4) + 4) % 4) {
    case 1:
      return { left: m.top, top: m.right, right: m.bottom, bottom: m.left };
    case 2:
      return { left: m.right, top: m.bottom, right: m.left, bottom: m.top };
    case 3:
      return { left: m.bottom, top: m.left, right: m.top, bottom: m.right };
    default:
      return { ...m };
  }
}

/**
 * The inverse of `userInsets`: margins of the stored page (before its
 * /Rotate) as the page turned `rotation` quarter turns is shown.
 */
export const shownMargins = (rotation: number, m: CropMargins): CropMargins =>
  userInsets(4 - (((rotation % 4) + 4) % 4), m);

/** The part of `crop` inside `media`: what PDFium shows (ISO 32000-1 §14.11.2). */
export function visibleBox(media: UserBox, crop: UserBox | null): UserBox {
  const n = normBox(media);
  if (!crop) return n;
  const c = normBox(crop);
  const out = {
    left: Math.max(n.left, c.left),
    bottom: Math.max(n.bottom, c.bottom),
    right: Math.min(n.right, c.right),
    top: Math.min(n.top, c.top),
  };
  // No overlap: PDFium falls back to the media box.
  return out.right > out.left && out.top > out.bottom ? out : n;
}

export function normBox(b: UserBox): UserBox {
  return {
    left: Math.min(b.left, b.right),
    bottom: Math.min(b.bottom, b.top),
    right: Math.max(b.left, b.right),
    top: Math.max(b.bottom, b.top),
  };
}

/**
 * The new /CropBox: `margins` (as shown) cut off `visible` (the page as shown
 * now, in user space) on a page turned `rotation`. Null when the margins are
 * invalid or leave less than CROP_MIN_SIDE either way.
 */
export function croppedBox(
  visible: UserBox,
  rotation: number,
  margins: CropMargins,
): UserBox | null {
  if (!marginsValid(margins)) return null;
  const v = normBox(visible);
  const i = userInsets(rotation, margins);
  const out = {
    left: v.left + i.left,
    bottom: v.bottom + i.bottom,
    right: v.right - i.right,
    top: v.top - i.top,
  };
  if (out.right - out.left < CROP_MIN_SIDE - 1e-6 || out.top - out.bottom < CROP_MIN_SIDE - 1e-6)
    return null;
  return out;
}

/** Whether margins leave at least CROP_MIN_SIDE of a page shown `width` × `height` points. */
export function marginsFit(size: { width: number; height: number }, m: CropMargins): boolean {
  return (
    marginsValid(m) &&
    size.width - m.left - m.right >= CROP_MIN_SIDE - 1e-6 &&
    size.height - m.top - m.bottom >= CROP_MIN_SIDE - 1e-6
  );
}

/**
 * Margins that keep `rect` (points from the top-left corner of a page
 * `width` × `height`) of it: what a drag with the crop tool keeps. Clamped to
 * the page.
 */
export function marginsFromRect(
  rect: { x: number; y: number; width: number; height: number },
  size: { width: number; height: number },
): CropMargins {
  const x0 = Math.min(Math.max(0, rect.x), size.width);
  const y0 = Math.min(Math.max(0, rect.y), size.height);
  const x1 = Math.min(Math.max(x0, rect.x + rect.width), size.width);
  const y1 = Math.min(Math.max(y0, rect.y + rect.height), size.height);
  return { left: x0, top: y0, right: size.width - x1, bottom: size.height - y1 };
}

/** The page kept by `m`, in points from the shown page's top-left corner (the dialog's preview). */
export function keptRect(
  size: { width: number; height: number },
  m: CropMargins,
): { x: number; y: number; width: number; height: number } {
  return {
    x: m.left,
    y: m.top,
    width: Math.max(0, size.width - m.left - m.right),
    height: Math.max(0, size.height - m.top - m.bottom),
  };
}

/** Whether the page shows less than its media box (it has a crop to remove). */
export function isCropped(media: UserBox, crop: UserBox | null): boolean {
  const m = normBox(media);
  const v = visibleBox(media, crop);
  const eps = 1e-3;
  return (
    v.left - m.left > eps ||
    v.bottom - m.bottom > eps ||
    m.right - v.right > eps ||
    m.top - v.top > eps
  );
}

/** A margin typed in `unit` ("12", "12,5", empty for 0) in points; null when not a number. */
export function marginToPoints(text: string, unit: BlankUnit): number | null {
  const s = text.trim().replace(',', '.');
  if (s === '') return 0;
  if (!/^\d+(\.\d+)?$|^\.\d+$/u.test(s)) return null;
  return Number(s) * POINTS_PER_UNIT[unit];
}
