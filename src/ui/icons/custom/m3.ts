// The custom icons of the M3 commands (M3-06, ADR-010 decision 3, rule 15):
// drawn here in Fluent's Regular line style on the 20-unit grid, with Filled
// variants for the toggles' pressed state. Nothing is copied or traced from
// another product's artwork. Each design takes the grid scale `k` (1 for 20 px,
// 1.6 for 32 px) and returns path data.
import { bar, box, dashed, disc, frame, poly, ring, strokes, type Pt } from './draw';

export interface Design {
  regular: (k: number) => string[];
  /** The pressed state of a toggle. */
  filled: (k: number) => string[];
}

const zigzag = (x0: number, x1: number, y: number, amp: number, step: number): Pt[] => {
  const pts: Pt[] = [];
  for (let x = x0, up = true; x <= x1 + 0.01; x += step, up = !up)
    pts.push([x, up ? y - amp : y + amp]);
  return pts;
};

/** The "text" glyph used by the text markup icons: a T. */
const letterT = (k: number, w = 1): string =>
  [bar([5, 3.5], [15, 3.5], k, w), bar([10, 3.5], [10, 12.5], k, w)].join(' ');

export const SQUIGGLY: Design = {
  regular: (k) => [letterT(k), strokes(zigzag(3, 17, 16, 1.2, 2), k)],
  filled: (k) => [letterT(k, 2), strokes(zigzag(3, 17, 16, 1.2, 2), k, false, 1.6)],
};

export const REPLACE_TEXT: Design = {
  regular: (k) => [
    letterT(k),
    bar([3, 8], [17, 8], k),
    strokes(
      [
        [7, 18],
        [10, 14.5],
        [13, 18],
      ],
      k,
    ),
  ],
  filled: (k) => [
    letterT(k, 2),
    bar([3, 8], [17, 8], k, 1.6),
    poly(
      [
        [6.5, 18.5],
        [10, 14],
        [13.5, 18.5],
      ],
      k,
    ),
  ],
};

/** A scalloped closed outline around an ellipse. */
function cloudPts(cx: number, cy: number, rx: number, ry: number, bumps: number, inset: number) {
  const n = bumps * 12;
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    const s = Math.abs(Math.sin((t * bumps) / 2)); // one arch per bump
    const kx = rx - inset + s * 1.6;
    const ky = ry - inset + s * 1.6;
    return [cx + kx * Math.cos(t), cy + ky * Math.sin(t)] as const;
  });
}

export const CLOUD: Design = {
  regular: (k) => [
    poly(cloudPts(10, 10, 6.5, 4.5, 8, 0), k) +
      ' ' +
      poly(cloudPts(10, 10, 6.5, 4.5, 8, 1), k, true),
  ],
  filled: (k) => [poly(cloudPts(10, 10, 6.5, 4.5, 8, 0), k)],
};

export const STAMP: Design = {
  // A rubber stamp: knob, neck, base; the imprint line underneath.
  regular: (k) => [
    ring(10, 4.5, 2.5, k),
    frame(8.5, 6.5, 3, 4, k),
    frame(3, 10, 14, 4, k),
    bar([3.5, 17], [16.5, 17], k),
  ],
  filled: (k) => [
    disc(10, 4.5, 2.5, k),
    box(8.5, 6.5, 3, 4, k),
    box(3, 10, 14, 4, k),
    bar([3.5, 17], [16.5, 17], k),
  ],
};

export const EXPORT_CRS: Design = {
  // A sheet with a table grid; an arrow leaving to the right (export).
  regular: (k) => [
    frame(2, 3, 11, 14, k),
    bar([2.5, 7.5], [12.5, 7.5], k),
    bar([2.5, 11.5], [12.5, 11.5], k),
    bar([6, 3.5], [6, 16.5], k),
    bar([12, 13], [18, 13], k),
    strokes(
      [
        [15.5, 10.5],
        [18, 13],
        [15.5, 15.5],
      ],
      k,
    ),
  ],
  filled: (k) => EXPORT_CRS.regular(k),
};

const PENTAGON: Pt[] = [
  [10, 2.5],
  [17, 7.5],
  [14.5, 16.5],
  [5.5, 16.5],
  [3, 7.5],
];

export const PERIMETER: Design = {
  // A polygon traced along its edge, with a vertex marker at every corner.
  regular: (k) => [
    strokes(PENTAGON, k, true),
    ...PENTAGON.map(([x, y]) => box(x - 1.5, y - 1.5, 3, 3, k)),
  ],
  filled: (k) => [
    strokes(PENTAGON, k, true, 2),
    ...PENTAGON.map(([x, y]) => box(x - 1.75, y - 1.75, 3.5, 3.5, k)),
  ],
};

export const AREA: Design = {
  // The polygon's inside hatched.
  regular: (k) => [
    strokes(PENTAGON, k, true),
    bar([6, 15], [12, 5], k),
    bar([9.5, 15.5], [14.5, 7.5], k),
    bar([4.5, 11], [8.5, 4.5], k),
  ],
  filled: (k) => [poly(PENTAGON, k)],
};

const rulerTicks = (k: number, x0: number, x1: number, y: number, step: number): string[] => {
  const out: string[] = [];
  for (let x = x0, i = 0; x <= x1 + 0.01; x += step, i++)
    out.push(bar([x, y], [x, y + (i % 2 ? 1.5 : 2.5)], k));
  return out;
};

export const CALIBRATE: Design = {
  // A ruler with a two-point target above it (pick two points, enter a length).
  regular: (k) => [
    frame(2, 11, 16, 6, k),
    ...rulerTicks(k, 5, 15, 11.5, 2.5),
    ring(10, 5, 3, k),
    bar([10, 1], [10, 3], k),
    bar([10, 7], [10, 9], k),
  ],
  filled: (k) => [box(2, 11, 16, 6, k), disc(10, 5, 3, k), bar([10, 1], [10, 9], k)],
};

export const SET_SCALE: Design = {
  // A small and a large square with an arrow between them: one size to another.
  regular: (k) => [
    frame(2, 12, 6, 6, k),
    frame(9, 2, 9, 9, k),
    bar([6, 14], [11, 9], k),
    strokes(
      [
        [8, 8.5],
        [11.5, 8.5],
        [11.5, 12],
      ],
      k,
    ),
  ],
  filled: (k) => [box(2, 12, 6, 6, k), box(9, 2, 9, 9, k), bar([6, 14], [11, 9], k, 1.6)],
};

const dashedFrame = (k: number, x: number, y: number, w: number, h: number): string[] => [
  dashed([x, y], [x + w, y], k),
  dashed([x + w, y], [x + w, y + h], k),
  dashed([x + w, y + h], [x, y + h], k),
  dashed([x, y + h], [x, y], k),
];

export const SCALE_VIEWPORT: Design = {
  // A dashed region with its own small ruler inside.
  regular: (k) => [
    ...dashedFrame(k, 2.5, 2.5, 15, 15),
    bar([6, 12.5], [14, 12.5], k),
    bar([6, 10], [6, 12.5], k),
    bar([10, 11], [10, 12.5], k),
    bar([14, 10], [14, 12.5], k),
  ],
  filled: (k) => [...dashedFrame(k, 2.5, 2.5, 15, 15), box(5, 5, 10, 10, k)],
};

/** The magnet's outline: two poles joined by a U (outer radius 7, inner 4). */
function magnet(): Pt[] {
  const arc = (r: number, from: number, to: number): Pt[] =>
    Array.from({ length: 13 }, (_, i) => {
      const t = from + ((to - from) * i) / 12;
      return [10 + r * Math.cos(t), 9 + r * Math.sin(t)] as const;
    });
  return [[3, 2], [6, 2], ...arc(4, Math.PI, 0), [14, 2], [17, 2], ...arc(7, 0, Math.PI)];
}

export const SNAPPING: Design = {
  regular: (k) => [
    strokes(magnet(), k, true),
    bar([3.5, 5], [5.5, 5], k),
    bar([14.5, 5], [16.5, 5], k),
  ],
  filled: (k) => [poly(magnet(), k)],
};

/** A drawing line the snap markers sit on. */
const snapLine = (k: number): string => bar([2.5, 16], [17.5, 4], k);

export const SNAP_ENDPOINT: Design = {
  regular: (k) => [bar([2.5, 16], [13, 7.6], k), frame(12, 2, 6, 6, k)],
  filled: (k) => [bar([2.5, 16], [13, 7.6], k), box(12, 2, 6, 6, k)],
};

const triangle = (cx: number, cy: number, r: number): Pt[] => [
  [cx, cy - r],
  [cx + r, cy + r * 0.8],
  [cx - r, cy + r * 0.8],
];

export const SNAP_MIDPOINT: Design = {
  regular: (k) => [snapLine(k), strokes(triangle(10, 10, 3.5), k, true)],
  filled: (k) => [snapLine(k), poly(triangle(10, 10, 3.8), k)],
};

export const SNAP_INTERSECTION: Design = {
  regular: (k) => [bar([3, 3], [17, 17], k), bar([17, 3], [3, 17], k), frame(7, 7, 6, 6, k)],
  filled: (k) => [bar([3, 3], [17, 17], k), bar([17, 3], [3, 17], k), box(7, 7, 6, 6, k)],
};

/** An hourglass on the line: the "nearest point" marker. */
const hourglass = (cx: number, cy: number, r: number): Pt[] => [
  [cx - r, cy - r],
  [cx + r, cy - r],
  [cx - r, cy + r],
  [cx + r, cy + r],
];

export const SNAP_NEAREST: Design = {
  regular: (k) => [snapLine(k), strokes(hourglass(10, 10, 3), k, true)],
  filled: (k) => [
    snapLine(k),
    poly(
      [
        [7, 7],
        [13, 7],
        [10, 10],
      ],
      k,
    ),
    poly(
      [
        [7, 13],
        [10, 10],
        [13, 13],
      ],
      k,
    ),
  ],
};

/** Command id → design; `large` marks the ribbon's large buttons (a 32 px glyph too). */
export const M3_DESIGNS: Record<string, { design: Design; large?: true }> = {
  'comment.squiggly': { design: SQUIGGLY },
  'comment.replaceText': { design: REPLACE_TEXT },
  'comment.cloud': { design: CLOUD },
  'comment.stamp': { design: STAMP, large: true },
  'comment.exportCrs': { design: EXPORT_CRS, large: true },
  'measure.perimeter': { design: PERIMETER, large: true },
  'measure.area': { design: AREA, large: true },
  'measure.calibrate': { design: CALIBRATE, large: true },
  'measure.setScale': { design: SET_SCALE, large: true },
  'measure.scaleViewport': { design: SCALE_VIEWPORT, large: true },
  'measure.snapping': { design: SNAPPING },
  'measure.snapEndpoint': { design: SNAP_ENDPOINT },
  'measure.snapMidpoint': { design: SNAP_MIDPOINT },
  'measure.snapIntersection': { design: SNAP_INTERSECTION },
  'measure.snapNearest': { design: SNAP_NEAREST },
};
