// The Review layout's link between windows (M12-12, D-62, spike S27): the
// overlay window, Document A and Document B show the same spot of the
// drawing at matching zoom. Pure maths, unit-tested.
//
// Every window works in its page's **displayed space** (points, origin top
// left, y down, /Rotate applied), the space of the alignment (material.ts).
// The reference frame is the overlay's: Document B's displayed page (or A's,
// for a sheet only A has). Each window has a map into it: B and the overlay
// the identity, A its alignment `place` (A displayed → B displayed).
import { IDENTITY, applyAffine, invertAffine, thenAffine, type Affine } from './material';

/** The three windows of the Review layout. */
export type WindowRole = 'overlay' | 'a' | 'b';

export const WINDOW_ROLES: readonly WindowRole[] = ['overlay', 'a', 'b'];

export interface Pt {
  x: number;
  y: number;
}

/**
 * A window's map into the overlay's frame: A through the sheet's alignment
 * when B has the sheet too, everything else as it is.
 */
export function toReference(role: WindowRole, place: Affine, paired: boolean): Affine {
  return role === 'a' && paired ? place : IDENTITY;
}

/** From one window's page to another's: `from` → reference → `to`. */
export const between = (fromRef: Affine, toRef: Affine): Affine =>
  thenAffine(fromRef, invertAffine(toRef));

/** The uniform scale of a similarity (√|det|); 1 for a degenerate map. */
export function scaleOf(m: Affine): number {
  const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  return k > 1e-9 && Number.isFinite(k) ? k : 1;
}

export const mapPoint = (m: Affine, p: Pt): Pt => {
  const [x, y] = applyAffine(m, p.x, p.y);
  return { x, y };
};

/**
 * Where a follower goes to show the leader's spot: the follower's page point
 * under its centre, and its zoom. A feature `k` times larger on the
 * follower's page is shown at `1/k` the zoom, so it is the same size on screen.
 */
export function followerView(
  toFollower: Affine,
  leaderCentre: Pt,
  leaderScale: number,
): { centre: Pt; scale: number } {
  return {
    centre: mapPoint(toFollower, leaderCentre),
    scale: leaderScale / scaleOf(toFollower),
  };
}

/** The zoom plugin floors levels to 0.001: equal within that and 0.2 %. */
export const sameScale = (a: number, b: number): boolean =>
  Math.abs(a - b) <= Math.max(0.0015, 0.002 * b);

/**
 * The scroll position that puts page point `p` under the centre of a
 * `vw` × `vh` window, given where the page's top-left corner sits in the
 * scroll content (`pageLeft`, `pageTop`, CSS px) and the zoom (CSS px per pt).
 */
export function scrollFor(
  p: Pt,
  scale: number,
  page: { left: number; top: number },
  view: { width: number; height: number },
): { left: number; top: number } {
  return {
    left: page.left + p.x * scale - view.width / 2,
    top: page.top + p.y * scale - view.height / 2,
  };
}

/** The page point under the centre of a window (the inverse of scrollFor). */
export function centreOf(
  scroll: { left: number; top: number },
  scale: number,
  page: { left: number; top: number },
  view: { width: number; height: number },
): Pt {
  return {
    x: (scroll.left + view.width / 2 - page.left) / scale,
    y: (scroll.top + view.height / 2 - page.top) / scale,
  };
}

/** The Review layout's splitters, as fractions (D-62: draggable, the windows never swap). */
export interface Splits {
  /** The overlay's share of the width. */
  x: number;
  /** Document A's share of the right column's height. */
  y: number;
}

export const DEFAULT_SPLITS: Splits = { x: 0.6, y: 0.5 };

/** Smallest window side (CSS px) a splitter leaves. */
export const MIN_WINDOW_PX = 160;

/**
 * A splitter's fraction kept so each side of `total` px is at least
 * MIN_WINDOW_PX (or half the space, when there is less than twice that).
 */
export function clampSplit(f: number, total: number): number {
  if (!Number.isFinite(f)) return 0.5;
  if (total <= 0) return Math.min(1, Math.max(0, f));
  const min = Math.min(0.5, MIN_WINDOW_PX / total);
  return Math.min(1 - min, Math.max(min, f));
}

/** A splitter moved by the keyboard: arrows 2 %, Home and End to the limits. */
export function splitForKey(key: string, f: number, total: number): number | null {
  const step = 0.02;
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowUp':
      return clampSplit(f - step, total);
    case 'ArrowRight':
    case 'ArrowDown':
      return clampSplit(f + step, total);
    case 'Home':
      return clampSplit(0, total);
    case 'End':
      return clampSplit(1, total);
    default:
      return null;
  }
}
