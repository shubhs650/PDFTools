// The custom icons of the M13 commands (ADR-010 decision 3, rule 15): drawn here
// in Fluent's Regular line style on the 20-unit grid, with a Filled variant for
// the toggle's pressed state. Nothing is copied or traced from another
// product's artwork.
import { bar, poly, type Pt } from './draw';
import type { Design } from './m3';

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** A rounded tile (corner radius 2) as a closed outline. */
function tile(x0: number, y0: number, x1: number, y1: number, r: number): Pt[] {
  const pts: Pt[] = [];
  const corner = (cx: number, cy: number, from: number): void => {
    for (let i = 0; i <= 4; i++) {
      const t = ((from + (i / 4) * 90) * Math.PI) / 180;
      pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
  };
  corner(x1 - r, y0 + r, 270);
  corner(x1 - r, y1 - r, 0);
  corner(x0 + r, y1 - r, 90);
  corner(x0 + r, y0 + r, 180);
  return pts;
}

/**
 * Thin Lines (M13-05, D-69): three lines of falling weight (heavy, medium, thin);
 * pressed, a solid tile with three equally thin lines cut out of it: every line
 * drawn at the same thinnest width.
 */
export const THIN_LINES: Design = {
  regular: (k) => [
    bar([3.5, 4.5], [16.5, 4.5], k, 3),
    bar([3.5, 10], [16.5, 10], k, 2),
    bar([3.5, 15.5], [16.5, 15.5], k, 1),
  ],
  filled: (k) => [
    [
      poly(tile(2, 2, 18, 18, 2.5), k),
      poly(rect(5, 5.5, 15, 6.5), k, true),
      poly(rect(5, 9.5, 15, 10.5), k, true),
      poly(rect(5, 13.5, 15, 14.5), k, true),
    ].join(' '),
  ],
};

/** Command id → design (small buttons only). */
export const M13_DESIGNS: Record<string, { design: Design; large?: true }> = {
  'view.thinLines': { design: THIN_LINES },
};
