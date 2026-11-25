// The measure corpus (M14-01, spike S34, D-79): self-made drawings with known
// true values, for every measuring tool's tests (rule 13: nothing from a
// client). Each sheet is drawn in paper millimetres with the comparison
// corpus's deterministic writer; each item in the manifest gives its points in
// PDF user space (points, origin bottom-left, before /Rotate) and its true
// value in real units, so a test can click the points and compare.
//
// Sheets (A3 landscape unless noted):
//   01 floor plan at 1:100 in mm (rooms, an L-shaped room, a slab with two
//      openings, seven doors)
//   02 pipe run at 1:50 with two bends (angles, bend radius, tank diameter)
//   03 one sheet, three scales: main view 1:50, Detail A 1:5, Detail B 1:10
//   04 no scale (sketch, not to scale): paper values only
//   05 raster only: the drawing is one image, no vectors to snap to
//   06 imperial, 1/4" = 1'-0", ft-in (ANSI B)
//   07 a rotated page (/Rotate 90) holding the floor plan's main room

import { Canvas, type Pt as MmPt } from '../comparison-corpus/canvas.ts';
import { Doc, MM, num } from '../comparison-corpus/pdf.ts';
import {
  frame,
  SHEETS,
  titleBlock,
  type Sheet,
  type TitleBlock,
} from '../comparison-corpus/sheet.ts';
import { fromJson } from '../../../src/model/pdf/wire.ts';
import { serialize } from '../../../src/model/pdf/objects.ts';
import { viewportToPdf, type Scale } from '../../../src/model/scale.ts';

export type ItemKind =
  | 'length'
  | 'polylength'
  | 'perimeter'
  | 'area'
  | 'volume'
  | 'cutout'
  | 'angle'
  | 'radius'
  | 'diameter'
  | 'count'
  | 'calibration';

/** A point in PDF user space (points), rounded to 0.001. */
export type UserPt = [number, number];

export interface Item {
  id: string;
  kind: ItemKind;
  /** The points a person clicks, in user space; for count, one point per symbol. */
  points: UserPt[];
  /** Cutout: the holes' outlines. */
  holes?: UserPt[][];
  /** Volume: the depth in the scale's unit. */
  depth?: number;
  /** Radius and diameter: the circle's centre, and three points on it. */
  center?: UserPt;
  onCircle?: [UserPt, UserPt, UserPt];
  /** True value in `unit`. */
  value: number;
  unit: string;
  /** The viewport (scale area) the points lie in, when the sheet has several. */
  viewport?: string;
  note: string;
}

export interface SheetFile {
  file: string;
  title: string;
  /** Page size in points (the media box, before /Rotate). */
  width: number;
  height: number;
  rotate: number;
  /** Scale areas written to the page's /VP (empty: the page has none). */
  viewports: { name: string; ratio: string; unit: string }[];
  /** How the sheet's scale is meant to be found. */
  scaleNote: string;
  items: Item[];
  bytes: Uint8Array;
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000;

/** A drawing placed on paper: real units → paper millimetres → user space. */
class View {
  /** Paper position of the real origin (mm). */
  readonly ox: number;
  readonly oy: number;
  /** Real units per paper millimetre (1:100 in mm: 100; 1/4" = 1'-0" in inches: 48 / 25.4). */
  readonly k: number;
  constructor(ox: number, oy: number, k: number) {
    this.ox = ox;
    this.oy = oy;
    this.k = k;
  }
  /** Paper millimetres. */
  p(x: number, y: number): MmPt {
    return [this.ox + x / this.k, this.oy + y / this.k];
  }
  /** User space points, before any page turn. */
  u(x: number, y: number): UserPt {
    const [px, py] = this.p(x, y);
    return [r3(px * MM), r3(py * MM)];
  }
  len(real: number): number {
    return real / this.k;
  }
}

/** A /VP entry for a paper box (mm), as the object layer writes it. */
function vpEntry(name: string, box: [number, number, number, number], scale: Scale): string {
  const bbox = box.map((v) => r3(v * MM)) as [number, number, number, number];
  return serialize(fromJson(viewportToPdf({ name, bbox, scale })));
}

const ISSUE = {
  rev: 'A',
  date: '2026-11-25',
  status: 'FOR REVIEW',
  drawn: 'TPDF',
  checked: 'TPDF',
  approved: '-',
  revisions: [
    { rev: 'A', date: '2026-11-25', desc: 'MEASURE CORPUS (SELF-MADE)', by: 'TP', chk: 'TP' },
  ],
};

function tb(title: [string, string], no: string, scale: string): TitleBlock {
  return {
    project: 'TRIYA PDF MEASURE CORPUS',
    title,
    drawingNo: no,
    scale,
    sheet: '1 OF 1',
    ...ISSUE,
  };
}

const INFO = (title: string) => ({
  title,
  author: 'Triya PDF corpus generator',
  subject: 'Measure corpus (M14-01), self-made',
  creationDate: 'D:20261125000000Z',
  modDate: 'D:20261125000000Z',
});

/** A dimension: extension lines, the dimension line with ticks, the value. */
function dim(c: Canvas, a: MmPt, b: MmPt, off: number, text: string, h = 2.2): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  const a2: MmPt = [a[0] + nx * off, a[1] + ny * off];
  const b2: MmPt = [b[0] + nx * off, b[1] + ny * off];
  c.save().stroke(0.25).width(0.13);
  c.line(a[0] + nx * 1, a[1] + ny * 1, a2[0] + nx * 1.5, a2[1] + ny * 1.5);
  c.line(b[0] + nx * 1, b[1] + ny * 1, b2[0] + nx * 1.5, b2[1] + ny * 1.5);
  c.line(a2[0], a2[1], b2[0], b2[1]);
  for (const p of [a2, b2]) c.line(p[0] - 0.8, p[1] - 0.8, p[0] + 0.8, p[1] + 0.8);
  c.strokePath();
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  const up = ang > 90 || ang < -90 ? ang + 180 : ang;
  c.fillGray(0.25).text(
    'F1',
    h,
    (a2[0] + b2[0]) / 2 + nx * 1,
    (a2[1] + b2[1]) / 2 + ny * 1,
    text,
    'center',
    up,
  );
  c.restore();
}

/** A wall: a thick outline polygon (double line, hatched grey). */
function wall(c: Canvas, v: View, pts: [number, number][], t: number): void {
  c.save().stroke(0).width(0.35).fillGray(0.75);
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i] ?? [0, 0];
    const [x2, y2] = pts[(i + 1) % pts.length] ?? [0, 0];
    const [px, py] = v.p(Math.min(x1, x2) - t / 2, Math.min(y1, y2) - t / 2);
    c.rect(px, py, v.len(Math.abs(x2 - x1) + t), v.len(Math.abs(y2 - y1) + t));
  }
  c.fillPath();
  c.restore();
}

function door(c: Canvas, v: View, x: number, y: number, w: number, rot: number): void {
  // Leaf and swing, in real units, turned by rot degrees about the hinge.
  const a = (rot * Math.PI) / 180;
  const turn = (dx: number, dy: number): MmPt =>
    v.p(x + dx * Math.cos(a) - dy * Math.sin(a), y + dx * Math.sin(a) + dy * Math.cos(a));
  const hinge = turn(0, 0);
  const leaf = turn(0, w);
  c.save().stroke(0).width(0.25).line(hinge[0], hinge[1], leaf[0], leaf[1]).strokePath();
  c.width(0.13)
    .dash([1, 0.6])
    .arc(hinge[0], hinge[1], v.len(w), rot, rot + 90)
    .strokePath();
  c.restore();
}

const at = (pts: [number, number][], v: View): UserPt[] => pts.map(([x, y]) => v.u(x, y));

// ------------------------------------------------------------------ 01 floor plan

export const FLOOR = {
  view: new View(45, 112, 100),
  office: [
    [0, 0],
    [9000, 0],
    [9000, 6000],
    [0, 6000],
  ] as [number, number][],
  lShape: [
    [9000, 0],
    [24000, 0],
    [24000, 9000],
    [16000, 9000],
    [16000, 6000],
    [9000, 6000],
  ] as [number, number][],
  slab: [
    [0, 6000],
    [9000, 6000],
    [9000, 15000],
    [0, 15000],
  ] as [number, number][],
  holes: [
    [
      [2000, 8000],
      [3500, 8000],
      [3500, 9500],
      [2000, 9500],
    ],
    [
      [5500, 9500],
      [7500, 9500],
      [7500, 13500],
      [5500, 13500],
    ],
  ] as [number, number][][],
  doors: [
    [4000, 0, 900, 0],
    [9000, 2500, 900, 90],
    [12000, 0, 1000, 0],
    [16000, 7000, 900, 90],
    [20000, 9000, 900, 180],
    [24000, 4000, 1200, 90],
    [3000, 6000, 900, 0],
  ] as [number, number, number, number][],
};

function floorPlanDrawing(c: Canvas, v: View, withText = true): void {
  const outline: [number, number][] = [
    [0, 0],
    [24000, 0],
    [24000, 9000],
    [16000, 9000],
    [16000, 15000],
    [0, 15000],
  ];
  wall(c, v, outline, 250);
  // Inner walls.
  c.save().stroke(0).width(0.35);
  for (const [x1, y1, x2, y2] of [
    [9000, 0, 9000, 6000],
    [0, 6000, 16000, 6000],
    [16000, 6000, 16000, 9000],
    [9000, 6000, 9000, 15000],
  ] as const) {
    const [a, b] = [v.p(x1, y1), v.p(x2, y2)];
    c.line(a[0], a[1], b[0], b[1]);
  }
  c.strokePath();
  // Openings in the slab: crossed boxes.
  c.width(0.25);
  for (const h of FLOOR.holes) {
    c.polyline(
      h.map(([x, y]) => v.p(x, y)),
      true,
    );
    const [p0, , p2] = h.map(([x, y]) => v.p(x, y));
    const p1 = v.p(h[1]?.[0] ?? 0, h[1]?.[1] ?? 0);
    const p3 = v.p(h[3]?.[0] ?? 0, h[3]?.[1] ?? 0);
    if (p0 && p2) c.line(p0[0], p0[1], p2[0], p2[1]);
    c.line(p1[0], p1[1], p3[0], p3[1]);
  }
  c.strokePath();
  // Grid lines.
  c.stroke(0.5).width(0.13).dash([6, 1, 1, 1]);
  for (const x of [0, 9000, 16000, 24000]) {
    const [a, b] = [v.p(x, -1500), v.p(x, 16500)];
    c.line(a[0], a[1], b[0], b[1]);
  }
  for (const y of [0, 6000, 15000]) {
    const [a, b] = [v.p(-1500, y), v.p(25500, y)];
    c.line(a[0], a[1], b[0], b[1]);
  }
  c.strokePath().solid().restore();
  for (const [x, y, w, r] of FLOOR.doors) door(c, v, x, y, w, r);
  if (!withText) return;
  c.save().fillGray(0);
  const room = (x: number, y: number, name: string, area: string): void => {
    const [px, py] = v.p(x, y);
    c.text('F2', 3, px, py + 2, name, 'center').text('F1', 2.2, px, py - 2.5, area, 'center');
  };
  room(4500, 3000, 'OFFICE', '54.00 m²');
  room(19000, 4500, 'WORKSHOP', '114.00 m²');
  room(4500, 14200, 'SLAB S1 (250 THK)', '');
  c.restore();
  dim(c, v.p(0, 0), v.p(24000, 0), -14, '24000');
  dim(c, v.p(0, 0), v.p(9000, 0), -8, '9000');
  dim(c, v.p(0, 0), v.p(0, 6000), 8, '6000');
  dim(c, v.p(0, 6000), v.p(0, 15000), 8, '9000');
  dim(c, v.p(24000, 0), v.p(24000, 9000), -8, '9000');
}

function sheet01(): SheetFile {
  const s = SHEETS.A3;
  const v = FLOOR.view;
  const c = new Canvas();
  frame(c, s);
  floorPlanDrawing(c, v);
  titleBlock(c, s, tb(['GROUND FLOOR PLAN', 'MEASURE TEST 01'], 'TP-M-001', '1:100'));
  const doc = new Doc();
  const scale: Scale = { paper: 1, real: 100, unit: 'mm', precision: 0 };
  doc.addPage({
    width: s.w * MM,
    height: s.h * MM,
    content: c.toString(),
    extra: `/VP [${vpEntry('Plan', [25, 95, 300, 285], scale)}]`,
  });
  const items: Item[] = [
    {
      id: 'overall-length',
      kind: 'length',
      points: [v.u(0, 0), v.u(24000, 0)],
      value: 24000,
      unit: 'mm',
      note: 'Grid A to D along the bottom wall',
    },
    {
      id: 'office-diagonal',
      kind: 'length',
      points: [v.u(0, 0), v.u(9000, 6000)],
      value: r3(Math.hypot(9000, 6000)),
      unit: 'mm',
      note: 'Office corner to corner',
    },
    {
      id: 'wall-run',
      kind: 'polylength',
      points: at(
        [
          [24000, 0],
          [24000, 9000],
          [16000, 9000],
          [16000, 15000],
        ],
        v,
      ),
      value: 23000,
      unit: 'mm',
      note: 'Open path along the east walls',
    },
    {
      id: 'office-perimeter',
      kind: 'perimeter',
      points: at(FLOOR.office, v),
      value: 30000,
      unit: 'mm',
      note: 'Closed: the closing side counts',
    },
    {
      id: 'office-area',
      kind: 'area',
      points: at(FLOOR.office, v),
      value: 54,
      unit: 'm²',
      note: '9000 x 6000',
    },
    {
      id: 'workshop-area',
      kind: 'area',
      points: at(FLOOR.lShape, v),
      value: 114,
      unit: 'm²',
      note: 'L-shaped room',
    },
    {
      id: 'slab-net-area',
      kind: 'cutout',
      points: at(FLOOR.slab, v),
      holes: FLOOR.holes.map((h) => at(h, v)),
      value: 70.75,
      unit: 'm²',
      note: '81 m² gross minus 2.25 m² and 8 m² openings',
    },
    {
      id: 'slab-volume',
      kind: 'volume',
      points: at(FLOOR.slab, v),
      holes: FLOOR.holes.map((h) => at(h, v)),
      depth: 250,
      value: 17.6875,
      unit: 'm³',
      note: 'Net slab area x 250 mm (gross: 20.25 m³)',
    },
    {
      id: 'doors',
      kind: 'count',
      points: FLOOR.doors.map(([x, y]) => v.u(x, y)),
      value: 7,
      unit: 'doors',
      note: 'Hinge points of the seven doors',
    },
  ];
  return {
    file: '01_floor_plan_1-100_mm.pdf',
    title: 'Floor plan 1:100 (mm)',
    width: r3(s.w * MM),
    height: r3(s.h * MM),
    rotate: 0,
    viewports: [{ name: 'Plan', ratio: '1:100', unit: 'mm' }],
    scaleNote: 'Page /VP "Plan" at 1:100 in mm; the 24000 dimension can calibrate too',
    items,
    bytes: doc.finish(INFO('TP-M-001 Ground floor plan'), 'measure-01'),
  };
}

// ------------------------------------------------------------------ 02 pipe run

const DEG = Math.PI / 180;

function sheet02(): SheetFile {
  const s = SHEETS.A3;
  const v = new View(40, 70, 50);
  const c = new Canvas();
  frame(c, s);
  // Centreline A → B → C → D through the intersection points.
  const A: [number, number] = [0, 2000];
  const B: [number, number] = [6000, 2000];
  const C: [number, number] = [
    B[0] + 5000 * Math.cos(37.5 * DEG),
    B[1] + 5000 * Math.sin(37.5 * DEG),
  ];
  const D: [number, number] = [C[0] + 4000, C[1]];
  const R = 1200;
  // Tangent arc at a corner: centre on the bisector, tangent points R·tan(θ/2) from the corner.
  const bend = (p: [number, number], inDir: number, outDir: number) => {
    const defl = outDir - inDir;
    const t = R * Math.tan(Math.abs(defl) / 2);
    const t1: [number, number] = [p[0] - t * Math.cos(inDir), p[1] - t * Math.sin(inDir)];
    const t2: [number, number] = [p[0] + t * Math.cos(outDir), p[1] + t * Math.sin(outDir)];
    const side = defl > 0 ? 1 : -1;
    const centre: [number, number] = [
      t1[0] - side * R * Math.sin(inDir),
      t1[1] + side * R * Math.cos(inDir),
    ];
    const a1 = Math.atan2(t1[1] - centre[1], t1[0] - centre[0]);
    const a2 = Math.atan2(t2[1] - centre[1], t2[0] - centre[0]);
    const mid = (a1 + a2) / 2;
    const midPt: [number, number] = [centre[0] + R * Math.cos(mid), centre[1] + R * Math.sin(mid)];
    return { t1, t2, centre, a1, a2, midPt };
  };
  const b1 = bend(B, 0, 37.5 * DEG);
  const b2 = bend(C, 37.5 * DEG, 0);
  const pipeD = 300;
  // The pipe: two offset lines would need offset arcs; drawn as a thick grey centreline band
  // plus a thin centreline, which is what a single-line pipe drawing shows.
  c.save().stroke(0).width(v.len(pipeD)).raw('0 J');
  const cl = (): void => {
    c.moveTo(...v.p(...A)).lineTo(...v.p(...b1.t1));
    c.arc(...v.p(...b1.centre), v.len(R), b1.a1 / DEG, b1.a2 / DEG);
    c.lineTo(...v.p(...b2.t1));
    c.arc(...v.p(...b2.centre), v.len(R), b2.a1 / DEG, b2.a2 / DEG);
    c.lineTo(...v.p(...D));
  };
  c.stroke(0.8);
  cl();
  c.strokePath();
  c.stroke(0).width(0.18).dash([8, 1.5, 1.5, 1.5]);
  cl();
  c.strokePath().solid();
  // Construction: the horizontal from B, for the 37.5° deflection.
  c.width(0.13).stroke(0.4).dash([1, 1]);
  c.line(...v.p(...B), ...v.p(B[0] + 4000, B[1]))
    .strokePath()
    .solid();
  // Tank (Ø 3000) and a flange (Ø 600).
  const tank: [number, number] = [13000, 8500];
  const fl: [number, number] = [D[0] + 300, D[1]];
  c.stroke(0)
    .width(0.35)
    .circle(...v.p(...tank), v.len(1500))
    .strokePath();
  c.width(0.25)
    .circle(...v.p(...fl), v.len(300))
    .strokePath();
  c.restore();
  c.save().fillGray(0);
  c.text('F2', 3, ...v.p(1000, 2600), 'LINE 150-P-101');
  c.text('F1', 2.2, ...v.p(b1.centre[0], b1.centre[1] + 300), 'R1200', 'center');
  c.text('F1', 2.2, ...v.p(B[0] + 2800, B[1] + 700), '37.5°', 'center');
  c.text('F2', 3, ...v.p(tank[0], tank[1] + 200), 'TANK T-1', 'center');
  c.text('F1', 2.2, ...v.p(tank[0], tank[1] - 500), 'Ø3000', 'center');
  c.restore();
  dim(c, v.p(...A), v.p(...B), -10, '6000');
  titleBlock(c, s, tb(['PIPE RUN 150-P-101', 'MEASURE TEST 02'], 'TP-M-002', '1:50'));
  const doc = new Doc();
  const scale: Scale = { paper: 1, real: 50, unit: 'mm', precision: 0 };
  doc.addPage({
    width: s.w * MM,
    height: s.h * MM,
    content: c.toString(),
    extra: `/VP [${vpEntry('Pipe run', [25, 45, 405, 285], scale)}]`,
  });
  const onArc = (b: typeof b1): [UserPt, UserPt, UserPt] => [
    v.u(...b.t1),
    v.u(...b.midPt),
    v.u(...b.t2),
  ];
  const ring = (cx: number, cy: number, r: number): [UserPt, UserPt, UserPt] => [
    v.u(cx + r, cy),
    v.u(cx, cy + r),
    v.u(cx - r * Math.cos(30 * DEG), cy - r * Math.sin(30 * DEG)),
  ];
  const items: Item[] = [
    {
      id: 'run-length',
      kind: 'polylength',
      points: [v.u(...A), v.u(...B), v.u(...C), v.u(...D)],
      value: 15000,
      unit: 'mm',
      note: 'Centreline through the intersection points (6000 + 5000 + 4000)',
    },
    {
      id: 'first-leg',
      kind: 'length',
      points: [v.u(...A), v.u(...B)],
      value: 6000,
      unit: 'mm',
      note: 'Dimensioned leg',
    },
    {
      id: 'inside-angle-B',
      kind: 'angle',
      points: [v.u(...A), v.u(...B), v.u(...C)],
      value: 142.5,
      unit: '°',
      note: 'Inside angle at the first bend',
    },
    {
      id: 'deflection-B',
      kind: 'angle',
      points: [v.u(B[0] + 4000, B[1]), v.u(...B), v.u(...C)],
      value: 37.5,
      unit: '°',
      note: 'Deflection from the horizontal construction line',
    },
    {
      id: 'bend-radius-B',
      kind: 'radius',
      points: [v.u(...b1.centre), v.u(...b1.midPt)],
      center: v.u(...b1.centre),
      onCircle: onArc(b1),
      value: R,
      unit: 'mm',
      note: 'Bend radius (an arc, not a full circle)',
    },
    {
      id: 'tank-diameter',
      kind: 'diameter',
      points: [v.u(...tank), v.u(tank[0] + 1500, tank[1])],
      center: v.u(...tank),
      onCircle: ring(...tank, 1500),
      value: 3000,
      unit: 'mm',
      note: 'Tank T-1',
    },
    {
      id: 'flange-radius',
      kind: 'radius',
      points: [v.u(...fl), v.u(fl[0], fl[1] + 300)],
      center: v.u(...fl),
      onCircle: ring(...fl, 300),
      value: 300,
      unit: 'mm',
      note: 'Flange, a small full circle',
    },
  ];
  return {
    file: '02_pipe_run_1-50.pdf',
    title: 'Pipe run with bends 1:50 (mm)',
    width: r3(s.w * MM),
    height: r3(s.h * MM),
    rotate: 0,
    viewports: [{ name: 'Pipe run', ratio: '1:50', unit: 'mm' }],
    scaleNote: 'Page /VP "Pipe run" at 1:50 in mm',
    items,
    bytes: doc.finish(INFO('TP-M-002 Pipe run'), 'measure-02'),
  };
}

// ------------------------------------------------------------------ 03 three scales

function sheet03(): SheetFile {
  const s = SHEETS.A3;
  const main = new View(40, 150, 50);
  const detA = new View(60, 60, 5);
  const detB = new View(260, 130, 10);
  const c = new Canvas();
  frame(c, s);
  const box = (x: number, y: number, w: number, h: number): void => {
    c.save().stroke(0.3).width(0.25).dash([4, 1.5]).rect(x, y, w, h).strokePath().restore();
  };
  // Main view 1:50: a beam 8000 long, 600 deep, on two columns.
  c.save().stroke(0).width(0.35);
  c.rect(...main.p(0, 2000), main.len(8000), main.len(600));
  c.rect(...main.p(-200, 0), main.len(400), main.len(2000));
  c.rect(...main.p(7800, 0), main.len(400), main.len(2000));
  c.strokePath().restore();
  dim(c, main.p(0, 2600), main.p(8000, 2600), 6, '8000');
  box(30, 140, 200, 105);
  c.text('F2', 3, 32, 247, 'MAIN VIEW  1:50');
  // Detail A 1:5: an end plate 400 x 250 with four holes Ø 22.
  c.save()
    .stroke(0)
    .width(0.35)
    .rect(...detA.p(0, 0), detA.len(400), detA.len(250))
    .strokePath();
  c.width(0.25);
  for (const [x, y] of [
    [60, 60],
    [340, 60],
    [60, 190],
    [340, 190],
  ] as const)
    c.circle(...detA.p(x, y), detA.len(11)).strokePath();
  c.restore();
  dim(c, detA.p(0, 0), detA.p(400, 0), -6, '400');
  dim(c, detA.p(0, 0), detA.p(0, 250), 6, '250');
  box(45, 40, 115, 80);
  c.text('F2', 3, 47, 122, 'DETAIL A  1:5');
  // Detail B 1:10: a cleat 900 long, 300 high.
  c.save()
    .stroke(0)
    .width(0.35)
    .rect(...detB.p(0, 0), detB.len(900), detB.len(300))
    .strokePath();
  c.restore();
  dim(c, detB.p(0, 0), detB.p(900, 0), -6, '900');
  box(245, 115, 120, 55);
  c.text('F2', 3, 247, 172, 'DETAIL B  1:10');
  titleBlock(c, s, tb(['BEAM B1 AND DETAILS', 'MEASURE TEST 03'], 'TP-M-003', 'AS SHOWN'));
  const doc = new Doc();
  const mm = (real: number): Scale => ({ paper: 1, real, unit: 'mm', precision: 0 });
  doc.addPage({
    width: s.w * MM,
    height: s.h * MM,
    content: c.toString(),
    extra: `/VP [${vpEntry('Main view', [30, 140, 230, 245], mm(50))} ${vpEntry('Detail A', [45, 40, 160, 120], mm(5))} ${vpEntry('Detail B', [245, 115, 365, 170], mm(10))}]`,
  });
  const items: Item[] = [
    {
      id: 'beam-length',
      kind: 'length',
      points: [main.u(0, 2600), main.u(8000, 2600)],
      value: 8000,
      unit: 'mm',
      viewport: 'Main view',
      note: 'Top of beam, end to end',
    },
    {
      id: 'plate-width',
      kind: 'length',
      points: [detA.u(0, 0), detA.u(400, 0)],
      value: 400,
      unit: 'mm',
      viewport: 'Detail A',
      note: 'End plate width at 1:5',
    },
    {
      id: 'plate-area',
      kind: 'area',
      points: at(
        [
          [0, 0],
          [400, 0],
          [400, 250],
          [0, 250],
        ],
        detA,
      ),
      value: 0.1,
      unit: 'm²',
      viewport: 'Detail A',
      note: '400 x 250 at 1:5',
    },
    {
      id: 'cleat-length',
      kind: 'length',
      points: [detB.u(0, 0), detB.u(900, 0)],
      value: 900,
      unit: 'mm',
      viewport: 'Detail B',
      note: 'Cleat length at 1:10',
    },
    {
      id: 'spans-two-scales',
      kind: 'length',
      points: [main.u(0, 0), detA.u(400, 250)],
      value: Number.NaN,
      unit: 'mm',
      note: 'Starts in Main view, ends in Detail A: no value, "spans 2 scales"',
    },
  ];
  return {
    file: '03_three_scales_1-50_1-5_1-10.pdf',
    title: 'One sheet, three scales (1:50, 1:5, 1:10)',
    width: r3(s.w * MM),
    height: r3(s.h * MM),
    rotate: 0,
    viewports: [
      { name: 'Main view', ratio: '1:50', unit: 'mm' },
      { name: 'Detail A', ratio: '1:5', unit: 'mm' },
      { name: 'Detail B', ratio: '1:10', unit: 'mm' },
    ],
    scaleNote: 'Three /VP entries; the rest of the page has no scale',
    items,
    bytes: doc.finish(INFO('TP-M-003 Beam and details'), 'measure-03'),
  };
}

// ------------------------------------------------------------------ 04 no scale

function sheet04(): SheetFile {
  const s = SHEETS.A3;
  const v = new View(60, 80, 1); // paper millimetres
  const c = new Canvas();
  frame(c, s);
  c.save().stroke(0).width(0.35);
  c.line(...v.p(0, 0), ...v.p(100, 0)).strokePath();
  c.rect(...v.p(150, 0), 80, 50).strokePath();
  c.polyline(
    [
      [0, 60],
      [40, 100],
      [90, 70],
    ].map(([x = 0, y = 0]) => v.p(x, y)),
  );
  c.strokePath().restore();
  c.save().fillGray(0).text('F2', 6, 60, 230, 'SKETCH - NOT TO SCALE').restore();
  titleBlock(c, s, tb(['SITE SKETCH', 'MEASURE TEST 04'], 'TP-M-004', 'NTS'));
  const doc = new Doc();
  doc.addPage({ width: s.w * MM, height: s.h * MM, content: c.toString() });
  const items: Item[] = [
    {
      id: 'paper-line',
      kind: 'length',
      points: [v.u(0, 0), v.u(100, 0)],
      value: 100,
      unit: 'mm (paper)',
      note: 'Measured at paper size',
    },
    {
      id: 'paper-rectangle',
      kind: 'area',
      points: at(
        [
          [150, 0],
          [230, 0],
          [230, 50],
          [150, 50],
        ],
        v,
      ),
      value: 4000,
      unit: 'mm² (paper)',
      note: '80 x 50 mm on paper',
    },
    {
      id: 'paper-angle',
      kind: 'angle',
      points: at(
        [
          [0, 60],
          [40, 100],
          [90, 70],
        ],
        v,
      ),
      value: r3(
        (Math.acos((-40 * 50 + -40 * -30) / (Math.hypot(40, 40) * Math.hypot(50, 30))) * 180) /
          Math.PI,
      ),
      unit: '°',
      note: 'An angle needs no scale',
    },
  ];
  return {
    file: '04_no_scale.pdf',
    title: 'No scale (sketch)',
    width: r3(s.w * MM),
    height: r3(s.h * MM),
    rotate: 0,
    viewports: [],
    scaleNote: 'No /VP: the first measurement asks for a scale (D-77)',
    items,
    bytes: doc.finish(INFO('TP-M-004 Site sketch'), 'measure-04'),
  };
}

// ------------------------------------------------------------------ 05 raster only

/** A greyscale picture of the floor plan's office and a 10 m scale bar, at 1:100. */
function sheet05(): SheetFile {
  const s = SHEETS.A3;
  const dpmm = 4; // about 100 dpi
  const W = s.w * dpmm;
  const H = s.h * dpmm;
  const px = new Uint8Array(W * H).fill(255);
  const v = new View(80, 90, 100);
  const dot = (x: number, y: number, r: number): void => {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const X = Math.round(x + dx);
        const Y = Math.round(y + dy);
        if (X >= 0 && Y >= 0 && X < W && Y < H) px[(H - 1 - Y) * W + X] = 0;
      }
  };
  const seg = (a: MmPt, b: MmPt, r = 1): void => {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * dpmm * 2);
    for (let i = 0; i <= n; i++)
      dot((a[0] + ((b[0] - a[0]) * i) / n) * dpmm, (a[1] + ((b[1] - a[1]) * i) / n) * dpmm, r);
  };
  const room: [number, number][] = [
    [0, 0],
    [12000, 0],
    [12000, 6000],
    [0, 6000],
  ];
  room.forEach((p, i) => {
    seg(v.p(...p), v.p(...(room[(i + 1) % 4] ?? p)), 2);
  });
  seg(v.p(0, -2500), v.p(10000, -2500), 1);
  for (let x = 0; x <= 10000; x += 1000) seg(v.p(x, -2800), v.p(x, -2200), 1);
  // Border.
  seg([20, 10], [s.w - 10, 10]);
  seg([s.w - 10, 10], [s.w - 10, s.h - 10]);
  seg([s.w - 10, s.h - 10], [20, s.h - 10]);
  seg([20, s.h - 10], [20, 10]);
  const doc = new Doc();
  const img = doc.w.add({
    dict: `<< /Type /XObject /Subtype /Image /Width ${String(W)} /Height ${String(H)} /ColorSpace /DeviceGray /BitsPerComponent 8 >>`,
    stream: px,
  });
  doc.addPage({
    width: s.w * MM,
    height: s.h * MM,
    content: `q ${num(s.w * MM)} 0 0 ${num(s.h * MM)} 0 0 cm /Im1 Do Q`,
    extraResources: `/XObject << /Im1 ${String(img)} 0 R >>`,
  });
  const items: Item[] = [
    {
      id: 'scale-bar',
      kind: 'calibration',
      points: [v.u(0, -2500), v.u(10000, -2500)],
      value: 10000,
      unit: 'mm',
      note: 'Calibrate on the 10 m scale bar (no vectors to snap to)',
    },
    {
      id: 'room-area',
      kind: 'area',
      points: at(room, v),
      value: 72,
      unit: 'm²',
      note: '12000 x 6000 at 1:100 (line centres, 0.5 mm wide on paper)',
    },
    {
      id: 'room-length',
      kind: 'length',
      points: [v.u(0, 0), v.u(12000, 0)],
      value: 12000,
      unit: 'mm',
      note: 'Bottom wall centreline',
    },
  ];
  return {
    file: '05_raster_only.pdf',
    title: 'Raster only (one image, no vectors)',
    width: r3(s.w * MM),
    height: r3(s.h * MM),
    rotate: 0,
    viewports: [],
    scaleNote: 'No /VP and nothing to snap to: calibrate on the 10 m scale bar',
    items,
    bytes: doc.finish(INFO('TP-M-005 Raster sheet'), 'measure-05'),
  };
}

// ------------------------------------------------------------------ 06 imperial

function sheet06(): SheetFile {
  // ANSI B landscape, 17 x 11 in; 1/4" = 1'-0" is 1:48. Real units: inches.
  const s: Sheet = { name: 'A3', w: 17 * 25.4, h: 11 * 25.4 };
  const v = new View(40, 70, 48 / 25.4);
  const c = new Canvas();
  frame(c, s);
  const room: [number, number][] = [
    [0, 0],
    [240, 0],
    [240, 150],
    [0, 150],
  ];
  c.save()
    .stroke(0)
    .width(0.5)
    .polyline(
      room.map(([x, y]) => v.p(x, y)),
      true,
    )
    .strokePath();
  c.restore();
  dim(c, v.p(0, 0), v.p(240, 0), -8, `20'-0"`);
  dim(c, v.p(240, 0), v.p(240, 150), -8, `12'-6"`);
  dim(c, v.p(0, 150), v.p(97.5, 150), 6, `8'-1 1/2"`);
  c.save()
    .fillGray(0)
    .text('F2', 3, ...v.p(120, 80), 'GARAGE', 'center')
    .restore();
  titleBlock(c, s, tb(['GARAGE PLAN', 'MEASURE TEST 06'], 'TP-M-006', `1/4" = 1'-0"`));
  const doc = new Doc();
  const scale: Scale = { paper: 1, real: 48, unit: 'ft', precision: 2, ftIn: 16 };
  doc.addPage({
    width: s.w * MM,
    height: s.h * MM,
    content: c.toString(),
    extra: `/VP [${vpEntry('Plan', [25, 45, 250, 200], scale)}]`,
  });
  const items: Item[] = [
    {
      id: 'long-wall',
      kind: 'length',
      points: [v.u(0, 0), v.u(240, 0)],
      value: 240,
      unit: 'in',
      note: `20'-0"`,
    },
    {
      id: 'odd-length',
      kind: 'length',
      points: [v.u(0, 150), v.u(97.5, 150)],
      value: 97.5,
      unit: 'in',
      note: `8'-1 1/2"`,
    },
    {
      id: 'garage-area',
      kind: 'area',
      points: at(room, v),
      value: 250,
      unit: 'sq ft',
      note: `20'-0" x 12'-6"`,
    },
  ];
  return {
    file: '06_imperial_ft-in.pdf',
    title: 'Imperial, ft-in (1/4" = 1\'-0")',
    width: r3(s.w * MM),
    height: r3(s.h * MM),
    rotate: 0,
    viewports: [{ name: 'Plan', ratio: `1/4" = 1'-0"`, unit: 'ft-in' }],
    scaleNote: '/VP "Plan" in feet shown as ft-in to 1/16"',
    items,
    bytes: doc.finish(INFO('TP-M-006 Garage plan'), 'measure-06'),
  };
}

// ------------------------------------------------------------------ 07 rotated page

function sheet07(): SheetFile {
  const s = SHEETS.A3;
  // Portrait media box shown landscape by /Rotate 90: the drawing is turned the other way in
  // user space, (x, y) → (Wp − y, x), so it reads upright on screen.
  const Wp = s.h * MM;
  const v = FLOOR.view;
  const c = new Canvas();
  c.raw(`q 0 1 -1 0 ${num(Wp)} 0 cm`);
  frame(c, s);
  floorPlanDrawing(c, v);
  titleBlock(c, s, tb(['GROUND FLOOR PLAN (TURNED)', 'MEASURE TEST 07'], 'TP-M-007', '1:100'));
  c.raw('Q');
  const turn = ([x, y]: UserPt): UserPt => [r3(Wp - y), r3(x)];
  const doc = new Doc();
  const scale: Scale = { paper: 1, real: 100, unit: 'mm', precision: 0 };
  // The viewport in user space: the turned "Plan" box.
  const [x0, y0, x1, y1] = [25, 95, 300, 285];
  const a = turn([x0 * MM, y0 * MM]);
  const b = turn([x1 * MM, y1 * MM]);
  const box: [number, number, number, number] = [
    Math.min(a[0], b[0]) / MM,
    Math.min(a[1], b[1]) / MM,
    Math.max(a[0], b[0]) / MM,
    Math.max(a[1], b[1]) / MM,
  ];
  doc.addPage({
    width: s.h * MM,
    height: s.w * MM,
    rotate: 90,
    content: c.toString(),
    extra: `/VP [${vpEntry('Plan', box, scale)}]`,
  });
  const items: Item[] = [
    {
      id: 'overall-length',
      kind: 'length',
      points: [turn(v.u(0, 0)), turn(v.u(24000, 0))],
      value: 24000,
      unit: 'mm',
      note: 'Same wall as sheet 01, on a turned page',
    },
    {
      id: 'office-area',
      kind: 'area',
      points: at(FLOOR.office, v).map(turn),
      value: 54,
      unit: 'm²',
      note: '9000 x 6000',
    },
    {
      id: 'slab-net-area',
      kind: 'cutout',
      points: at(FLOOR.slab, v).map(turn),
      holes: FLOOR.holes.map((h) => at(h, v).map(turn)),
      value: 70.75,
      unit: 'm²',
      note: 'As sheet 01',
    },
  ];
  return {
    file: '07_rotated_page.pdf',
    title: 'Rotated page (/Rotate 90)',
    width: r3(s.h * MM),
    height: r3(s.w * MM),
    rotate: 90,
    viewports: [{ name: 'Plan', ratio: '1:100', unit: 'mm' }],
    scaleNote: 'Portrait media box, /Rotate 90; points are in user space (before the turn)',
    items,
    bytes: doc.finish(INFO('TP-M-007 Ground floor plan, turned'), 'measure-07'),
  };
}

/** Every sheet, in file order. */
export function measureSheets(): SheetFile[] {
  return [sheet01(), sheet02(), sheet03(), sheet04(), sheet05(), sheet06(), sheet07()];
}

export { floorPlanDrawing };
