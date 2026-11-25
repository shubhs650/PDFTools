// A measurement being drawn (M14-02, D-78, ADR-035): its points live here,
// apart from the pointer handlers. EmbedPDF makes new handlers for a page on
// every zoom and whenever the page is laid out again (a scroll that takes it
// out of view and back), so state kept in a handler was lost and the next
// click started a new measurement (owner, Q19). Every view change now leaves
// this state alone; only Esc, another tool or a click on another page ends it.
// Pure. Points are EmbedPDF page points (top-left origin, y down).
import { offsetOf, type Pt } from './dimension';

export type GestureKind = 'distance' | 'perimeter' | 'area';

/** Where a pointer event happens: a document, the tool that is on, a page. */
export interface Where {
  doc: string;
  tool: string;
  page: number;
}

export interface Gesture extends Where {
  kind: GestureKind;
  /** The points placed so far. */
  pts: Pt[];
  /** The pointer's last place on the page (the preview's moving end). */
  pointer: Pt | null;
  /** A Distance's sideways offset once both points are placed (M13-10). */
  offset: number;
}

export interface Outcome {
  gesture: Gesture | null;
  /** Finished: the caller makes the annotation from it. */
  commit?: Gesture;
  /** Ended without an annotation: its preview goes; a page change says so. */
  ended?: { gesture: Gesture; reason: 'page' | 'other' };
}

/** A second click closer than this (points) to the last point adds nothing. */
const SAME_POINT = 1;

const near = (a: Pt, b: Pt, r: number): boolean =>
  Math.abs(a.x - b.x) < r && Math.abs(a.y - b.y) < r;

/** The gesture is the one drawn with this tool on this page of this document. */
export function owns(g: Gesture | null, w: Where): boolean {
  return !!g && g.doc === w.doc && g.tool === w.tool && g.page === w.page;
}

/** The last point placed: Shift locks the angle from it. */
export function anchorOf(g: Gesture | null, w: Where): Pt | null {
  return g && owns(g, w) ? (g.pts[g.pts.length - 1] ?? null) : null;
}

const start = (w: Where, kind: GestureKind, at: Pt): Gesture => ({
  doc: w.doc,
  tool: w.tool,
  page: w.page,
  kind,
  pts: [at],
  pointer: at,
  offset: 0,
});

/**
 * A click. `closeRadius` (points): an area's click this close to its first
 * corner (a square, as EmbedPDF's polygon tool has it) closes it.
 */
export function click(
  g: Gesture | null,
  w: Where,
  kind: GestureKind,
  at: Pt,
  closeRadius: number,
): Outcome {
  if (!g) return { gesture: start(w, kind, at) };
  if (!owns(g, w)) {
    // No measurement runs across pages (Q19): the old one ends, a new one starts here.
    const reason = g.doc === w.doc && g.tool === w.tool ? 'page' : 'other';
    return { gesture: start(w, kind, at), ended: { gesture: g, reason } };
  }
  const last = g.pts[g.pts.length - 1];
  if (g.kind === 'distance') {
    const [a, b] = g.pts;
    if (a && !b) {
      if (Math.hypot(at.x - a.x, at.y - a.y) < SAME_POINT) return { gesture: g };
      return { gesture: { ...g, pts: [a, at], pointer: at, offset: 0 } };
    }
    if (a && b) {
      const done = { ...g, pointer: at, offset: offsetOf(a, b, at, true) };
      return { gesture: null, commit: done };
    }
    return { gesture: start(w, kind, at) };
  }
  const first = g.pts[0];
  if (g.kind === 'area' && first && g.pts.length >= 3 && near(first, at, closeRadius + 1e-9))
    return { gesture: null, commit: g };
  if (last && near(last, at, SAME_POINT)) return { gesture: g };
  return { gesture: { ...g, pts: [...g.pts, at], pointer: at } };
}

/** The pointer moved over a page: only the gesture's own page moves its preview. */
export function move(g: Gesture | null, w: Where, at: Pt): Gesture | null {
  if (!g || !owns(g, w)) return g;
  const [a, b] = g.pts;
  const offset = g.kind === 'distance' && a && b ? offsetOf(a, b, at, true) : g.offset;
  return { ...g, pointer: at, offset };
}

const ENOUGH: Record<GestureKind, number> = { distance: 2, perimeter: 2, area: 3 };

/** Enter or a double-click: placed as it is when it has enough points, else dropped. */
export function finish(g: Gesture | null): Outcome {
  if (!g) return { gesture: null };
  if (g.pts.length < ENOUGH[g.kind]) return { gesture: null };
  // A Distance keeps the offset the pointer set (a double-click on its second point: none).
  return { gesture: null, commit: g };
}

/** Esc, another tool, another tab. */
export function cancel(): null {
  return null;
}
