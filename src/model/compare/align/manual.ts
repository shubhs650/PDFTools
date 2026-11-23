// Manual alignment (M12-13, D-60, Q7, Q8): a sheet's placement from 1 to 3
// point pairs, its fine-tuning by values and nudges, and how far the picked
// points are from where the placement puts them. Pure maths, unit-tested; the
// alignment window (features/compare/align) only calls it.
//
// Every point is in a page's **displayed space** (points, origin top left,
// y down, /Rotate and the CropBox applied), like the automatic alignment
// (M12-10): a pair is a spot on Document A's page and the same spot on
// Document B's. The placement maps A's displayed page → B's.
import { applyAffine, invertAffine, thenAffine, type Affine } from '../material';
import { affineToSim, fitSim, simFrom, simToAffine } from './similarity';

export interface Pt {
  x: number;
  y: number;
}

/** A spot picked on Document A and the same spot on Document B. */
export interface PointPair {
  a: Pt;
  b: Pt;
}

/** At most three pairs (Q8): one fixes the shift, two the scale and rotation, three a best fit. */
export const MAX_PAIRS = 3;

/**
 * Two points closer than this (pt) on either page cannot fix a scale or a
 * rotation: a pixel's error between them would turn the sheet by degrees.
 */
export const MIN_SPAN = 20;

/** Arrow keys move Document A by this much (pt); with Shift, by NUDGE_LARGE. */
export const NUDGE_STEP = 0.1;
export const NUDGE_LARGE = 1;

/** Scales outside this range are not a plot of the same drawing (the aligner's own limits). */
export const SCALE_RANGE: readonly [number, number] = [0.05, 20];

export type PointFit =
  | { ok: true; place: Affine }
  /** Two points of a pair set too close together; `side` says on which page. */
  | { ok: false; reason: 'tooClose'; side: 'a' | 'b' }
  /** The points would scale the sheet beyond SCALE_RANGE (a pair mixed up). */
  | { ok: false; reason: 'scale' };

/**
 * The placement from 1 to 3 point pairs (D-60): one pair shifts `base` (the
 * placement in use) so that pair's spots meet, keeping its scale and rotation;
 * two pairs give the shift, one scale and the rotation exactly; three give the
 * least-squares best fit (the residuals are the error shown). Never an uneven
 * stretch. Null without a pair.
 */
export function placeFromPoints(pairs: readonly PointPair[], base: Affine): PointFit | null {
  const used = pairs.slice(0, MAX_PAIRS);
  const first = used[0];
  if (!first) return null;
  if (used.length === 1) {
    const [x, y] = applyAffine(base, first.a.x, first.a.y);
    return {
      ok: true,
      place: [base[0], base[1], base[2], base[3], base[4] + first.b.x - x, base[5] + first.b.y - y],
    };
  }
  for (const side of ['a', 'b'] as const)
    for (let i = 0; i < used.length; i++)
      for (let j = i + 1; j < used.length; j++) {
        const p = used[i]?.[side];
        const q = used[j]?.[side];
        if (p && q && Math.hypot(p.x - q.x, p.y - q.y) < MIN_SPAN)
          return { ok: false, reason: 'tooClose', side };
      }
  const src = used.flatMap((p) => [p.a.x, p.a.y]);
  const dst = used.flatMap((p) => [p.b.x, p.b.y]);
  const sim = fitSim(src, dst);
  if (!sim) return { ok: false, reason: 'tooClose', side: 'a' };
  const k = Math.hypot(sim.a, sim.b);
  if (!(k >= SCALE_RANGE[0] && k <= SCALE_RANGE[1])) return { ok: false, reason: 'scale' };
  return { ok: true, place: simToAffine(sim) };
}

/** How far each pair's B spot is from where `place` puts its A spot (pt), with the RMS and the largest. */
export function pointError(
  pairs: readonly PointPair[],
  place: Affine,
): { each: number[]; rms: number; max: number } {
  const each = pairs.map((p) => {
    const [x, y] = applyAffine(place, p.a.x, p.a.y);
    return Math.hypot(x - p.b.x, y - p.b.y);
  });
  const max = each.reduce((m, d) => Math.max(m, d), 0);
  const rms = each.length ? Math.sqrt(each.reduce((s, d) => s + d * d, 0) / each.length) : 0;
  return { each, rms, max };
}

/** The values a placement is fine-tuned by: the shift (pt), one scale (1 = 100 %) and the rotation (°). */
export interface PlaceValues {
  dx: number;
  dy: number;
  scale: number;
  deg: number;
}

export function placeValues(place: Affine): PlaceValues {
  const s = affineToSim(place);
  return {
    dx: s.tx,
    dy: s.ty,
    scale: Math.hypot(s.a, s.b),
    deg: (Math.atan2(s.b, s.a) * 180) / Math.PI,
  };
}

/**
 * The placement with one value changed (numeric fine-tune). A new shift is
 * taken as it is; a new scale or rotation turns and scales Document A about
 * `pivot` (a spot on B's page, the sheet's centre): the drawing there stays
 * where it is, so a tenth of a degree does not throw the far corner off.
 * Null for a value that is no placement (a scale of zero or less).
 */
export function withValue(
  place: Affine,
  key: keyof PlaceValues,
  value: number,
  pivot: Pt,
): Affine | null {
  if (!Number.isFinite(value)) return null;
  const v = placeValues(place);
  if (key === 'dx' || key === 'dy') {
    const s = simFrom(v.scale, v.deg, key === 'dx' ? value : v.dx, key === 'dy' ? value : v.dy);
    return simToAffine(s);
  }
  if (key === 'scale' && !(value >= SCALE_RANGE[0] && value <= SCALE_RANGE[1])) return null;
  // The spot of A that lands on the pivot now, then the new linear part, then the shift that keeps it there.
  const [ax, ay] = applyAffine(invertAffine(place), pivot.x, pivot.y);
  const lin = simFrom(key === 'scale' ? value : v.scale, key === 'deg' ? value : v.deg, 0, 0);
  const tx = pivot.x - (lin.a * ax - lin.b * ay);
  const ty = pivot.y - (lin.b * ax + lin.a * ay);
  return simToAffine({ ...lin, tx, ty });
}

/** The placement moved by (dx, dy) pt on B's page (an arrow-key nudge). */
export const nudged = (place: Affine, dx: number, dy: number): Affine =>
  thenAffine(place, [1, 0, 0, 1, dx, dy]);

/** The nudge an arrow key asks for (Shift: larger), or null for any other key. */
export function nudgeForKey(key: string, large: boolean): { dx: number; dy: number } | null {
  const d = large ? NUDGE_LARGE : NUDGE_STEP;
  switch (key) {
    case 'ArrowLeft':
      return { dx: -d, dy: 0 };
    case 'ArrowRight':
      return { dx: d, dy: 0 };
    case 'ArrowUp':
      return { dx: 0, dy: -d };
    case 'ArrowDown':
      return { dx: 0, dy: d };
    default:
      return null;
  }
}

/**
 * A page point as the viewer lays the page out (EmbedPDF: points, top left,
 * the page unturned, `width` × `height`) → its displayed space, for a page
 * shown turned by `turns` clockwise quarter turns.
 */
export function laidToDisplayed(turns: number, width: number, height: number, p: Pt): Pt {
  switch (turns & 3) {
    case 1:
      return { x: height - p.y, y: p.x };
    case 2:
      return { x: width - p.x, y: height - p.y };
    case 3:
      return { x: p.y, y: width - p.x };
    default:
      return { x: p.x, y: p.y };
  }
}

/** The inverse of laidToDisplayed. */
export function displayedToLaid(turns: number, width: number, height: number, p: Pt): Pt {
  switch (turns & 3) {
    case 1:
      return { x: p.y, y: height - p.x };
    case 2:
      return { x: width - p.x, y: height - p.y };
    case 3:
      return { x: width - p.y, y: p.x };
    default:
      return { x: p.x, y: p.y };
  }
}
