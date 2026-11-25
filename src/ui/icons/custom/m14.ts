// The custom icons of the M14 commands (ADR-010 decision 3, rule 15): drawn here
// in Fluent's Regular line style on the 20-unit grid, with a Filled variant for
// the toggle's pressed state. Nothing is copied or traced from another
// product's artwork.
import { box, strokes, type Pt } from './draw';
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

export const M14_DESIGNS: Record<string, { design: Design; large?: true }> = {
  'measure.polylength': { design: POLYLENGTH, large: true },
};
