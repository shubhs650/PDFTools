// O1 compare an area (ADR-031 D-60): the rectangles, their own alignment, the
// alignment refined on the line work inside them, and the region compared
// (B's rectangle and A's as placed). TDD on self-made point sets.
import { describe, expect, it } from 'vitest';
import {
  AREA_MIN_FEATURES,
  alignArea,
  areaRasterPlace,
  areaRasterSize,
  areaRegion,
  areaScale,
  clampBox,
  clipToBox,
  featuresIn,
  inRegion,
  maskRows,
  normBox,
  rectPlace,
  rectScale,
  regionBox,
  regionRows,
  rowSpan,
  type AreaPair,
} from '../../src/model/compare/area';
import { rng, simFrom, simToAffine } from '../../src/model/compare/align/similarity';
import { IDENTITY, applyAffine, type Affine } from '../../src/model/compare/material';

/** A detail: line ends and corners of a small drawing, `n` points in a w × h box at x, y. */
function detail(seed: number, n: number, w: number, h: number): number[] {
  const r = rng(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(r() * w, r() * h);
  return out;
}

const moved = (pts: readonly number[], m: Affine): number[] => {
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 2) out.push(...applyAffine(m, pts[i] ?? 0, pts[i + 1] ?? 0));
  return out;
};

/** Clutter round a sheet, away from `skip` boxes. */
function clutter(seed: number, n: number, skip: number[][]): number[] {
  const r = rng(seed);
  const out: number[] = [];
  while (out.length < 2 * n) {
    const x = r() * 1190;
    const y = r() * 842;
    if (skip.some(([x0 = 0, y0 = 0, x1 = 0, y1 = 0]) => x >= x0 && x <= x1 && y >= y0 && y <= y1))
      continue;
    out.push(x, y);
  }
  return out;
}

const errorOf = (place: Affine, truth: Affine, pts: readonly number[]): number => {
  let worst = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const [u, v] = applyAffine(place, pts[i] ?? 0, pts[i + 1] ?? 0);
    const [p, q] = applyAffine(truth, pts[i] ?? 0, pts[i + 1] ?? 0);
    worst = Math.max(worst, Math.hypot(u - p, v - q));
  }
  return worst;
};

describe('the rectangles', () => {
  it('are kept with left < right and top < bottom', () => {
    expect(normBox([50, 80, 10, 20])).toEqual([10, 20, 50, 80]);
  });

  it('are limited to the page, and a click is not an area', () => {
    expect(clampBox([-10, 5, 100, 900], 600, 800)).toEqual([0, 5, 100, 800]);
    expect(clampBox([10, 10, 13, 90], 600, 800)).toBeNull();
    expect(clampBox([700, 10, 900, 90], 600, 800)).toBeNull();
  });

  it('give one scale: 1 when about the same size, else from their sizes', () => {
    expect(rectScale({ a: [0, 0, 100, 100], b: [0, 0, 110, 105] })).toBe(1);
    const s = rectScale({ a: [0, 0, 200, 100], b: [0, 0, 200 / Math.SQRT2, 100 / Math.SQRT2] });
    expect(s).toBeCloseTo(1 / Math.SQRT2, 9);
  });

  it('align centre on centre by themselves', () => {
    const area: AreaPair = { a: [100, 100, 200, 160], b: [500, 300, 610, 355] };
    const [x, y] = applyAffine(rectPlace(area), 150, 130);
    expect(x).toBeCloseTo(555, 9);
    expect(y).toBeCloseTo(327.5, 9);
  });

  it('keep the feature points inside, in their own space', () => {
    expect([...featuresIn([5, 5, 15, 25, 30, 30], [10, 20, 20, 30])]).toEqual([5, 5]);
  });

  it('are drawn into rasters of their own, within the budget', () => {
    const area: AreaPair = { a: [100, 100, 300, 250], b: [0, 0, 200, 150] };
    expect(areaScale(area)).toBe(2);
    expect(areaRasterSize(area.a, 2)).toEqual({ width: 400, height: 300 });
    expect(applyAffine(areaRasterPlace(area.a), 100, 100)).toEqual([0, 0]);
    const huge: AreaPair = { a: [0, 0, 3000, 2000], b: [0, 0, 3000, 2000] };
    const s = areaScale(huge);
    const { width, height } = areaRasterSize(huge.a, s);
    expect(width * height).toBeLessThanOrEqual(4_000_000 + width + height + 1);
  });
});

describe('the areas’ alignment', () => {
  // A 120 × 80 pt detail at (150, 200) on A moved to (700, 450) on B.
  const shape = detail(7, 60, 120, 80);
  const onA = moved(shape, [1, 0, 0, 1, 150, 200]);

  it('finds a detail that moved, from rectangles drawn roughly round it', () => {
    const truth: Affine = [1, 0, 0, 1, 550, 250];
    const onB = moved(onA, truth);
    const featA = [...onA, ...clutter(1, 400, [[140, 190, 280, 290]])];
    const featB = [...onB, ...clutter(2, 400, [[690, 440, 830, 540]])];
    // Rectangles 4–12 pt larger than the detail, not the same way round it.
    const area: AreaPair = { a: [142, 194, 278, 288], b: [688, 438, 826, 540] };
    const al = alignArea(featA, featB, area, null);
    expect(al.status).toBe('auto');
    expect(al.method).toBe('vector');
    expect(errorOf(al.place, truth, onA)).toBeLessThan(0.5);
  });

  it('finds a detail drawn at another scale and slightly turned', () => {
    const truth = simToAffine(simFrom(1 / Math.SQRT2, 2, 0, 0));
    const at = (m: Affine): Affine => [m[0], m[1], m[2], m[3], m[4] + 600, m[5] + 300];
    const t = at(truth);
    const onB = moved(onA, t);
    const box = (pts: number[], pad: number): [number, number, number, number] => {
      const xs = pts.filter((_, i) => i % 2 === 0);
      const ys = pts.filter((_, i) => i % 2 === 1);
      return [
        Math.min(...xs) - pad,
        Math.min(...ys) - pad,
        Math.max(...xs) + pad,
        Math.max(...ys) + pad,
      ];
    };
    const area: AreaPair = { a: box(onA, 6), b: box(onB, 3) };
    const al = alignArea(onA, onB, area, null);
    expect(al.status).toBe('auto');
    expect(errorOf(al.place, t, onA)).toBeLessThan(0.5);
  });

  it('keeps the rectangles’ own alignment and asks for points with next to no line work', () => {
    const area: AreaPair = { a: [0, 0, 100, 100], b: [300, 300, 400, 400] };
    const few = detail(3, AREA_MIN_FEATURES - 2, 100, 100);
    const al = alignArea(few, moved(few, [1, 0, 0, 1, 300, 300]), area, null);
    expect(al.status).toBe('low');
    expect(al.place).toEqual(rectPlace(area));
  });

  it('says low confidence when the two areas hold different details', () => {
    const area: AreaPair = { a: [150, 200, 270, 280], b: [700, 450, 820, 530] };
    const other = moved(detail(99, 60, 120, 80), [1, 0, 0, 1, 700, 450]);
    const al = alignArea(onA, other, area, null);
    expect(al.status).toBe('low');
  });
});

describe('the region compared', () => {
  const area: AreaPair = { a: [100, 100, 200, 200], b: [400, 300, 500, 400] };

  it('is B’s rectangle when A’s lands on it exactly', () => {
    const place: Affine = [1, 0, 0, 1, 300, 200];
    expect(regionBox(areaRegion(area, place))).toEqual([400, 300, 500, 400]);
  });

  it('is the part both rectangles cover when they differ', () => {
    const place: Affine = [1, 0, 0, 1, 320, 180];
    expect(regionBox(areaRegion(area, place))).toEqual([420, 300, 500, 380]);
  });

  it('is empty when A’s rectangle lands elsewhere', () => {
    expect(areaRegion(area, IDENTITY)).toEqual([]);
    expect(regionBox([])).toBeNull();
  });

  it('follows a turned placement', () => {
    const turn = simToAffine(simFrom(1, 45, 0, 0));
    const [cx, cy] = applyAffine(turn, 150, 150);
    const place: Affine = [turn[0], turn[1], turn[2], turn[3], 450 - cx, 350 - cy];
    const poly = areaRegion(area, place);
    // A diamond of half-diagonal 70.7 pt in a 100 pt square: eight corners.
    expect(poly.length).toBe(16);
    expect(inRegion(poly, 450, 350)).toBe(true);
    expect(inRegion(poly, 402, 302)).toBe(false);
    expect(inRegion(poly, 450, 302)).toBe(true);
  });

  it('cuts a polygon to a rectangle', () => {
    expect(clipToBox([0, 0, 10, 0, 10, 10, 0, 10], [5, -5, 20, 5])).toEqual([
      5, 0, 10, 0, 10, 5, 5, 5,
    ]);
  });

  it('gives each row its span', () => {
    const square = [0, 0, 10, 0, 10, 10, 0, 10];
    expect(rowSpan(square, 5)).toEqual([0, 10]);
    expect(rowSpan(square, 11)).toBeNull();
  });

  it('leaves only the region’s ink in a band', () => {
    // 72 dpi: one pixel per pt; the region is x 2…5, y 1…3.
    const poly = [2, 1, 5, 1, 5, 3, 2, 3];
    const width = 8;
    const data = new Uint8Array(width * 4).fill(255);
    maskRows(data, width, 0, 4, 72, poly);
    const rows = [...Array(4).keys()].map((r) =>
      [...data.subarray(r * width, (r + 1) * width)].map((v) => (v ? 1 : 0)).join(''),
    );
    expect(rows).toEqual(['00000000', '00111000', '00111000', '00000000']);
    expect(regionRows(poly, 72, 4)).toEqual([0, 4]);
    expect(regionRows(poly, 72 * 10, 1000)).toEqual([9, 31]);
  });
});
