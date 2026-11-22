// Spike S29: sheet geometry for the overlay (D-60's transform folded in).
// Row-vector matrices [a b c d e f] as in PDF: p' = p · M.
import type { Matrix } from './pdfiumKit';

/**
 * A page's user space → its display space (points, top-left origin, y down),
 * for its /Rotate (quarter turns clockwise) and crop box [x0 y0 x1 y1]. This
 * is PDFium's page display matrix at one pixel per point.
 */
export function userToDisplay(
  rotate: number,
  box: readonly [number, number, number, number],
): Matrix {
  const [x0, y0, x1, y1] = box;
  switch (rotate & 3) {
    case 1: // (x, y) → (y − y0, x − x0)
      return [0, 1, 1, 0, -y0, -x0];
    case 2: // (x, y) → (x1 − x, y − y0)
      return [-1, 0, 0, 1, x1, -y0];
    case 3: // (x, y) → (y1 − y, x1 − x)
      return [0, -1, -1, 0, y1, x1];
    default: // (x, y) → (x − x0, y1 − y)
      return [1, 0, 0, -1, -x0, y1];
  }
}

/** Display space of a sheet `h` points tall → the overlay page's user space (y up, origin 0). */
export function displayToOutUser(h: number): Matrix {
  return [1, 0, 0, -1, 0, h];
}

/** The tile matrix: display space → pixels of the tile at (tx, ty) px, zoom z px/pt. */
export function tileMatrix(z: number, tx: number, ty: number, aToB?: Matrix): Matrix {
  const t: Matrix = [z, 0, 0, z, -tx, -ty];
  if (!aToB) return t;
  const [a, b, c, d, e, f] = aToB;
  return [a * z, b * z, c * z, d * z, e * z - tx, f * z - ty];
}
