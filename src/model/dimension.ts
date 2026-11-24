// A Distance drawn as a dimension (M13-10, ADR-034 Amendment 3): the two
// measured points stay the line's /L; the dimension line sits beside them, at
// the offset the person set by moving the pointer sideways, joined to the
// points by two leader lines. The offset is stored the standard way, as the
// Line annotation's leader line entries (ISO 32000-1 §12.5.6.7, Table 175):
//   /LL   the leader lines' length, signed: positive is clockwise when going
//         from the start of /L to its end (in PDF user space, y up);
//   /LLE  how far the leader lines go past the dimension line (≥ 0);
//   /LLO  the gap between each point and its leader line (≥ 0).
// Pure. Coordinates are either EmbedPDF's (page points, top-left origin, y down)
// or PDF user space (y up); `yDown` says which. A mirror between the two (every
// page rotation EmbedPDF maps is one) turns clockwise into anticlockwise, so the
// same /LL gives the same side on screen and in the file.

export interface Pt {
  x: number;
  y: number;
}

/** The leader line entries of a Line annotation, in points. */
export interface Leader {
  /** /LL: signed length of the leader lines (positive: clockwise from /L's start to its end). */
  ll: number;
  /** /LLE: how far the leader lines go past the dimension line. */
  lle: number;
  /** /LLO: the gap between each measured point and its leader line. */
  llo: number;
}

/** How far our leader lines go past the dimension line (points). */
export const LEADER_EXTENSION = 3;

/** An offset smaller than this (points) is no offset: a plain line, no leader lines. */
export const MIN_OFFSET = 1;

/** The unit normal that a positive /LL points along; null for a line of no length. */
export function leaderNormal(a: Pt, b: Pt, yDown: boolean): Pt | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  // Clockwise in y-up space is (dy, -dx); seen in y-down space it is (-dy, dx).
  return yDown ? { x: -dy / len, y: dx / len } : { x: dy / len, y: -dx / len };
}

/** The signed offset of `p` from the line a → b, as /LL counts it. */
export function offsetOf(a: Pt, b: Pt, p: Pt, yDown: boolean): number {
  const n = leaderNormal(a, b, yDown);
  if (!n) return 0;
  return (p.x - a.x) * n.x + (p.y - a.y) * n.y;
}

/** The leader for an offset set with the pointer; null when it is too small to draw. */
export function leaderFor(offset: number): Leader | null {
  if (!Number.isFinite(offset) || Math.abs(offset) < MIN_OFFSET) return null;
  return { ll: round(offset), lle: LEADER_EXTENSION, llo: 0 };
}

/** A leader read from a file: null when /LL is missing or zero. */
export function leaderFromFile(
  ll: number | undefined,
  lle: number | undefined,
  llo: number | undefined,
): Leader | null {
  if (ll === undefined || !Number.isFinite(ll) || ll === 0) return null;
  const pos = (v: number | undefined): number =>
    v !== undefined && Number.isFinite(v) && v > 0 ? v : 0;
  return { ll, lle: pos(lle), llo: pos(llo) };
}

export interface DimensionGeometry {
  /** The dimension line: where it starts and ends (beside a and b). */
  start: Pt;
  end: Pt;
  /** The two leader lines, each from near its measured point to just past the dimension line. */
  leaders: [[Pt, Pt], [Pt, Pt]];
}

/** Where a dimension's lines go. With no leader (or a line of no length), the line itself. */
export function dimensionGeometry(
  a: Pt,
  b: Pt,
  leader: Leader | null | undefined,
  yDown: boolean,
): DimensionGeometry {
  const n = leader ? leaderNormal(a, b, yDown) : null;
  if (!leader || !n)
    return {
      start: { ...a },
      end: { ...b },
      leaders: [
        [a, a],
        [b, b],
      ],
    };
  const s = Math.sign(leader.ll);
  const at = (p: Pt, d: number): Pt => ({ x: p.x + n.x * d, y: p.y + n.y * d });
  const from = s * leader.llo;
  const to = leader.ll + s * leader.lle;
  return {
    start: at(a, leader.ll),
    end: at(b, leader.ll),
    leaders: [
      [at(a, from), at(a, to)],
      [at(b, from), at(b, to)],
    ],
  };
}

/** Every point a dimension draws through (for its bounds). */
export function dimensionPoints(g: DimensionGeometry): Pt[] {
  return [g.start, g.end, ...g.leaders[0], ...g.leaders[1]];
}

/** The bounds of `pts`, `pad` wider all round, as an EmbedPDF rect. */
export function boundsOf(
  pts: readonly Pt[],
  pad: number,
): { origin: Pt; size: { width: number; height: number } } {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs) - pad;
  const y0 = Math.min(...ys) - pad;
  return {
    origin: { x: x0, y: y0 },
    size: { width: Math.max(...xs) + pad - x0, height: Math.max(...ys) + pad - y0 },
  };
}

/** The union of two EmbedPDF rects. */
export function unionRect(
  r: { origin: Pt; size: { width: number; height: number } },
  q: { origin: Pt; size: { width: number; height: number } },
): { origin: Pt; size: { width: number; height: number } } {
  const x0 = Math.min(r.origin.x, q.origin.x);
  const y0 = Math.min(r.origin.y, q.origin.y);
  const x1 = Math.max(r.origin.x + r.size.width, q.origin.x + q.size.width);
  const y1 = Math.max(r.origin.y + r.size.height, q.origin.y + q.size.height);
  return { origin: { x: x0, y: y0 }, size: { width: x1 - x0, height: y1 - y0 } };
}

/**
 * The content-stream operators that stroke the two leader lines, solid, in the
 * colour, width and transparency already set (PDF user space).
 */
export function leaderOperators(g: DimensionGeometry): string {
  const n = (v: number): string => {
    const s = (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/u, '');
    return s === '-0' ? '0' : s;
  };
  const seg = ([p, q]: [Pt, Pt]): string => `${n(p.x)} ${n(p.y)} m ${n(q.x)} ${n(q.y)} l`;
  return `q [] 0 d ${seg(g.leaders[0])} ${seg(g.leaders[1])} S Q\n`;
}

/** The middle of the dimension line: where a distance's value label goes. */
export function dimensionMiddle(a: Pt, b: Pt, leader: Leader | null | undefined): Pt {
  const g = dimensionGeometry(a, b, leader, true);
  return { x: (g.start.x + g.end.x) / 2, y: (g.start.y + g.end.y) / 2 };
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** The leader of an annotation object (our extra `leader` field), if it has one. */
export function leaderOf(a: unknown): Leader | null {
  const l = (a as { leader?: unknown } | null)?.leader;
  if (typeof l !== 'object' || l === null) return null;
  const { ll, lle, llo } = l as Partial<Leader>;
  return typeof ll === 'number' && ll !== 0
    ? { ll, lle: typeof lle === 'number' ? lle : 0, llo: typeof llo === 'number' ? llo : 0 }
    : null;
}
