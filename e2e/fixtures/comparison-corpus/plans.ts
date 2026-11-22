// The drawing content of the overlay pairs: a structural framing plan, a
// details sheet and a dense plot plan. Each takes the revision's choices as
// plain data, so Rev A and Rev B differ only where the catalog says.

import type { Canvas, Pt } from './canvas.ts';
import { rng } from './pdf.ts';
import { label, type Box } from './sheet.ts';

export interface FramingSpec {
  /** Grid labels across (1, 2, …) and up (A, B, …). */
  gridX: string[];
  gridY: string[];
  /** Bay widths on paper, millimetres. */
  bayX: number[];
  bayY: number[];
  /** Drawing scale denominator (1:100 → 100), for dimension values. */
  scale: number;
  /** The beam size along a row (between grid i and i+1 on row j) or a column line. */
  beamX: (i: number, j: number) => string;
  beamY: (i: number, j: number) => string;
  /** Grid intersections without a column, as "B3". */
  noColumn?: string[];
  /** Openings: bay (i, j) from the bottom-left with paper size in millimetres. */
  openings?: { i: number; j: number; w: number; h: number; text: string }[];
  /** Hatched bays (slab infill, stair). */
  hatched?: { i: number; j: number; angle: number }[];
  /** Secondary beams per bay. */
  secondaries?: number;
  notes: string[];
  /** Bottom-left corner of the notes block (default: the box's, inset 6 mm). */
  notesAt?: Pt;
  /** Real text or text as curves. */
  curves?: boolean;
  /** Anything else this sheet draws, after the grid is known. */
  extra?: (c: Canvas, xs: number[], ys: number[]) => void;
}

/** Grid positions of a framing plan centred in the box. */
export function gridOf(box: Box, spec: FramingSpec): { xs: number[]; ys: number[] } {
  const totalX = spec.bayX.reduce((a, b) => a + b, 0);
  const totalY = spec.bayY.reduce((a, b) => a + b, 0);
  const x0 = box.x + (box.w - totalX) / 2;
  const y0 = box.y + (box.h - totalY) / 2;
  const xs = [x0];
  for (const b of spec.bayX) xs.push((xs[xs.length - 1] ?? 0) + b);
  const ys = [y0];
  for (const b of spec.bayY) ys.push((ys[ys.length - 1] ?? 0) + b);
  return { xs, ys };
}

const last = (a: number[]): number => a[a.length - 1] ?? 0;
const at = (a: number[], i: number): number => a[i] ?? 0;

export function framingPlan(c: Canvas, box: Box, spec: FramingSpec): void {
  const { xs, ys } = gridOf(box, spec);
  const curves = spec.curves ?? false;
  const xMin = at(xs, 0);
  const xMax = last(xs);
  const yMin = at(ys, 0);
  const yMax = last(ys);

  // Grid lines, dash-dot, with bubbles on the top and left ends.
  c.save().stroke(0).width(0.18).dash([8, 1.5, 1, 1.5]);
  for (const x of xs) c.line(x, yMin - 8, x, yMax + 18);
  for (const y of ys) c.line(xMin - 18, y, xMax + 8, y);
  c.strokePath().solid().width(0.25);
  for (const x of xs) c.circle(x, yMax + 22, 4);
  for (const y of ys) c.circle(xMin - 22, y, 4);
  c.strokePath();
  if (curves) c.width(0.25);
  xs.forEach((x, i) => {
    label(c, curves, 'F2', 3.5, x, yMax + 20.25, spec.gridX[i] ?? '', 'center');
  });
  ys.forEach((y, j) => {
    label(c, curves, 'F2', 3.5, xMin - 22, y - 1.75, spec.gridY[j] ?? '', 'center');
  });
  if (curves) c.strokePath();

  // Dimension chain above the grid with oblique ticks.
  const dy = yMax + 10;
  c.width(0.13).line(xMin - 3, dy, xMax + 3, dy);
  for (const x of xs) c.line(x, yMax + 2, x, dy + 2).line(x - 1, dy - 1, x + 1, dy + 1);
  c.strokePath();
  if (curves) c.width(0.18);
  spec.bayX.forEach((b, i) => {
    label(
      c,
      curves,
      'F1',
      2.2,
      at(xs, i) + b / 2,
      dy + 1.2,
      String(Math.round(b * spec.scale)),
      'center',
    );
  });
  // Dimension chain left of the grid.
  const dx = xMin - 10;
  c.width(0.13).line(dx, yMin - 3, dx, yMax + 3);
  for (const y of ys) c.line(xMin - 2, y, dx - 2, y).line(dx - 1, y - 1, dx + 1, y + 1);
  c.strokePath();
  if (curves) c.width(0.18);
  spec.bayY.forEach((b, j) => {
    label(
      c,
      curves,
      'F1',
      2.2,
      dx - 1.2,
      at(ys, j) + b / 2,
      String(Math.round(b * spec.scale)),
      'center',
      90,
    );
  });
  if (curves) c.strokePath();

  // Secondary beams, thin, parallel to the column lines across.
  const n = spec.secondaries ?? 2;
  c.width(0.25).dash([3, 1]);
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      for (let k = 1; k <= n; k++) {
        const x = at(xs, i) + ((at(xs, i + 1) - at(xs, i)) * k) / (n + 1);
        c.line(x, at(ys, j) + 1.5, x, at(ys, j + 1) - 1.5);
      }
    }
  }
  c.strokePath().solid();

  // Hatched bays.
  c.width(0.13);
  for (const h of spec.hatched ?? []) {
    const x0 = at(xs, h.i) + 2;
    const y0 = at(ys, h.j) + 2;
    c.hatch(x0, y0, at(xs, h.i + 1) - x0 - 2, at(ys, h.j + 1) - y0 - 2, h.angle, 2.5);
  }
  c.strokePath();

  // Primary beams with their size labels.
  c.width(0.5);
  for (let j = 0; j < ys.length; j++)
    for (let i = 0; i < xs.length - 1; i++)
      c.line(at(xs, i) + 2, at(ys, j), at(xs, i + 1) - 2, at(ys, j));
  for (let i = 0; i < xs.length; i++)
    for (let j = 0; j < ys.length - 1; j++)
      c.line(at(xs, i), at(ys, j) + 2, at(xs, i), at(ys, j + 1) - 2);
  c.strokePath();
  if (curves) c.width(0.18);
  for (let j = 0; j < ys.length; j++)
    for (let i = 0; i < xs.length - 1; i++)
      label(
        c,
        curves,
        'F1',
        2,
        (at(xs, i) + at(xs, i + 1)) / 2,
        at(ys, j) + 1.2,
        spec.beamX(i, j),
        'center',
      );
  for (let i = 0; i < xs.length; i++)
    for (let j = 0; j < ys.length - 1; j++)
      label(
        c,
        curves,
        'F1',
        2,
        at(xs, i) - 1.2,
        (at(ys, j) + at(ys, j + 1)) / 2,
        spec.beamY(i, j),
        'center',
        90,
      );
  if (curves) c.strokePath();

  // Columns.
  const skip = new Set(spec.noColumn ?? []);
  c.fillGray(0);
  xs.forEach((x, i) => {
    ys.forEach((y, j) => {
      if (!skip.has(`${spec.gridY[j] ?? ''}${spec.gridX[i] ?? ''}`))
        c.rect(x - 1.6, y - 1.6, 3.2, 3.2);
    });
  });
  c.fillPath();

  // Openings: a box with a cross and a note.
  c.width(0.35);
  for (const o of spec.openings ?? []) {
    const cx = (at(xs, o.i) + at(xs, o.i + 1)) / 2;
    const cy = (at(ys, o.j) + at(ys, o.j + 1)) / 2;
    c.rect(cx - o.w / 2, cy - o.h / 2, o.w, o.h)
      .line(cx - o.w / 2, cy - o.h / 2, cx + o.w / 2, cy + o.h / 2)
      .line(cx - o.w / 2, cy + o.h / 2, cx + o.w / 2, cy - o.h / 2);
  }
  c.strokePath();
  if (curves) c.width(0.18);
  for (const o of spec.openings ?? []) {
    const cx = (at(xs, o.i) + at(xs, o.i + 1)) / 2;
    const cy = (at(ys, o.j) + at(ys, o.j + 1)) / 2;
    label(c, curves, 'F1', 2, cx, cy - o.h / 2 - 3.5, o.text, 'center');
  }
  if (curves) c.strokePath();

  spec.extra?.(c, xs, ys);
  c.restore();

  // General notes, bottom left of the drawing area.
  const [nx, ny] = spec.notesAt ?? [box.x + 6, box.y + 6];
  c.save().stroke(0);
  if (curves) c.width(0.18);
  label(c, curves, 'F2', 2.5, nx, ny + spec.notes.length * 4.5, 'GENERAL NOTES');
  spec.notes.forEach((t, k) => {
    label(c, curves, 'F1', 2, nx, ny + (spec.notes.length - 1 - k) * 4.5, `${String(k + 1)}. ${t}`);
  });
  if (curves) c.strokePath();
  c.restore();
}

export interface DetailSpec {
  /** Plate sizes and bolts of the three details on the sheet. */
  bolts: [number, number, number];
  plate: [string, string, string];
  weld: string;
  titles: [string, string, string];
}

/** Three connection details side by side: plates, bolts, welds and concrete hatching. */
export function detailsSheet(c: Canvas, box: Box, spec: DetailSpec): void {
  const cellW = (box.w - 20) / 3;
  c.save().stroke(0);
  for (let k = 0; k < 3; k++) {
    const x0 = box.x + 10 + k * cellW;
    const cx = x0 + cellW / 2;
    const cy = box.y + box.h * 0.58;
    // Column flange (vertical I-section in elevation) and the beam stub.
    c.width(0.5)
      .rect(cx - 40, cy - 70, 12, 140)
      .rect(cx - 28, cy - 18, 70, 36)
      .strokePath();
    // End plate.
    c.width(0.35)
      .rect(cx - 28, cy - 30, 6, 60)
      .strokePath();
    // Bolts in two columns.
    const nb = spec.bolts[k] ?? 4;
    c.width(0.25);
    for (let b = 0; b < nb; b++) {
      const by = cy - 24 + (48 * b) / Math.max(1, nb - 1);
      c.circle(cx - 25, by, 1.8);
      c.line(cx - 34, by, cx - 16, by);
    }
    c.strokePath();
    // Weld symbol: leader and triangle.
    c.width(0.25)
      .line(cx - 22, cy + 18, cx + 10, cy + 40)
      .lineTo(cx + 35, cy + 40)
      .polyline([
        [cx + 18, cy + 40],
        [cx + 22, cy + 44],
        [cx + 26, cy + 40],
      ])
      .strokePath();
    c.text('F1', 2.2, cx + 28, cy + 41, spec.weld);
    // Concrete base with hatch.
    c.width(0.35)
      .rect(cx - 55, cy - 95, 110, 22)
      .strokePath();
    c.width(0.13)
      .hatch(cx - 55, cy - 95, 110, 22, 45, 2)
      .strokePath();
    c.text('F2', 3, cx, box.y + 14, spec.titles[k] ?? '', 'center');
    c.text(
      'F1',
      2.2,
      cx,
      box.y + 9,
      `PLATE ${spec.plate[k] ?? ''}, ${String(nb)} No. M20 GRADE 8.8`,
      'center',
    );
    c.width(0.35)
      .line(cx - 35, box.y + 12.5, cx + 35, box.y + 12.5)
      .strokePath();
  }
  c.restore();
}

export interface PlotPlanChanges {
  /** Rev B: pad P-1310 moved right (millimetres on paper). */
  movePad: number;
  /** The label of pad P-1204 (Rev B renames it). */
  tag1204: string;
  /** Rev B: a new rack branch. */
  newBranch: boolean;
  /** Rev B: the hatched pad P-1505 removed. */
  removeTankPad: boolean;
}

export interface PlotPlanStats {
  pads: number;
  tags: number;
  /** Paper positions (mm) of the changes, for the manifest. */
  changeAt: Record<'pad' | 'tag' | 'branch' | 'tank', Pt>;
}

/**
 * A dense plot plan: tens of thousands of short segments, a background grid
 * of zero-width lines, hatched pads, pipe racks with supports and every label
 * drawn as curves.
 */
export function densePlotPlan(c: Canvas, box: Box, ch: PlotPlanChanges): PlotPlanStats {
  const rnd = rng(1411);
  const stats: PlotPlanStats = {
    pads: 0,
    tags: 0,
    changeAt: { pad: [0, 0], tag: [0, 0], branch: [0, 0], tank: [0, 0] },
  };
  c.save().stroke(0);

  // Background coordinate grid: zero-width lines every 10 mm, with ticks every 2 mm.
  c.width(0).stroke(0.55);
  for (let x = box.x + 10; x < box.x + box.w; x += 10) c.line(x, box.y, x, box.y + box.h);
  for (let y = box.y + 10; y < box.y + box.h; y += 10) c.line(box.x, y, box.x + box.w, y);
  c.strokePath();
  for (let x = box.x + 10; x < box.x + box.w; x += 10)
    for (let y = box.y + 2; y < box.y + box.h; y += 2)
      if (Math.round(y - box.y) % 10 !== 0) c.line(x - 0.5, y, x + 0.5, y);
  c.strokePath().stroke(0);

  // Pipe racks: horizontal bundles every 60 mm, 8 lines each, supports every 6 mm.
  const racks: number[] = [];
  for (let y = box.y + 45; y < box.y + box.h - 30; y += 60) racks.push(y);
  c.width(0.18);
  for (const ry of racks) {
    for (let p = 0; p < 8; p++) c.line(box.x + 15, ry + p * 1.2, box.x + box.w - 15, ry + p * 1.2);
    for (let x = box.x + 15; x < box.x + box.w - 15; x += 6) c.line(x, ry - 1, x, ry + 9.4);
  }
  c.strokePath();

  // Equipment pads between the racks: hatched rectangles with a tag each.
  const tagsAt: { x: number; y: number; t: string }[] = [];
  let tagNo = 1001;
  const cell = 20;
  for (let k = 0; k < racks.length; k++) {
    const yTop = (racks[k + 1] ?? box.y + box.h - 20) - 6;
    const yBot = (racks[k] ?? 0) + 14;
    for (let x = box.x + 20; x + cell < box.x + box.w - 15; x += cell) {
      for (let y = yBot; y + 15 < yTop; y += 17) {
        tagNo++;
        const t = `P-${String(tagNo)}`;
        const empty = rnd() < 0.22;
        if (empty && tagNo !== 1310 && tagNo !== 1204 && tagNo !== 1505) continue; // an empty plot
        const w = 9 + Math.floor(rnd() * 8);
        const h = 6 + Math.floor(rnd() * 6);
        let px = x + 2;
        const py = y + 2;
        let tag = t;
        if (tagNo === 1310) {
          px += ch.movePad;
          stats.changeAt.pad = [px + w / 2, py + h / 2];
        }
        if (tagNo === 1204) {
          tag = ch.tag1204;
          stats.changeAt.tag = [px, py + h + 1.5];
        }
        if (tagNo === 1505) {
          stats.changeAt.tank = [px + w / 2, py + h / 2];
          if (ch.removeTankPad) continue;
        }
        c.width(0.35).rect(px, py, w, h).strokePath();
        c.width(0.1).hatch(px, py, w, h, 45, 1.2).strokePath();
        // Nozzles and a centreline cross.
        c.width(0)
          .line(px + w / 2, py - 1.5, px + w / 2, py + h + 1.5)
          .line(px - 1.5, py + h / 2, px + w + 1.5, py + h / 2)
          .strokePath();
        tagsAt.push({ x: px, y: py + h + 1.5, t: tag });
        stats.pads++;
      }
    }
  }

  // Tags and coordinates as curves.
  c.width(0.13);
  for (const g of tagsAt) {
    c.curveText(1.6, g.x, g.y, g.t);
    stats.tags++;
  }
  c.strokePath();

  // Rev B: a new branch off the third rack, 8 lines turning up.
  if (ch.newBranch) {
    const ry = racks[2] ?? box.y + 100;
    const bx = box.x + box.w * 0.27;
    stats.changeAt.branch = [bx + 20, ry + 30];
    c.width(0.18);
    for (let p = 0; p < 8; p++) {
      const off = p * 1.2;
      c.polyline([
        [bx + off, ry + 9.4],
        [bx + off, ry + 30 + off],
        [bx + 45, ry + 30 + off],
      ]);
    }
    c.strokePath();
  } else {
    const ry = racks[2] ?? box.y + 100;
    stats.changeAt.branch = [box.x + box.w * 0.27 + 20, ry + 30];
  }
  c.restore();
  return stats;
}
