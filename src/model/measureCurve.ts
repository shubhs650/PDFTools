// Angle, Radius and Diameter (M14-05, D-73, plan §5, ADR-035 Amendment 1:
// each one Stamp whose appearance is entirely ours): the geometry from the
// clicked points, the value, and what the appearance draws. Pure.
//
// - Angle (Q9): three clicks, the end of the first arm, the corner, the end of
//   the second arm. The inside angle (0° … 180°) with its arc at the corner;
//   no scale needed.
// - Radius and Diameter (Q10): two points (the centre, then a point on the
//   edge) or three points anywhere on the circle or arc. Two points draw the
//   full circle; three draw the arc from the first through the second to the
//   third, or the full circle (Radius: the arc by default, a bend; Diameter:
//   the circle, a tank or a pipe). The radius or diameter line runs from the
//   centre (a Diameter's from the far side) to the edge point, the second click
//   of either method.
//
// Points are in one y direction throughout: PDF user space (y up) in the
// Render worker; EmbedPDF's page points mirrored (y down → y up) on the main
// thread, as the captions of the other tools are (measureGeometry.ts).
import { dist, lineCaption, type CaptionBox, type Pt } from './measureGeometry';

export type CurveTool = 'angle' | 'radius' | 'diameter';

export const CURVE_TOOLS: readonly CurveTool[] = ['angle', 'radius', 'diameter'];

export const isCurveTool = (t: unknown): t is CurveTool =>
  typeof t === 'string' && (CURVE_TOOLS as readonly string[]).includes(t);

/** How a Radius or a Diameter is picked (Q10): centre then edge, or three points on the curve. */
export type CurveMethod = 'centre' | 'three';

/** What a three-point Radius or Diameter draws: the arc through the points, or the whole circle. */
export type CurveShape = 'arc' | 'circle';

/** The default shape of a three-point curve: a Radius is usually a bend, a Diameter a tank. */
export const defaultShape = (tool: CurveTool): CurveShape =>
  tool === 'diameter' ? 'circle' : 'arc';

/** The points a curve takes: an Angle 3; a Radius or Diameter 2 (centre, edge) or 3. */
export const pointsNeeded = (tool: CurveTool, method: CurveMethod): number =>
  tool === 'angle' || method === 'three' ? 3 : 2;

/** The method a placed Radius or Diameter was picked with, from how many points it has. */
export const methodOf = (pts: readonly Pt[]): CurveMethod => (pts.length >= 3 ? 'three' : 'centre');

/** Closer than this (points) is the same point. */
const SAME = 1e-6;

/**
 * The inside angle at `corner` between the arms to `a` and `b`, in degrees
 * (0 … 180); null when an arm has no length (a point on the corner).
 */
export function insideAngle(a: Pt, corner: Pt, b: Pt): number | null {
  const ux = a.x - corner.x;
  const uy = a.y - corner.y;
  const vx = b.x - corner.x;
  const vy = b.y - corner.y;
  const lu = Math.hypot(ux, uy);
  const lv = Math.hypot(vx, vy);
  if (lu < SAME || lv < SAME) return null;
  // atan2 of the cross and dot products: exact near 0° and 180°, where acos is not.
  const deg = (Math.atan2(Math.abs(ux * vy - uy * vx), ux * vx + uy * vy) * 180) / Math.PI;
  return Math.min(180, Math.max(0, deg));
}

/** The angles (radians) of an inside angle's arc: from the first arm to the second, the short way. */
export function angleArc(a: Pt, corner: Pt, b: Pt): { a0: number; a1: number; mid: number } {
  const t0 = Math.atan2(a.y - corner.y, a.x - corner.x);
  const t1 = Math.atan2(b.y - corner.y, b.x - corner.x);
  let d = t1 - t0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return { a0: t0, a1: t0 + d, mid: t0 + d / 2 };
}

/**
 * The circle through three points; null when two of them coincide or all
 * three are (nearly) in a line, where no circle, or one too large to mean
 * anything, goes through them.
 */
export function circleFrom3(p1: Pt, p2: Pt, p3: Pt): { c: Pt; r: number } | null {
  const size = Math.max(dist(p1, p2), dist(p2, p3), dist(p1, p3));
  if (Math.min(dist(p1, p2), dist(p2, p3), dist(p1, p3)) < SAME * Math.max(1, size)) return null;
  // Relative to p1, so large page coordinates lose no precision.
  const bx = p2.x - p1.x;
  const by = p2.y - p1.y;
  const cx = p3.x - p1.x;
  const cy = p3.y - p1.y;
  const d = 2 * (bx * cy - by * cx);
  // In a line: the sine of the angle at any point is below 1e-6.
  if (Math.abs(d) < 2e-6 * size * size) return null;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ox = (cy * b2 - by * c2) / d;
  const oy = (bx * c2 - cx * b2) / d;
  const c = { x: p1.x + ox, y: p1.y + oy };
  return { c, r: Math.hypot(ox, oy) };
}

const TAU = 2 * Math.PI;
const norm = (t: number): number => ((t % TAU) + TAU) % TAU;

/**
 * The arc about `c` from `p1` through `p2` to `p3`: its start angle and its
 * signed sweep (radians, |sweep| < 2π), the way that passes `p2`.
 */
export function arcThrough(c: Pt, p1: Pt, p2: Pt, p3: Pt): { a0: number; a1: number } {
  const t1 = Math.atan2(p1.y - c.y, p1.x - c.x);
  const t2 = Math.atan2(p2.y - c.y, p2.x - c.x);
  const t3 = Math.atan2(p3.y - c.y, p3.x - c.x);
  // Anticlockwise from p1: is p2 met before p3?
  const ccw3 = norm(t3 - t1);
  const ccw2 = norm(t2 - t1);
  return ccw2 <= ccw3 ? { a0: t1, a1: t1 + ccw3 } : { a0: t1, a1: t1 - (TAU - ccw3) };
}

/** A Radius's or Diameter's circle or arc, and its line from `from` to the edge point `edge`. */
export interface Round {
  c: Pt;
  r: number;
  /** The curve drawn: from a0 to a1 (radians); a full circle is 0 … 2π. */
  a0: number;
  a1: number;
  full: boolean;
  /** Where the line meets the curve (its arrow). */
  edge: Pt;
  /** Where the line starts: the centre (Radius) or the far side (Diameter). */
  from: Pt;
}

/**
 * A Radius's or Diameter's geometry; null when the points make no circle (two
 * points on top of each other, three in a line).
 */
export function roundOf(tool: CurveTool, pts: readonly Pt[], shape?: CurveShape): Round | null {
  const [p1, p2, p3] = pts;
  if (!p1 || !p2) return null;
  let c: Pt;
  let r: number;
  let a0 = 0;
  let a1 = TAU;
  let full = true;
  if (!p3) {
    c = p1;
    r = dist(p1, p2);
    if (r < SAME) return null;
  } else {
    const k = circleFrom3(p1, p2, p3);
    if (!k) return null;
    ({ c, r } = k);
    if ((shape ?? defaultShape(tool)) === 'arc') {
      ({ a0, a1 } = arcThrough(c, p1, p2, p3));
      full = false;
    }
  }
  // The line ends on the second click: the edge point, or the point between the other two.
  const t = Math.atan2(p2.y - c.y, p2.x - c.x);
  const edge = { x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) };
  const from = tool === 'diameter' ? { x: c.x - r * Math.cos(t), y: c.y - r * Math.sin(t) } : c;
  return { c, r, a0, a1, full, edge, from };
}

/**
 * The measured number: an Angle's degrees; a Radius's radius or a Diameter's
 * diameter in points on the page (the caller applies the scale). Null when
 * the points make no angle or circle, or there are too few.
 */
export function curveValue(tool: CurveTool, pts: readonly Pt[]): number | null {
  if (tool === 'angle') {
    const [a, corner, b] = pts;
    return a && corner && b ? insideAngle(a, corner, b) : null;
  }
  const g = roundOf(tool, pts);
  if (!g) return null;
  return tool === 'diameter' ? 2 * g.r : g.r;
}

/** An Angle's arc radius at the corner (points): a third of the shorter arm, 6 … 28 pt. */
export function angleRadius(a: Pt, corner: Pt, b: Pt): number {
  const arm = Math.min(dist(a, corner), dist(corner, b));
  return Math.max(Math.min(6, arm), Math.min(28, arm * 0.35));
}

/** An open arrow head at `tip`, pointing away from `from`: its two barbs. */
export function arrowHead(tip: Pt, from: Pt, size: number): [Pt, Pt][] {
  const len = dist(tip, from);
  if (len < SAME) return [];
  const ux = (tip.x - from.x) / len;
  const uy = (tip.y - from.y) / len;
  // 30° either side of the line.
  const c = Math.cos(Math.PI / 6);
  const s = Math.sin(Math.PI / 6);
  const barb = (sg: number): Pt => ({
    x: tip.x - size * (ux * c - sg * uy * s),
    y: tip.y - size * (uy * c + sg * ux * s),
  });
  return [
    [tip, barb(1)],
    [tip, barb(-1)],
  ];
}

/** An arc about `c` of radius `r` from `a0` to `a1`. */
export interface Arc {
  c: Pt;
  r: number;
  a0: number;
  a1: number;
}

/** What a curve measurement's appearance draws (the same on screen and in the file). */
export interface CurveDrawing {
  /** Straight strokes: an Angle's arms, the radius or diameter line, arrow barbs, the centre cross. */
  lines: [Pt, Pt][];
  arcs: Arc[];
  /** Where the caption goes once its size is known. */
  caption: (width: number, height: number) => CaptionBox;
  /** Points the drawing reaches (for its bounds). */
  extent: Pt[];
}

/** Points along an arc, about every 5°, ends included (bounds and SVG previews). */
export function arcSamples(a: Arc): Pt[] {
  const n = Math.max(2, Math.ceil(Math.abs(a.a1 - a.a0) / (Math.PI / 36)));
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = a.a0 + ((a.a1 - a.a0) * i) / n;
    return { x: a.c.x + a.r * Math.cos(t), y: a.c.y + a.r * Math.sin(t) };
  });
}

/** The arrow head's size for a line of `width` on a curve of radius `r`. */
const headSize = (width: number, r: number): number =>
  Math.max(2, Math.min(4 + 2 * Math.max(width, 1), r * 0.4));

/**
 * The drawing of an Angle, Radius or Diameter; null when its points make no
 * angle or circle (or are too few).
 */
export function curveDrawing(
  tool: CurveTool,
  pts: readonly Pt[],
  opts: { width?: number; shape?: CurveShape } = {},
): CurveDrawing | null {
  const width = opts.width ?? 1;
  if (tool === 'angle') {
    const [a, corner, b] = pts;
    if (!a || !corner || !b || insideAngle(a, corner, b) === null) return null;
    const r = angleRadius(a, corner, b);
    const arc = angleArc(a, corner, b);
    const dir = { x: Math.cos(arc.mid), y: Math.sin(arc.mid) };
    return {
      lines: [
        [a, corner],
        [corner, b],
      ],
      arcs: [{ c: corner, r, a0: arc.a0, a1: arc.a1 }],
      // Outside the arc, on the line that halves the angle, clear of it.
      caption: (w, h) => {
        const k = r + 3 + Math.hypot(w * dir.x, h * dir.y) / 2;
        return {
          at: { x: corner.x + dir.x * k, y: corner.y + dir.y * k },
          angle: 0,
          width: w,
          height: h,
        };
      },
      extent: [a, corner, b],
    };
  }
  const g = roundOf(tool, pts, opts.shape);
  if (!g) return null;
  const head = headSize(width, g.r);
  const lines: [Pt, Pt][] = [[g.from, g.edge], ...arrowHead(g.edge, g.from, head)];
  if (tool === 'diameter') lines.push(...arrowHead(g.from, g.edge, head));
  else {
    // A small cross on the centre.
    const k = Math.min(3, g.r / 4);
    lines.push(
      [
        { x: g.c.x - k, y: g.c.y },
        { x: g.c.x + k, y: g.c.y },
      ],
      [
        { x: g.c.x, y: g.c.y - k },
        { x: g.c.x, y: g.c.y + k },
      ],
    );
  }
  const curve: Arc = { c: g.c, r: g.r, a0: g.a0, a1: g.a1 };
  return {
    lines,
    arcs: [curve],
    // Above the half of the line from the centre to the edge (a drawing's own label
    // usually sits on the centre).
    caption: (w, h) => lineCaption(g.c, g.edge, 'top', w, h),
    extent: [...arcSamples(curve), g.from, g.edge, g.c],
  };
}

/** Bézier ops (PDF content) for an arc: quarter turns or less per curve. */
export function arcOps(a: Arc, fmt: (n: number) => string, move = true): string {
  const steps = Math.max(1, Math.ceil(Math.abs(a.a1 - a.a0) / (Math.PI / 2) - 1e-9));
  const d = (a.a1 - a.a0) / steps;
  const k = (4 / 3) * Math.tan(d / 4);
  const at = (t: number): Pt => ({ x: a.c.x + a.r * Math.cos(t), y: a.c.y + a.r * Math.sin(t) });
  const xy = (p: Pt): string => `${fmt(p.x)} ${fmt(p.y)}`;
  const out: string[] = [];
  if (move) out.push(`${xy(at(a.a0))} m`);
  let t = a.a0;
  for (let i = 0; i < steps; i++) {
    const p0 = at(t);
    const p3 = at(t + d);
    const c1 = { x: p0.x - k * a.r * Math.sin(t), y: p0.y + k * a.r * Math.cos(t) };
    const c2 = { x: p3.x + k * a.r * Math.sin(t + d), y: p3.y - k * a.r * Math.cos(t + d) };
    out.push(`${xy(c1)} ${xy(c2)} ${xy(p3)} c`);
    t += d;
  }
  return out.join(' ');
}

/** An SVG path for an arc (y as given: the main thread passes EmbedPDF's page points). */
export function arcPath(a: Arc, scale: number): string {
  const full = Math.abs(a.a1 - a.a0) >= TAU - 1e-9;
  const at = (t: number): Pt => ({
    x: (a.c.x + a.r * Math.cos(t)) * scale,
    y: (a.c.y + a.r * Math.sin(t)) * scale,
  });
  const r = a.r * scale;
  const f = (n: number): string => String(Math.round(n * 100) / 100);
  if (full) {
    const p = at(a.a0);
    const q = at(a.a0 + Math.PI);
    return `M${f(p.x)} ${f(p.y)} A${f(r)} ${f(r)} 0 1 1 ${f(q.x)} ${f(q.y)} A${f(r)} ${f(r)} 0 1 1 ${f(p.x)} ${f(p.y)}`;
  }
  const p = at(a.a0);
  const q = at(a.a1);
  const large = Math.abs(a.a1 - a.a0) > Math.PI ? 1 : 0;
  // SVG's sweep flag 1 runs towards increasing angle in its own (y down) frame.
  const sweep = a.a1 > a.a0 ? 1 : 0;
  return `M${f(p.x)} ${f(p.y)} A${f(r)} ${f(r)} 0 ${String(large)} ${String(sweep)} ${f(q.x)} ${f(q.y)}`;
}

/**
 * A one-page PDF with nothing on it: the Stamp's first appearance, which the
 * Render worker replaces with the measurement's own (a constant: nothing is
 * parsed or built on the main thread).
 */
export const BLANK_STAMP_PDF = (() => {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << >> /Contents 4 0 R >>',
    // One path with no paint: PDFium makes an appearance only from a page with an object on it.
    '<< /Length 13 >>\nstream\n0 0 0 0 re n\nendstream',
  ];
  let out = '%PDF-1.7\n';
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${String(i + 1)} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${String(objs.length + 1)}\n0000000000 65535 f \n`;
  out += offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${String(objs.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0));
})();
