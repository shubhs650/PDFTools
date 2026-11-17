// Copy or save an image on the page (M11-08·O6, ADR-028): which picture of the
// page content is under the pointer. Pure: the workers walk the page's objects
// (pageImages.ts) and use these for the geometry, the same way in the Render
// worker (the menu's hit test) and the Work worker (the extraction).

/** A PDF matrix [a b c d e f]: (x, y) → (a·x + c·y + e, b·x + d·y + f). */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Images smaller than this in either dimension (pixels) are rules, dots and bullets (as Export Images). */
export const MIN_IMAGE_PX = 16;

/** `m` then `n` (a child's matrix inside its form's). */
export function mul(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

/**
 * Whether user-space point (x, y) is on an image drawn with `m` (its unit
 * square mapped to the page), with `slack` points around it. A flat matrix
 * (zero area) is never hit.
 */
export function onImage(m: Matrix, x: number, y: number, slack = 0): boolean {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return false;
  const dx = x - m[4];
  const dy = y - m[5];
  // The point in the image's unit square.
  const u = (m[3] * dx - m[2] * dy) / det;
  const v = (m[0] * dy - m[1] * dx) / det;
  // Slack in points, along each side of the image.
  const su = slack / Math.max(Math.hypot(m[0], m[1]), 1e-9);
  const sv = slack / Math.max(Math.hypot(m[2], m[3]), 1e-9);
  return u >= -su && u <= 1 + su && v >= -sv && v <= 1 + sv;
}

/**
 * A page point (top-left origin of the visible page, unrotated, as the viewer's
 * page points) in PDF user space, given the visible box's left and top edges.
 */
export function toUserSpace(
  at: { x: number; y: number },
  box: { left: number; top: number },
): { x: number; y: number } {
  return { x: box.left + at.x, y: box.top - at.y };
}

/** What the page menu learns about the image under the pointer: its own size in pixels. */
export interface PageImageHit {
  width: number;
  height: number;
}

/** The file name Save Image As suggests: `<document>-page-<n>-image.png`. Pure. */
export function imageFileName(docName: string, page: number): string {
  const base = docName.replace(/\.pdf$/iu, '').trim() || 'document';
  return `${base}-page-${String(page + 1)}-image.png`;
}
