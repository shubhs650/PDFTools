// Compare an area (M12 optional item O1, ADR-031 D-60): a rectangle on a page
// of Document A and one on a page of Document B — a detail that moved to
// another place on the sheet, or to another sheet — overlaid through an
// alignment of their own. Pure maths, unit-tested; the alignment runs in the
// Compare worker, the masks there too (rule 1).
//
//   rectangles  each in its page's displayed space (pt, y down), as drawn
//   start       the rectangles' own alignment: centre on centre, one scale
//               from their sizes (1 when they are within 15 % of each other:
//               a detail drawn round twice is never drawn to the same size)
//   vector      A's feature points inside A's rectangle against B's inside
//               B's, from the start and from the coarse Fourier–Mellin step
//               on the two areas' rasters, refined as a sheet is (S28)
//   image       an area without line work (a scan): the image method on the
//               two areas' rasters
//   region      what is compared: B's rectangle and A's rectangle as placed,
//               both — so nothing outside either rectangle is reported
import {
  COARSE_CANVAS,
  LOW_SHARE,
  agreement,
  alignImage,
  coarseAlign,
  refineVector,
  type SheetAlignment,
} from './align/aligner';
import { resample, type Ink } from './align/ink';
import { PointGrid } from './align/pointGrid';
import { affineToSim, simToAffine, thenSim, type Sim } from './align/similarity';
import { applyAffine, type Affine } from './material';

/** A rectangle in a page's displayed space (pt, y down): left, top, right, bottom. */
export type AreaBox = [number, number, number, number];

/** The two rectangles of an area comparison. */
export interface AreaPair {
  /** On Document A's page. */
  a: AreaBox;
  /** On Document B's page. */
  b: AreaBox;
}

/** The smallest side (pt) of a rectangle that can be compared (a click is not an area). */
export const MIN_AREA_SIDE = 6;
/** Rectangle sizes this close are taken as the same scale. */
export const SAME_SCALE = 0.15;
/** Fewer feature points than this in either area: the image method. */
export const AREA_MIN_FEATURES = 8;
/** The areas' rasters stay under this many pixels each. */
export const AREA_MAX_PIXELS = 4_000_000;
/** px per pt of the areas' rasters at most (the image method's finest step). */
export const AREA_MAX_SCALE = 2;

/** Left < right and top < bottom. */
export function normBox(b: readonly number[]): AreaBox {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = b;
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}

/** The rectangle limited to a page of `width` × `height` pt, or null when too little is left. */
export function clampBox(b: AreaBox, width: number, height: number): AreaBox | null {
  const n = normBox(b);
  const out: AreaBox = [
    Math.max(0, n[0]),
    Math.max(0, n[1]),
    Math.min(width, n[2]),
    Math.min(height, n[3]),
  ];
  return out[2] - out[0] >= MIN_AREA_SIDE && out[3] - out[1] >= MIN_AREA_SIDE ? out : null;
}

const boxW = (b: AreaBox): number => b[2] - b[0];
const boxH = (b: AreaBox): number => b[3] - b[1];

/** The scale the rectangles' sizes suggest (1 when they are about the same size). */
export function rectScale(area: AreaPair): number {
  const s = Math.sqrt((boxW(area.b) * boxH(area.b)) / Math.max(1e-9, boxW(area.a) * boxH(area.a)));
  return Math.abs(s - 1) <= SAME_SCALE ? 1 : s;
}

/** A rectangle's own space: its top left corner at 0, 0. */
const shift = (x: number, y: number): Sim => ({ a: 1, b: 0, tx: x, ty: y });

/** A similarity between the two areas' own spaces as one between the pages. */
export function pageSim(area: AreaPair, local: Sim): Sim {
  return thenSim(thenSim(shift(-area.a[0], -area.a[1]), local), shift(area.b[0], area.b[1]));
}

/** The rectangles' own alignment, in the areas' spaces: centre on centre, one scale. */
function rectLocal(area: AreaPair): Sim {
  const s = rectScale(area);
  return {
    a: s,
    b: 0,
    tx: boxW(area.b) / 2 - (s * boxW(area.a)) / 2,
    ty: boxH(area.b) / 2 - (s * boxH(area.a)) / 2,
  };
}

/** The rectangles' own alignment: A's page → B's page (D-60's similarity, no rotation). */
export function rectPlace(area: AreaPair): Affine {
  return simToAffine(pageSim(area, rectLocal(area)));
}

/** Feature points (x, y pairs) inside a rectangle, moved into its own space. */
export function featuresIn(feat: ArrayLike<number>, box: AreaBox): Float64Array {
  const out: number[] = [];
  for (let i = 0; i + 1 < feat.length; i += 2) {
    const x = feat[i] ?? 0;
    const y = feat[i + 1] ?? 0;
    if (x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]) out.push(x - box[0], y - box[1]);
  }
  return Float64Array.from(out);
}

/** The scale (px per pt) of an area's raster: as fine as the image method uses, within the budget. */
export function areaScale(area: AreaPair): number {
  const big = Math.max(boxW(area.a) * boxH(area.a), boxW(area.b) * boxH(area.b), 1);
  return Math.min(AREA_MAX_SCALE, Math.sqrt(AREA_MAX_PIXELS / big));
}

/** An area's raster size at `scale` px per pt. */
export function areaRasterSize(box: AreaBox, scale: number): { width: number; height: number } {
  return {
    width: Math.max(1, Math.ceil(boxW(box) * scale)),
    height: Math.max(1, Math.ceil(boxH(box) * scale)),
  };
}

/** Where a page is drawn so that a rectangle of it lands in its own raster (page pt → raster pt). */
export const areaRasterPlace = (box: AreaBox): Affine => [1, 0, 0, 1, -box[0], -box[1]];

export interface AreaRasters {
  /** Both areas' ink at `scale` px per pt, each in its rectangle's own space. */
  a: Ink;
  b: Ink;
  scale: number;
}

/**
 * The areas' alignment (O1): A's page → B's page. From the rectangles, then
 * refined on the line work inside them (or by the image method on a scan);
 * low confidence keeps the rectangles' own alignment and asks for points, as
 * a sheet does (M12-13 works on an area as on any sheet).
 */
export function alignArea(
  featA: ArrayLike<number>,
  featB: ArrayLike<number>,
  area: AreaPair,
  rasters: AreaRasters | null,
  checkpoint: () => void = () => undefined,
): SheetAlignment {
  const start = rectLocal(area);
  const la = featuresIn(featA, area.a);
  const lb = featuresIn(featB, area.b);
  const result = (
    status: SheetAlignment['status'],
    method: SheetAlignment['method'],
    sim: Sim,
    score: number,
  ): SheetAlignment => ({
    status,
    method,
    place: simToAffine(pageSim(area, sim)),
    score,
  });
  if (la.length / 2 >= AREA_MIN_FEATURES && lb.length / 2 >= AREA_MIN_FEATURES) {
    const grid = new PointGrid(lb, 4);
    const side = Math.min(boxW(area.a), boxH(area.a), boxW(area.b), boxH(area.b));
    let best = refineVector(la, lb, start, Math.max(8, side / 4), 0.5, grid);
    if (best.inlierShare < LOW_SHARE && rasters) {
      // The coarse step on the areas' own rasters: any shift, scale or turn.
      const s =
        ((0.9 * COARSE_CANVAS) / Math.max(rasters.a.w, rasters.a.h, rasters.b.w, rasters.b.h)) *
        rasters.scale;
      const coarse = {
        a: resample(rasters.a, rasters.scale, s),
        b: resample(rasters.b, rasters.scale, s),
        scale: s,
      };
      for (const around of [0, 90] as const) {
        checkpoint();
        const c = coarseAlign(coarse, { n: COARSE_CANVAS, around });
        checkpoint();
        const r = refineVector(la, lb, c.sim, Math.max(8, 3 * c.ptPerPx), 0.5, grid);
        if (r.inlierShare > best.inlierShare) best = r;
        if (best.inlierShare >= LOW_SHARE) break;
      }
    }
    const still = agreement(la, grid, start, 0.5);
    if (best.inlierShare >= LOW_SHARE && best.inlierShare > still)
      return result('auto', 'vector', best.sim, best.inlierShare);
    return result(still >= LOW_SHARE ? 'auto' : 'low', 'vector', start, still);
  }
  if (rasters) {
    checkpoint();
    const al = alignImage(rasters.a, rasters.b, rasters.scale, checkpoint);
    // Found by the image method (as is in the areas' own spaces is a result too: the
    // rectangles were drawn the same way round the detail).
    if (al.status !== 'low' && al.score > 0)
      return result('auto', 'image', affineToSim(al.place), al.score);
  }
  return result('low', rasters ? 'image' : 'vector', start, 0);
}

// ------------------------------------------------------------ the region ---

/** A's rectangle as placed in B's page: four corners (x, y pairs). */
export function placedQuad(area: AreaPair, place: Affine): number[] {
  const [x0, y0, x1, y1] = area.a;
  const out: number[] = [];
  for (const [x, y] of [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ] as const)
    out.push(...applyAffine(place, x, y));
  return out;
}

/** A polygon (x, y pairs) cut to a rectangle (Sutherland–Hodgman). */
export function clipToBox(poly: readonly number[], box: AreaBox): number[] {
  let pts = poly.slice();
  const edges: [(x: number, y: number) => number][] = [
    [(x) => x - box[0]],
    [(x) => box[2] - x],
    [(_x, y) => y - box[1]],
    [(_x, y) => box[3] - y],
  ];
  for (const [inside] of edges) {
    const out: number[] = [];
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const px = pts[2 * i] ?? 0;
      const py = pts[2 * i + 1] ?? 0;
      const j = (i + 1) % n;
      const qx = pts[2 * j] ?? 0;
      const qy = pts[2 * j + 1] ?? 0;
      const dp = inside(px, py);
      const dq = inside(qx, qy);
      if (dp >= 0) out.push(px, py);
      if (dp >= 0 !== dq >= 0) {
        const t = dp / (dp - dq);
        out.push(px + t * (qx - px), py + t * (qy - py));
      }
    }
    pts = out;
    if (pts.length < 6) return [];
  }
  return pts;
}

/**
 * What an area comparison compares, in B's page (pt): B's rectangle and A's
 * rectangle as placed, both. Empty when they do not meet (the alignment put
 * A's detail somewhere else).
 */
export function areaRegion(area: AreaPair, place: Affine): number[] {
  return clipToBox(placedQuad(area, place), area.b);
}

/** The box round a polygon, or null for an empty one. */
export function regionBox(poly: readonly number[]): AreaBox | null {
  if (poly.length < 6) return null;
  const xs = poly.filter((_, i) => i % 2 === 0);
  const ys = poly.filter((_, i) => i % 2 === 1);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Where a row (y, pt) crosses a convex polygon: [left, right], or null. */
export function rowSpan(poly: readonly number[], y: number): [number, number] | null {
  const n = poly.length / 2;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const px = poly[2 * i] ?? 0;
    const py = poly[2 * i + 1] ?? 0;
    const j = (i + 1) % n;
    const qx = poly[2 * j] ?? 0;
    const qy = poly[2 * j + 1] ?? 0;
    if ((py <= y && qy >= y) || (qy <= y && py >= y)) {
      if (py === qy) {
        lo = Math.min(lo, px, qx);
        hi = Math.max(hi, px, qx);
      } else {
        const x = px + ((y - py) / (qy - py)) * (qx - px);
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

/** Whether a point is inside a convex polygon (on its edge counts). */
export function inRegion(poly: readonly number[], x: number, y: number): boolean {
  const span = rowSpan(poly, y);
  return !!span && x >= span[0] - 1e-9 && x <= span[1] + 1e-9;
}

/**
 * Leaves only the region's ink in rows of a frame raster at `dpi` (each pixel
 * by its centre): what is outside is paper. `top` is the band's first row.
 */
export function maskRows(
  data: Uint8Array,
  width: number,
  top: number,
  rows: number,
  dpi: number,
  poly: readonly number[],
): void {
  const k = 72 / dpi;
  for (let r = 0; r < rows; r++) {
    const span = rowSpan(poly, (top + r + 0.5) * k);
    const off = r * width;
    if (!span) {
      data.fill(0, off, off + width);
      continue;
    }
    // Pixel x is inside when its centre (x + 0.5) k is within the span.
    const from = Math.max(0, Math.min(width, Math.ceil(span[0] / k - 0.5)));
    const to = Math.max(from, Math.min(width, Math.floor(span[1] / k - 0.5) + 1));
    data.fill(0, off, off + from);
    data.fill(0, off + to, off + width);
  }
}

/** The raster rows (at `dpi`) a region touches: [first, end). */
export function regionRows(poly: readonly number[], dpi: number, height: number): [number, number] {
  const box = regionBox(poly);
  if (!box) return [0, 0];
  const k = dpi / 72;
  return [
    Math.max(0, Math.min(height, Math.floor(box[1] * k - 0.5))),
    Math.max(0, Math.min(height, Math.ceil(box[3] * k + 0.5))),
  ];
}
