// The geometry of a measurement's caption (M14-03, D-74, ADR-035 Amendment 1;
// from spike S34's geometry.ts). Pure. PDF user space (points, y up) unless a
// function says otherwise: the Render worker draws there, and the main thread
// works in EmbedPDF's page points mirrored (y down → y up), which places the
// caption on the same side as seen on the page.

export interface Pt {
  x: number;
  y: number;
}

/** x0, y0, x1, y1. */
export type Box = [number, number, number, number];

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
export const dist = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y);

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

/** The four corners of a caption box (its bounds; the gap in an In line dimension line). */
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

/** The gap between a line and an Above caption (points). */
export const CAPTION_GAP = 1.5;

/**
 * Where a line's caption goes: centred on the line's middle, along it, read
 * left to right; Above sits clear of the line on the reading side's top, In
 * line sits on the line (the line is broken for it, /CP /Inline).
 */
export function lineCaption(
  a: Pt,
  b: Pt,
  where: 'top' | 'inline',
  width: number,
  height: number,
): CaptionBox {
  const angle = readableAngle(a, b);
  const m = add(a, mul(sub(b, a), 0.5));
  if (where === 'inline') return { at: m, angle, width, height };
  // "Up" for the reading direction: the text's own +y.
  const up = { x: -Math.sin(angle), y: Math.cos(angle) };
  return { at: add(m, mul(up, height / 2 + CAPTION_GAP)), angle, width, height };
}

/** The longest segment of a path (a Polylength's or Perimeter's caption sits on it, Q40). */
export function longestSegment(pts: readonly Pt[], closed: boolean): [Pt, Pt] {
  const zero = { x: 0, y: 0 };
  let best: [Pt, Pt] = [pts[0] ?? zero, pts[1] ?? pts[0] ?? zero];
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

/** Signed shoelace area (positive anticlockwise). */
export function signedArea(pts: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (a && b) s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
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
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    if (!p || !q) continue;
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
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/**
 * Where an area's value goes (Q40, the middle of the shape): the centroid when
 * the caption box fits inside the outline there, clear of its cutouts (M14-06);
 * otherwise the nearest grid point where it does; otherwise the centroid (a
 * shape too small for its value).
 */
export function areaLabelPoint(
  outer: readonly Pt[],
  w: number,
  h: number,
  holes: readonly (readonly Pt[])[] = [],
): Pt {
  const ok = (p: Pt): boolean => {
    const box = corners({ at: p, angle: 0, width: w, height: h });
    const pts = box.concat([p]);
    return (
      pts.every((q) => inside(q, outer)) &&
      holes.every((hole) => !pts.some((q) => inside(q, hole)) && !hole.some((q) => inside(q, box)))
    );
  };
  const c = centroid(outer);
  if (outer.length < 3 || ok(c)) return c;
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

/** FNV-1a of the geometry rounded to 0.01 pt: "is this still the shape we saved?" */
export function fingerprint(pts: readonly Pt[]): string {
  let h = 0x811c9dc5;
  const s = pts
    .flatMap((p) => [p.x, p.y])
    .map((n) => (Math.round(n * 100) / 100).toFixed(2))
    .join(',');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
