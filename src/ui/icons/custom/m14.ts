// The custom icons of the M14 commands (ADR-010 decision 3, rule 15): drawn here
// in Fluent's Regular line style on the 20-unit grid, with a Filled variant for
// the toggle's pressed state. Nothing is copied or traced from another
// product's artwork.
import { bar, box, dashed, disc, poly, ring, strokes, type Pt } from './draw';
import type { Design } from './m3';

/** An open path of three segments: a Polylength's run. */
const PATH: Pt[] = [
  [2.5, 15.5],
  [7, 6],
  [12.5, 13],
  [17.5, 4],
];

export const POLYLENGTH: Design = {
  // An open path measured along its length, with a vertex marker at every point.
  regular: (k) => [strokes(PATH, k), ...PATH.map(([x, y]) => box(x - 1.5, y - 1.5, 3, 3, k))],
  filled: (k) => [
    strokes(PATH, k, false, 2),
    ...PATH.map(([x, y]) => box(x - 1.75, y - 1.75, 3.5, 3.5, k)),
  ],
};

/** A band along an arc about (cx, cy) from a0 to a1 (radians, screen y down), `w` wide. */
function arcBand(cx: number, cy: number, r: number, a0: number, a1: number, k: number, w = 1) {
  const n = 12;
  const at = (rr: number, t: number): Pt => [cx + rr * Math.cos(t), cy + rr * Math.sin(t)];
  const ts = Array.from({ length: n + 1 }, (_, i) => a0 + ((a1 - a0) * i) / n);
  return poly(
    [...ts.map((t) => at(r + w / 2, t)), ...ts.reverse().map((t) => at(r - w / 2, t))],
    k,
  );
}

/** The corner and the arms of the Angle icon: along the bottom, and up to the right. */
const CORNER: Pt = [3.5, 16];
const ARM_A: Pt = [17, 16];
const ARM_B: Pt = [13.5, 4];
const ARM_B_ANGLE = Math.atan2(ARM_B[1] - CORNER[1], ARM_B[0] - CORNER[0]);

export const ANGLE: Design = {
  // Two arms from a corner and the arc between them (M14-05).
  regular: (k) => [
    bar(CORNER, ARM_A, k),
    bar(CORNER, ARM_B, k),
    arcBand(CORNER[0], CORNER[1], 7, ARM_B_ANGLE, 0, k),
  ],
  filled: (k) => [
    bar(CORNER, ARM_A, k, 2),
    bar(CORNER, ARM_B, k, 2),
    arcBand(CORNER[0], CORNER[1], 7, ARM_B_ANGLE, 0, k, 2),
  ],
};

/** The circle of the Radius and Diameter icons, and a point on it up and to the right. */
const C: Pt = [10, 10];
const EDGE: Pt = [10 + 7 * Math.SQRT1_2, 10 - 7 * Math.SQRT1_2];
const FAR: Pt = [10 - 7 * Math.SQRT1_2, 10 + 7 * Math.SQRT1_2];

export const RADIUS: Design = {
  // A circle, its centre and a line from the centre to the edge.
  regular: (k) => [ring(C[0], C[1], 8, k), bar(C, EDGE, k), disc(C[0], C[1], 1.25, k)],
  filled: (k) => [ring(C[0], C[1], 8, k, 2), bar(C, EDGE, k, 2), disc(C[0], C[1], 1.75, k)],
};

export const DIAMETER: Design = {
  // A circle and a line right across it through the centre.
  regular: (k) => [ring(C[0], C[1], 8, k), bar(FAR, EDGE, k)],
  filled: (k) => [ring(C[0], C[1], 8, k, 2), bar(FAR, EDGE, k, 2)],
};

/** A box seen from above and the front: its front face, top and side (a Volume, M14-06). */
const FRONT: Pt[] = [
  [3, 8],
  [13, 8],
  [13, 17],
  [3, 17],
];
const BACK_TOP: Pt[] = [
  [3, 8],
  [7, 4],
  [17, 4],
  [13, 8],
];
const SIDE: Pt[] = [
  [13, 8],
  [17, 4],
  [17, 13],
  [13, 17],
];

export const VOLUME: Design = {
  // A box: an area given a depth.
  regular: (k) => [strokes(FRONT, k, true), strokes(BACK_TOP, k, true), strokes(SIDE, k, true)],
  filled: (k) => [poly(FRONT, k), strokes(BACK_TOP, k, true, 2), strokes(SIDE, k, true, 2)],
};

/** The outline of the Cutout icon and the hole cut out of it. */
const OUTLINE: Pt[] = [
  [2.5, 3.5],
  [17.5, 3.5],
  [17.5, 16.5],
  [2.5, 16.5],
];
const HOLE: [Pt, Pt, Pt, Pt] = [
  [7, 7.5],
  [13, 7.5],
  [13, 12.5],
  [7, 12.5],
];

export const CUTOUT: Design = {
  // An area with a hole in it, the hole's edge dashed as the markup draws it.
  regular: (k) => [
    strokes(OUTLINE, k, true),
    dashed(HOLE[0], HOLE[1], k, 2, 1),
    dashed(HOLE[1], HOLE[2], k, 2, 1),
    dashed(HOLE[2], HOLE[3], k, 2, 1),
    dashed(HOLE[3], HOLE[0], k, 2, 1),
  ],
  filled: (k) => [poly(OUTLINE, k) + ' ' + poly(HOLE, k, true)],
};

export const M14_DESIGNS: Record<string, { design: Design; large?: true }> = {
  'measure.polylength': { design: POLYLENGTH, large: true },
  'measure.volume': { design: VOLUME, large: true },
  'measure.cutout': { design: CUTOUT, large: true },
  'measure.angle': { design: ANGLE, large: true },
  'measure.radius': { design: RADIUS, large: true },
  'measure.diameter': { design: DIAMETER, large: true },
};
