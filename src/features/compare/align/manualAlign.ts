// Manual alignment of a sheet (M12-13, D-60, Q7, Q8): the state of the
// alignment being set — the point pairs picked in Document A's and Document
// B's windows, the placement they give (shown on the overlay at once), the
// fine-tune values and nudges — and Apply to this sheet, all sheets or all
// low-confidence sheets, which hands the placement to the comparison's
// session. Pure transitions on the overlay view, plus `applyManual` and
// `useAutomatic`, which talk to the session.
import type { Affine } from '../../../model/compare/material';
import {
  MAX_PAIRS,
  nudged,
  placeFromPoints,
  type PointPair,
  type Pt,
} from '../../../model/compare/align/manual';
import { pairingSession } from '../pairingFlow';
import {
  dropAligned,
  overlayView,
  placeOf,
  setAligned,
  updateView,
  type OverlayView,
  type Sheet,
} from '../overlay/overlayState';

/** Which sheets Apply sets (Q7). */
export type ApplyTo = 'sheet' | 'all' | 'low';

/** A pair being picked: a spot on A, on B, or both. */
export interface PickedPair {
  a: Pt | null;
  b: Pt | null;
}

export interface ManualAlign {
  /** The sheet's index in the session's compared pairs. */
  pair: number;
  /** The placement in use when the alignment started (one point pair shifts it). */
  base: Affine;
  /** Up to three pairs; the last one may still miss a side. */
  points: PickedPair[];
  /** Clicks in Document A's and Document B's windows pick points. */
  picking: boolean;
  /** The placement being set, shown on the overlay. */
  place: Affine;
  /** Why the points give no placement, or null. */
  problem: { reason: 'tooClose'; side: 'a' | 'b' } | { reason: 'scale' } | null;
  applyTo: ApplyTo;
}

/** The pairs picked on both sides. */
export const completePairs = (m: ManualAlign): PointPair[] =>
  m.points.flatMap((p) => (p.a && p.b ? [{ a: p.a, b: p.b }] : []));

/** The side the next click picks: the missing side of a pair begun, else a new pair's A; null when full. */
export function nextSide(m: ManualAlign): 'a' | 'b' | null {
  const last = m.points.at(-1);
  if (last && !last.a) return 'a';
  if (last && !last.b) return 'b';
  return m.points.length >= MAX_PAIRS ? null : 'a';
}

/** Starts aligning the sheet by hand, picking points in Review (where A and B are shown). */
export function startManual(v: OverlayView, sheet: Sheet, picking = true): OverlayView {
  if (sheet.pair === null) return v;
  const base = placeOf(v, sheet);
  return {
    ...v,
    layout: picking ? 'review' : v.layout,
    manual: {
      pair: sheet.pair,
      base,
      points: [],
      picking,
      place: base,
      problem: null,
      applyTo: 'sheet',
    },
  };
}

/** The placement from the points picked, when they give one. */
function refit(m: ManualAlign): ManualAlign {
  const fit = placeFromPoints(completePairs(m), m.base);
  if (!fit) return { ...m, place: m.base, problem: null };
  if (!fit.ok)
    return {
      ...m,
      problem:
        fit.reason === 'tooClose' ? { reason: 'tooClose', side: fit.side } : { reason: 'scale' },
    };
  return { ...m, place: fit.place, problem: null };
}

const withManual = (v: OverlayView, fn: (m: ManualAlign) => ManualAlign): OverlayView =>
  v.manual ? { ...v, manual: fn(v.manual) } : v;

/**
 * A point picked on `side` (displayed space): it completes the pair begun on
 * the other side, or begins a new one (up to three). Picking stops once the
 * third pair is complete.
 */
export const pickPoint = (v: OverlayView, side: 'a' | 'b', p: Pt): OverlayView =>
  withManual(v, (m) => {
    if (!m.picking) return m;
    const points = [...m.points];
    const last = points.at(-1);
    // A pair begun gets this side (a second click on the same side moves its point), else a new pair.
    if (last && !(last.a && last.b)) points[points.length - 1] = { ...last, [side]: p };
    else if (points.length < MAX_PAIRS)
      points.push({ a: side === 'a' ? p : null, b: side === 'b' ? p : null });
    else return m;
    const full = points.length === MAX_PAIRS && points.every((q) => q.a && q.b);
    return refit({ ...m, points, picking: !full });
  });

/** Removes a pair (its markers go; the placement follows the pairs left). */
export const removePair = (v: OverlayView, index: number): OverlayView =>
  withManual(v, (m) => refit({ ...m, points: m.points.filter((_, i) => i !== index) }));

export const setPicking = (v: OverlayView, on: boolean): OverlayView =>
  withManual(v, (m) => (m.picking === on ? m : { ...m, picking: on }));

/** A placement from the fine-tune values (the points stay, their error follows). */
export const setManualPlace = (v: OverlayView, place: Affine): OverlayView =>
  withManual(v, (m) => ({ ...m, place, problem: null }));

/** An arrow-key nudge of Document A on the sheet (pt). */
export const nudgeManual = (v: OverlayView, dx: number, dy: number): OverlayView =>
  withManual(v, (m) => ({ ...m, place: nudged(m.place, dx, dy), problem: null }));

export const setApplyTo = (v: OverlayView, applyTo: ApplyTo): OverlayView =>
  withManual(v, (m) => ({ ...m, applyTo }));

/** Leaves without applying: the overlay goes back to the placement in use. */
export const cancelManual = (v: OverlayView): OverlayView =>
  v.manual ? { ...v, manual: null } : v;

/** The pairs Apply sets: this sheet, every compared sheet, or the low-confidence ones and this. */
export function applyTargets(v: OverlayView, m: ManualAlign, pairs: number): number[] {
  const all = [...Array(pairs).keys()];
  if (m.applyTo === 'all') return all;
  if (m.applyTo === 'low') return all.filter((i) => i === m.pair || v.aligned[i]?.status === 'low');
  return [m.pair];
}

/** Applies the placement being set to its sheets (the session analyses them again). */
export function applyManual(id: string, pairs: number): void {
  const v = overlayView(id);
  const session = pairingSession(id);
  if (!v.manual || !session) return;
  const { place } = v.manual;
  for (const i of applyTargets(v, v.manual, pairs)) session.setManual(i, place);
  // The session's watchers have set the sheets' alignments by now.
  updateView(id, cancelManual);
}

/** Back to the automatic alignment for a sheet set by hand. */
export function backToAutomatic(id: string, pair: number): void {
  const session = pairingSession(id);
  if (!session) return;
  session.setManual(pair, null);
  const al = session.alignment(pair);
  updateView(id, (v) => (al ? setAligned(v, pair, al) : dropAligned(v, pair)));
}
