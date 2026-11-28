// Scale viewports edited on the page (M14-09, D-77, Q22, Q36): a viewport's
// rectangle moved or resized by one of its eight handles, kept inside the page
// and never smaller than a viewport can be. Pure; page points with the origin
// at the top left (y down), as the page is drawn before its turn.
import type { PdfJson } from './pdf/wire';
import { viewportsFromPdf, type Pt } from './scale';
import { coversPage, type Box } from './scaleViewport';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** A resize handle: an edge (n, e, s, w) or a corner. */
export type BoxHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** In reading order round the box, from the top-left corner. */
export const BOX_HANDLES: readonly BoxHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** The smallest a viewport can be (points), as when it is drawn (M3-17). */
export const MIN_VIEWPORT = 4;

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** The rectangle moved by (dx, dy), stopped at the page's edges. */
export function moveRect(r: Rect, dx: number, dy: number, page: Size): Rect {
  return {
    ...r,
    left: clamp(r.left + dx, 0, Math.max(0, page.width - r.width)),
    top: clamp(r.top + dy, 0, Math.max(0, page.height - r.height)),
  };
}

/** Where a handle sits on the rectangle. */
export function handlePoint(r: Rect, h: BoxHandle): Pt {
  const x = h.includes('w') ? r.left : h.includes('e') ? r.left + r.width : r.left + r.width / 2;
  const y = h.includes('n') ? r.top : h.includes('s') ? r.top + r.height : r.top + r.height / 2;
  return { x, y };
}

/**
 * The rectangle with handle `h` dragged to `p`: the edges it holds follow the
 * point, the others stay. An edge stops at the page's edge and at `min` from
 * the opposite edge (a viewport is never turned inside out).
 */
export function resizeRect(r: Rect, h: BoxHandle, p: Pt, page: Size, min = MIN_VIEWPORT): Rect {
  let x1 = r.left;
  let y1 = r.top;
  let x2 = r.left + r.width;
  let y2 = r.top + r.height;
  if (h.includes('w')) x1 = clamp(p.x, 0, x2 - min);
  if (h.includes('e')) x2 = clamp(p.x, x1 + min, page.width);
  if (h.includes('n')) y1 = clamp(p.y, 0, y2 - min);
  if (h.includes('s')) y2 = clamp(p.y, y1 + min, page.height);
  return { left: x1, top: y1, width: x2 - x1, height: y2 - y1 };
}

/** A handle moved by (dx, dy) from the keyboard: an edge moves along its own axis only. */
export function stepHandle(
  r: Rect,
  h: BoxHandle,
  dx: number,
  dy: number,
  page: Size,
  min = MIN_VIEWPORT,
): Rect {
  const at = handlePoint(r, h);
  return resizeRect(r, h, { x: at.x + dx, y: at.y + dy }, page, min);
}

/** The same rectangle (to within 0.01 pt): nothing to change. */
export function sameRect(a: Rect, b: Rect): boolean {
  const near = (x: number, y: number): boolean => Math.abs(x - y) < 0.01;
  return (
    near(a.left, b.left) && near(a.top, b.top) && near(a.width, b.width) && near(a.height, b.height)
  );
}

/**
 * Whether the pick still names the same viewport after its page's list
 * changed: moved, resized or re-scaled in place (M14-09) keeps it; a viewport
 * added or deleted, or another one now at its index, drops it.
 */
export function samePick(
  before: readonly PdfJson[],
  after: readonly PdfJson[],
  index: number,
  media: Box,
): boolean {
  if (before.length !== after.length) return false;
  const [was] = viewportsFromPdf([before[index] ?? null]);
  const [now] = viewportsFromPdf([after[index] ?? null]);
  return !!was && !!now && was.name === now.name && !coversPage(now.bbox, media);
}
