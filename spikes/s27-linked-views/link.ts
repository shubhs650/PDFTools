// Spike S27 (M12-02): the transform that links one view to another. Pure.
//
// Points are EmbedPDF page coordinates (points, top-left origin, the page as
// it is without the view's rotation), the frame of every annotation rect.
// An Affine maps x' = a·x + c·y + e, y' = b·x + d·y + f (the PDF convention).

export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface Pt {
  x: number;
  y: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** `second ∘ first`: first applied, then second. */
export function compose(second: Affine, first: Affine): Affine {
  return {
    a: second.a * first.a + second.c * first.b,
    b: second.b * first.a + second.d * first.b,
    c: second.a * first.c + second.c * first.d,
    d: second.b * first.c + second.d * first.d,
    e: second.a * first.e + second.c * first.f + second.e,
    f: second.b * first.e + second.d * first.f + second.f,
  };
}

export function invert(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-12) throw new Error('singular transform');
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

export function apply(m: Affine, p: Pt): Pt {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/** The uniform scale of a similarity (√|det|). */
export function scaleOf(m: Affine): number {
  return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
}

/** A similarity in PDF user space (origin bottom-left): k·R(deg)·p + (tx, ty). */
export function similarity(k: number, deg: number, tx: number, ty: number): Affine {
  const r = (deg * Math.PI) / 180;
  return {
    a: k * Math.cos(r),
    b: k * Math.sin(r),
    c: -k * Math.sin(r),
    d: k * Math.cos(r),
    e: tx,
    f: ty,
  };
}

/** User space → top-left page coordinates of a page `h` points tall: y flips. */
const flip = (h: number): Affine => ({ a: 1, b: 0, c: 0, d: -1, e: 0, f: h });

/**
 * A user-space transform from a page `hFrom` tall to a page `hTo` tall, as a
 * map between top-left page coordinates (what the view and comments use).
 */
export function toPageCoords(user: Affine, hFrom: number, hTo: number): Affine {
  return compose(flip(hTo), compose(user, flip(hFrom)));
}

/**
 * Where a follower view goes so it shows the leader's spot: the follower's
 * page point under its centre and its zoom. `toFollower` maps leader page
 * points to follower page points; a feature `k` times larger on the follower
 * page is shown `1/k` the zoom, so both appear the same size on screen.
 */
export function followerView(
  toFollower: Affine,
  leaderCentre: Pt,
  leaderScale: number,
): { centre: Pt; scale: number } {
  return {
    centre: apply(toFollower, leaderCentre),
    scale: leaderScale / scaleOf(toFollower),
  };
}
