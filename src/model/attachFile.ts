// Attach File comments (M6-10, ADR-021 D-38 d, ADR-022 decision 1): where the
// paperclip goes, how big a file may be, and the paperclip's appearance
// stream. Pure: used by the main thread (placement, the size check) and the
// Render worker (the appearance it writes).

/** Largest file a comment may carry: the plan's 25 MB (decimal, as the app shows sizes). */
export const ATTACH_MAX_BYTES = 25 * 1000 * 1000;

/** The paperclip icon's side on the page, in points (like a note icon). */
export const ATTACH_ICON_SIZE = 20;

/** Comment default colour (D-37: comments are red unless the user changes it). */
export const ATTACH_DEFAULT_COLOR = '#FF0000';

export interface Point {
  x: number;
  y: number;
}

export interface DeviceRect {
  origin: Point;
  size: { width: number; height: number };
}

/**
 * The icon's rect for a click at `at` (device space: top-left origin, points):
 * centred on the click, kept inside the page.
 */
export function attachRect(at: Point, page: { width: number; height: number }): DeviceRect {
  const s = ATTACH_ICON_SIZE;
  const clamp = (v: number, max: number) => Math.min(Math.max(0, v), Math.max(0, max - s));
  return {
    origin: { x: clamp(at.x - s / 2, page.width), y: clamp(at.y - s / 2, page.height) },
    size: { width: s, height: s },
  };
}

/** `#RRGGBB` → PDF RGB operands (0 … 1, three decimals); black when unreadable. */
export function rgbOperands(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const v = m?.[1] ?? '000000';
  const c = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  return c.map((x) => String(Math.round(x * 1000) / 1000)).join(' ');
}

/**
 * Our own paperclip (rule 15: not copied artwork), drawn in a 20 × 20 box with
 * round 1.5-unit strokes in the Fluent manner.
 */
const PAPERCLIP =
  '13 5 m 13 14 l 13 16.2 11.2 18 9 18 c 6.8 18 5 16.2 5 14 c 5 6 l ' +
  '5 3.8 6.8 2 9 2 c 11.2 2 13 3.8 13 6 c 13 13 l ' +
  '13 14.1 12.1 15 11 15 c 9.9 15 9 14.1 9 13 c 9 7 l S';

/** A box in PDF page space (lower-left origin). */
export interface PageBox {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

const num = (v: number) => String(Math.round(v * 1000) / 1000);

/**
 * The /AP /N content: PDFium's FPDFAnnot_SetAP gives the stream /BBox = /Rect
 * in page space, so the drawing is placed at the rect, scaled from 20 × 20.
 * A faint white backing keeps the clip readable on dark content.
 */
export function paperclipAppearance(box: PageBox, hex: string): string {
  const w = Math.max(1, box.right - box.left);
  const h = Math.max(1, box.top - box.bottom);
  const sx = w / ATTACH_ICON_SIZE;
  const sy = h / ATTACH_ICON_SIZE;
  return (
    `q ${num(sx)} 0 0 ${num(sy)} ${num(box.left)} ${num(box.bottom)} cm ` +
    `1 1 1 RG 3.5 w 1 J 1 j ${PAPERCLIP} ` +
    `${rgbOperands(hex)} RG 1.5 w ${PAPERCLIP} Q`
  );
}
