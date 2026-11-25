// Spike S34 (M14-01): the pure geometry the measurement appearances need.
// PDF user space (points, y up). Candidates for src/model in M14-03 … M14-07.
/* eslint-disable @typescript-eslint/non-nullable-type-assertion-style -- indices in range (spike code) */

export interface Pt {
  x: number;
  y: number;
}

export type Box = [number, number, number, number];

const f = (n: number): string => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};
export const xy = (p: Pt): string => `${f(p.x)} ${f(p.y)}`;
export { f as fnum };

export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
export const dist = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y);
export const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Bounds of points, grown by `pad`. */
export function bounds(pts: readonly Pt[], pad = 0): Box {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return [
    Math.min(...xs) - pad,
    Math.min(...ys) - pad,
    Math.max(...xs) + pad,
    Math.max(...ys) + pad,
  ];
}

export function unionBox(a: Box, b: Box): Box {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/**
 * A text direction that reads left to right: the angle of a → b turned by
 * 180° when it would read upside down (−90° < angle ≤ 90°).
 */
export function readableAngle(a: Pt, b: Pt): number {
  let ang = Math.atan2(b.y - a.y, b.x - a.x);
  if (ang > Math.PI / 2 + 1e-9) ang -= Math.PI;
  else if (ang <= -Math.PI / 2 + 1e-9) ang += Math.PI;
  return ang;
}

/** A caption's box: centred on `at`, turned by `angle` (radians). */
export interface CaptionBox {
  at: Pt;
  angle: number;
  width: number;
  height: number;
}

/** The four corners of a caption box (for bounds and for the gap in an In-line dimension line). */
export function corners(c: CaptionBox): Pt[] {
  const cos = Math.cos(c.angle);
  const sin = Math.sin(c.angle);
  const hw = c.width / 2;
  const hh = c.height / 2;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([x = 0, y = 0]) => ({ x: c.at.x + x * cos - y * sin, y: c.at.y + x * sin + y * cos }));
}

/**
 * Where a line's caption goes: centred on the line's middle, along it, read
 * left to right; Above sits clear of the line on the reading side's top, In
 * line sits on the line (the line is broken for it, /CP /Inline).
 */
export function lineCaption(
  a: Pt,
  b: Pt,
  where: 'above' | 'inline',
  width: number,
  height: number,
  gap = 1.5,
  along = 0.5,
): CaptionBox {
  const angle = readableAngle(a, b);
  const m = add(a, mul(sub(b, a), along));
  if (where === 'inline') return { at: m, angle, width, height };
  // "Up" for the reading direction: the text's own +y.
  const up = { x: -Math.sin(angle), y: Math.cos(angle) };
  return { at: add(m, mul(up, height / 2 + gap)), angle, width, height };
}

/** The longest segment of a path (a Polylength's or Perimeter's caption sits on it). */
export function longestSegment(pts: readonly Pt[], closed: boolean): [Pt, Pt] {
  let best: [Pt, Pt] = [pts[0] ?? { x: 0, y: 0 }, pts[1] ?? pts[0] ?? { x: 0, y: 0 }];
  let len = -1;
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    if (!a || !b) continue;
    const d = dist(a, b);
    if (d > len + 1e-9) {
      len = d;
      best = [a, b];
    }
  }
  return best;
}

export function pathLength(pts: readonly Pt[], closed: boolean): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += dist(pts[i - 1] as Pt, pts[i] as Pt);
  if (closed && pts.length > 2) d += dist(pts[pts.length - 1] as Pt, pts[0] as Pt);
  return d;
}

/** Signed shoelace area (positive anticlockwise). */
export function signedArea(pts: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i] as Pt;
    const b = pts[(i + 1) % pts.length] as Pt;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** Net area of an outline with holes (holes inside, not overlapping). */
export function netArea(outer: readonly Pt[], holes: readonly (readonly Pt[])[] = []): number {
  return Math.abs(signedArea(outer)) - holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);
}

/** Area-weighted centroid of a simple polygon (falls back to the vertex mean). */
export function centroid(pts: readonly Pt[]): Pt {
  const a = signedArea(pts);
  if (Math.abs(a) < 1e-9) {
    const n = pts.length || 1;
    return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as Pt;
    const q = pts[(i + 1) % pts.length] as Pt;
    const k = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * k;
    cy += (p.y + q.y) * k;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/** Point in polygon (even-odd). */
export function inside(p: Pt, poly: readonly Pt[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Pt;
    const b = poly[j] as Pt;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/**
 * Where an area's value goes: the centroid when it is inside the outline and
 * outside every hole and the caption box fits there; otherwise the nearest
 * grid point that is (a cutout's centroid can fall in a hole).
 */
export function areaLabelPoint(
  outer: readonly Pt[],
  holes: readonly (readonly Pt[])[],
  w: number,
  h: number,
): Pt {
  const ok = (p: Pt): boolean =>
    corners({ at: p, angle: 0, width: w, height: h })
      .concat([p])
      .every((q) => inside(q, outer) && holes.every((hole) => !inside(q, hole)));
  const c = centroid(outer);
  if (ok(c)) return c;
  const [x0, y0, x1, y1] = bounds(outer);
  let best: Pt | null = null;
  let bestD = Infinity;
  const step = Math.max((x1 - x0) / 40, (y1 - y0) / 40, 1);
  for (let x = x0; x <= x1; x += step)
    for (let y = y0; y <= y1; y += step) {
      const p = { x, y };
      const d = dist(p, c);
      if (d < bestD && ok(p)) {
        best = p;
        bestD = d;
      }
    }
  return best ?? c;
}

/** The inside angle at `corner` between the arms to `a` and `b`, in degrees (0 … 180). */
export function insideAngle(a: Pt, corner: Pt, b: Pt): number {
  const u = sub(a, corner);
  const v = sub(b, corner);
  const lu = Math.hypot(u.x, u.y);
  const lv = Math.hypot(v.x, v.y);
  if (lu < 1e-9 || lv < 1e-9) return Number.NaN;
  const c = Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / (lu * lv)));
  return (Math.acos(c) * 180) / Math.PI;
}

/** Bézier ops for an arc of radius r about c from angle a0 to a1 (radians, either way). */
export function arcOps(c: Pt, r: number, a0: number, a1: number, move = true): string {
  const steps = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2)));
  const d = (a1 - a0) / steps;
  const k = (4 / 3) * Math.tan(d / 4);
  const at = (t: number): Pt => ({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
  const out: string[] = [];
  if (move) out.push(`${xy(at(a0))} m`);
  let t = a0;
  for (let i = 0; i < steps; i++) {
    const p0 = at(t);
    const p3 = at(t + d);
    const c1 = { x: p0.x - k * r * Math.sin(t), y: p0.y + k * r * Math.cos(t) };
    const c2 = { x: p3.x + k * r * Math.sin(t + d), y: p3.y - k * r * Math.cos(t + d) };
    out.push(`${xy(c1)} ${xy(c2)} ${xy(p3)} c`);
    t += d;
  }
  return out.join(' ');
}

/** The arc of an inside angle: from the first arm's direction to the second's, the short way. */
export function angleArc(a: Pt, corner: Pt, b: Pt): { a0: number; a1: number; mid: number } {
  const t0 = Math.atan2(a.y - corner.y, a.x - corner.x);
  let t1 = Math.atan2(b.y - corner.y, b.x - corner.x);
  let d = t1 - t0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  t1 = t0 + d;
  return { a0: t0, a1: t1, mid: t0 + d / 2 };
}

/** The circle through three points; null when they are (nearly) in a line or coincide. */
export function circleFrom3(p1: Pt, p2: Pt, p3: Pt): { c: Pt; r: number } | null {
  const d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
  const scale = Math.max(dist(p1, p2), dist(p2, p3), dist(p1, p3));
  if (scale < 1e-9 || Math.abs(d) < 1e-9 * scale * scale) return null;
  const s1 = p1.x * p1.x + p1.y * p1.y;
  const s2 = p2.x * p2.x + p2.y * p2.y;
  const s3 = p3.x * p3.x + p3.y * p3.y;
  const c = {
    x: (s1 * (p2.y - p3.y) + s2 * (p3.y - p1.y) + s3 * (p1.y - p2.y)) / d,
    y: (s1 * (p3.x - p2.x) + s2 * (p1.x - p3.x) + s3 * (p2.x - p1.x)) / d,
  };
  return { c, r: dist(c, p1) };
}

/** The six count symbols (D-75), centred on `c`, `s` across, as path ops (not painted). */
export type Shape = 'circle' | 'square' | 'triangle' | 'diamond' | 'cross' | 'tick';
export const SHAPES: readonly Shape[] = [
  'circle',
  'square',
  'triangle',
  'diamond',
  'cross',
  'tick',
];

export function symbolOps(shape: Shape, c: Pt, s: number): { ops: string; filled: boolean } {
  const h = s / 2;
  const P = (x: number, y: number): string => xy({ x: c.x + x, y: c.y + y });
  switch (shape) {
    case 'circle':
      return { ops: `${arcOps(c, h, 0, 2 * Math.PI)} h`, filled: true };
    case 'square':
      return { ops: `${P(-h, -h)} m ${P(h, -h)} l ${P(h, h)} l ${P(-h, h)} l h`, filled: true };
    case 'triangle':
      return { ops: `${P(0, h)} m ${P(h, -h * 0.8)} l ${P(-h, -h * 0.8)} l h`, filled: true };
    case 'diamond':
      return { ops: `${P(0, h)} m ${P(h, 0)} l ${P(0, -h)} l ${P(-h, 0)} l h`, filled: true };
    case 'cross':
      return { ops: `${P(-h, -h)} m ${P(h, h)} l ${P(-h, h)} m ${P(h, -h)} l`, filled: false };
    case 'tick':
      return { ops: `${P(-h, 0)} m ${P(-h * 0.3, -h * 0.7)} l ${P(h, h * 0.8)} l`, filled: false };
  }
}

/** Ops for an open arrow head at `tip`, pointing from `from` to `tip`. */
export function openArrow(from: Pt, tip: Pt, len: number): string {
  const ang = Math.atan2(tip.y - from.y, tip.x - from.x);
  const w = (30 * Math.PI) / 180;
  const p1 = { x: tip.x - len * Math.cos(ang - w), y: tip.y - len * Math.sin(ang - w) };
  const p2 = { x: tip.x - len * Math.cos(ang + w), y: tip.y - len * Math.sin(ang + w) };
  return `${xy(p1)} m ${xy(tip)} l ${xy(p2)} l S`;
}

/** A path through points as ops (not painted). */
export function pathOps(pts: readonly Pt[], close: boolean): string {
  return `${pts.map((p, i) => `${xy(p)} ${i ? 'l' : 'm'}`).join(' ')}${close ? ' h' : ''}`;
}

/** FNV-1a of the geometry rounded to 0.01 pt: "is this still the shape we saved?" */
export function fingerprint(nums: readonly number[]): string {
  let h = 0x811c9dc5;
  const s = nums.map((n) => (Math.round(n * 100) / 100).toFixed(2)).join(',');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
