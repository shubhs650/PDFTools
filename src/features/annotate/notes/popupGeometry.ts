// Where a sticky note's pop-up window sits (M7-06, ADR-023 D-44). Pure.
//
// The pop-up's /Rect is in EmbedPDF's device space (top-left origin, points,
// the unrotated page), like every annotation rect. On screen the window
// follows the page (scroll, zoom, rotation) by its top-left corner, and keeps
// its own size and stays upright, as /F NoZoom and NoRotate ask: its width and
// height in points are CSS pixels at any zoom. "View" space is the rotated
// page box the scroller lays out, in CSS pixels.

export interface DeviceRect {
  origin: { x: number; y: number };
  size: { width: number; height: number };
}

/** A box in view space (CSS px within the rotated page box). */
export interface ViewBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PageFrame {
  /** Unrotated page size in points. */
  width: number;
  height: number;
  /** Quarter turns clockwise (page /Rotate plus the view's rotation). */
  rotation: number;
  scale: number;
}

/** The default window, in points (CSS px). */
export const POPUP_SIZE = { width: 240, height: 168 };
/** The smallest window the resize grip allows. */
export const POPUP_MIN = { width: 160, height: 112 };
/** Gap between the note and a new window, in CSS px. */
const GAP = 12;

const quarter = (r: number): 0 | 1 | 2 | 3 => (((Math.round(r) % 4) + 4) % 4) as 0 | 1 | 2 | 3;

/** A device point → view space. */
export function pointToView(x: number, y: number, f: PageFrame): { x: number; y: number } {
  const s = f.scale;
  switch (quarter(f.rotation)) {
    case 0:
      return { x: x * s, y: y * s };
    case 1:
      return { x: (f.height - y) * s, y: x * s };
    case 2:
      return { x: (f.width - x) * s, y: (f.height - y) * s };
    case 3:
      return { x: y * s, y: (f.width - x) * s };
  }
}

/** The view-space box a device rect covers (a note's icon, say). */
export function rectToView(r: DeviceRect, f: PageFrame): ViewBox {
  const a = pointToView(r.origin.x, r.origin.y, f);
  const b = pointToView(r.origin.x + r.size.width, r.origin.y + r.size.height, f);
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** The pop-up window on screen: the rect's top-left in view, its own size, upright. */
export function popupToView(r: DeviceRect, f: PageFrame): ViewBox {
  const cover = rectToView(r, f);
  return { left: cover.left, top: cover.top, width: r.size.width, height: r.size.height };
}

/** The inverse of `popupToView`: a window at `box` (view space) as a device rect. */
export function popupFromView(box: ViewBox, f: PageFrame): DeviceRect {
  const s = f.scale;
  const w = box.width;
  const h = box.height;
  const vx = box.left / s;
  const vy = box.top / s;
  let x: number;
  let y: number;
  switch (quarter(f.rotation)) {
    case 0:
      x = vx;
      y = vy;
      break;
    case 1:
      x = vy;
      y = f.height - h - vx;
      break;
    case 2:
      x = f.width - w - vx;
      y = f.height - h - vy;
      break;
    case 3:
      x = f.width - w - vy;
      y = vx;
      break;
  }
  return { origin: { x, y }, size: { width: w, height: h } };
}

/**
 * Keeps a window inside the page box where it fits (else at the page's
 * top-left edge): it can always be grabbed by its header.
 */
export function clampToPage(box: ViewBox, f: PageFrame): ViewBox {
  const turned = quarter(f.rotation) % 2 === 1;
  const pw = (turned ? f.height : f.width) * f.scale;
  const ph = (turned ? f.width : f.height) * f.scale;
  const left = Math.max(0, Math.min(box.left, pw - box.width));
  const top = Math.max(0, Math.min(box.top, ph - box.height));
  return { ...box, left, top };
}

/**
 * Where a note's window opens the first time: to the right of the note on
 * screen, its top level with the note's; on the left when the right has no
 * room; inside the page.
 */
export function defaultPopupRect(note: DeviceRect, f: PageFrame): DeviceRect {
  const icon = rectToView(note, f);
  const turned = quarter(f.rotation) % 2 === 1;
  const pw = (turned ? f.height : f.width) * f.scale;
  const { width, height } = POPUP_SIZE;
  const right = icon.left + icon.width + GAP;
  const left = right + width <= pw ? right : icon.left - GAP - width;
  return popupFromView(clampToPage({ left, top: icon.top, width, height }, f), f);
}

/**
 * The leader from the note to its window (view space): from the note's
 * centre to the nearest point of the window's edge. Null when they overlap.
 */
export function leader(
  icon: ViewBox,
  win: ViewBox,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const cx = icon.left + icon.width / 2;
  const cy = icon.top + icon.height / 2;
  const x2 = Math.max(win.left, Math.min(cx, win.left + win.width));
  const y2 = Math.max(win.top, Math.min(cy, win.top + win.height));
  if (x2 === cx && y2 === cy) return null;
  return { x1: cx, y1: cy, x2, y2 };
}

/** A window moved by (dx, dy) or resized by (dw, dh) CSS px, kept usable. */
export function moved(box: ViewBox, dx: number, dy: number, f: PageFrame): ViewBox {
  return clampToPage({ ...box, left: box.left + dx, top: box.top + dy }, f);
}

export function resized(box: ViewBox, dw: number, dh: number, f: PageFrame): ViewBox {
  const turned = quarter(f.rotation) % 2 === 1;
  const pw = (turned ? f.height : f.width) * f.scale;
  const ph = (turned ? f.width : f.height) * f.scale;
  const maxW = Math.max(POPUP_MIN.width, pw - box.left);
  const maxH = Math.max(POPUP_MIN.height, ph - box.top);
  return {
    ...box,
    width: Math.round(Math.max(POPUP_MIN.width, Math.min(maxW, box.width + dw))),
    height: Math.round(Math.max(POPUP_MIN.height, Math.min(maxH, box.height + dh))),
  };
}
