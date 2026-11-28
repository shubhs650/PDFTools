// Editing a placed measurement point by point (M14-04, D-78, Q24): which
// points have handles, what a drag, an added point or a removed point does to
// the stored points, where a right-click lands (a point or an edge), and which
// measurements a scale change touches (D-77, Q23). Pure. Points are EmbedPDF
// page points (top-left origin, y down) unless a function says otherwise.
import { isCurveTool } from './measureCurve';
import type { MeasureTool } from './measureMarkup';
import type { PageLayout } from './scaleViewport';
import { scaleChoice, scaleOfChoice } from './scaleViewport';
import type { Pt, Scale, ScaleChoice } from './scale';

/**
 * A Length has its two points only, an Angle, Radius or Diameter the points it
 * was picked with (M14-05); the others add and remove points (Q24).
 */
export const canAddPoints = (tool: MeasureTool): boolean =>
  tool !== 'length' && tool !== 'count' && !isCurveTool(tool);

/** A Perimeter and an Area are closed: an edge joins the last point to the first. */
export const isClosed = (tool: MeasureTool): boolean => tool === 'perimeter' || tool === 'area';

/** Fewest points a measurement keeps: a Length and a Polylength 2, closed shapes 3. */
export const minPoints = (tool: MeasureTool): number => (isClosed(tool) ? 3 : 2);

const same = (a: Pt | undefined, b: Pt | undefined): boolean =>
  !!a && !!b && Math.hypot(a.x - b.x, a.y - b.y) < 0.01;

/**
 * The points that get a handle: the stored points, but a Perimeter's PolyLine
 * repeats its first vertex at the end (M14-03), and that one has no handle of
 * its own.
 */
export function handlesOf(tool: MeasureTool, stored: readonly Pt[]): Pt[] {
  const pts = stored.map((p) => ({ x: p.x, y: p.y }));
  if (tool === 'perimeter' && pts.length > 3 && same(pts[0], pts[pts.length - 1])) pts.pop();
  return pts;
}

/** The stored points for edited handles (a Perimeter repeats its first again). */
export function storedOf(tool: MeasureTool, handles: readonly Pt[]): Pt[] {
  const pts = handles.map((p) => ({ x: p.x, y: p.y }));
  const first = pts[0];
  if (tool === 'perimeter' && first) pts.push({ ...first });
  return pts;
}

/** Handle `i` moved to `p`. */
export function movePoint(handles: readonly Pt[], i: number, p: Pt): Pt[] {
  return handles.map((q, k) => (k === i ? { x: p.x, y: p.y } : { x: q.x, y: q.y }));
}

/** The edges between handles: [from, to] index pairs (closed shapes end with last → first). */
export function edgesOf(tool: MeasureTool, n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < n; i++) out.push([i, i + 1]);
  if (isClosed(tool) && n > 2) out.push([n - 1, 0]);
  return out;
}

/** A point added on edge `edge` (between its two handles) at `p`; null where none can be added. */
export function insertPoint(
  tool: MeasureTool,
  handles: readonly Pt[],
  edge: number,
  p: Pt,
): Pt[] | null {
  if (!canAddPoints(tool)) return null;
  const e = edgesOf(tool, handles.length)[edge];
  if (!e) return null;
  const out = handles.map((q) => ({ x: q.x, y: q.y }));
  // The closing edge (last → first) puts the new point at the end.
  out.splice(e[0] + 1, 0, { x: p.x, y: p.y });
  return out;
}

/** Whether handle points can be removed: more than the fewest the tool keeps. */
export const canRemovePoint = (tool: MeasureTool, n: number): boolean =>
  canAddPoints(tool) && n > minPoints(tool);

/** Handle `i` removed; null when the measurement would have too few points. */
export function removePoint(tool: MeasureTool, handles: readonly Pt[], i: number): Pt[] | null {
  if (!canRemovePoint(tool, handles.length) || i < 0 || i >= handles.length) return null;
  return handles.filter((_, k) => k !== i).map((q) => ({ x: q.x, y: q.y }));
}

/** The nearest point of segment a–b to p, and how far along it is (0…1). */
export function project(a: Pt, b: Pt, p: Pt): { at: Pt; t: number; d: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const at = { x: a.x + t * dx, y: a.y + t * dy };
  return { at, t, d: Math.hypot(p.x - at.x, p.y - at.y) };
}

/** The handle within `tol` of `p` (the nearest), or -1. */
export function hitPoint(handles: readonly Pt[], p: Pt, tol: number): number {
  let best = -1;
  let bestD = tol;
  handles.forEach((q, i) => {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

/** The edge within `tol` of `p` (the nearest) and the point on it, or null. */
export function hitEdge(
  tool: MeasureTool,
  handles: readonly Pt[],
  p: Pt,
  tol: number,
): { edge: number; at: Pt } | null {
  let best: { edge: number; at: Pt } | null = null;
  let bestD = tol;
  edgesOf(tool, handles.length).forEach(([i, j], edge) => {
    const a = handles[i];
    const b = handles[j];
    if (!a || !b) return;
    const r = project(a, b, p);
    if (r.d <= bestD) {
      best = { edge, at: r.at };
      bestD = r.d;
    }
  });
  return best;
}

/** What a right-click on a selected measurement does (Q24): remove a point, add one, or nothing. */
export type PointAction =
  | { kind: 'remove'; index: number; handles: Pt[] }
  | { kind: 'add'; edge: number; at: Pt; handles: Pt[] }
  | null;

/**
 * A right-click at `p`: on a point (within `pointTol`) removes it where the
 * measurement keeps enough points; on an edge (within `edgeTol`) adds a point
 * there. A click on a point that can't go is nothing (the comment menu opens).
 */
export function pointAction(
  tool: MeasureTool,
  handles: readonly Pt[],
  p: Pt,
  pointTol: number,
  edgeTol: number,
): PointAction {
  if (!canAddPoints(tool)) return null;
  const i = hitPoint(handles, p, pointTol);
  if (i >= 0) {
    const next = removePoint(tool, handles, i);
    return next ? { kind: 'remove', index: i, handles: next } : null;
  }
  const e = hitEdge(tool, handles, p, edgeTol);
  if (!e) return null;
  const next = insertPoint(tool, handles, e.edge, e.at);
  return next ? { kind: 'add', edge: e.edge, at: e.at, handles: next } : null;
}

/**
 * The point Shift locks a dragged handle from (0°, 45°, 90°, D-78): the one
 * before it; the first point of an open shape locks from the second. An
 * Angle's arms lock from its corner and the corner from the first arm; a
 * Radius's or Diameter's edge from its centre (M14-05).
 */
export function lockAnchor(tool: MeasureTool, handles: readonly Pt[], i: number): Pt | null {
  const n = handles.length;
  if (n < 2) return null;
  if (tool === 'angle' && n === 3) return (i === 1 ? handles[0] : handles[1]) ?? null;
  if (i > 0) return handles[i - 1] ?? null;
  return (isClosed(tool) ? handles[n - 1] : handles[1]) ?? null;
}

/** The handle a keyboard step lands on: `p` moved by (dx, dy), kept on the page. */
export function stepPoint(
  p: Pt,
  dx: number,
  dy: number,
  page: { width: number; height: number },
): Pt {
  return {
    x: Math.min(page.width, Math.max(0, p.x + dx)),
    y: Math.min(page.height, Math.max(0, p.y + dy)),
  };
}

// ---- scale changes (D-77, Q23) ------------------------------------------------------

const sameScale = (a: Scale | null, b: Scale | null): boolean => {
  if (!a || !b) return a === b;
  return (
    a.unit === b.unit &&
    a.precision === b.precision &&
    (a.ftIn ?? 0) === (b.ftIn ?? 0) &&
    Math.abs(a.real / a.paper - b.real / b.paper) <= 1e-9 * Math.max(1, b.real / b.paper)
  );
};

/** What a measurement is valued by: its scale and whether it spans two scale areas. */
const valuedBy = (c: ScaleChoice): { scale: Scale | null; spans: boolean } => ({
  scale: scaleOfChoice(c),
  spans: c.kind === 'spanning',
});

/**
 * The measurements a scale change touches (D-77, Q23): those whose scale (or
 * whether they span two scale areas) differs between the page laid out as
 * `before` and as `after`. `pts` are PDF user space, as viewports' boxes are.
 */
export function touchedBy(
  items: readonly { id: string; pts: Pt[] }[],
  before: PageLayout,
  after: PageLayout,
): string[] {
  return items
    .filter(({ pts }) => {
      const a = valuedBy(scaleChoice(pts, before));
      const b = valuedBy(scaleChoice(pts, after));
      return a.spans !== b.spans || !sameScale(a.scale, b.scale);
    })
    .map(({ id }) => id);
}
