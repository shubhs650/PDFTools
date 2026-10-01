// M4-17 (ADR-017 decision 3): re-cutting paths that cross a redacted rectangle.
import { describe, expect, it } from 'vitest';
import {
  area,
  clipFill,
  clipStroke,
  cubicAt,
  cubicPiece,
  cubicRoots,
  flatten,
  outsideRanges,
  strokeReach,
  type Pt,
  type Rect,
  type Subpath,
} from '../../src/workers/work/redact/geometry';

const R: Rect = [40, 40, 60, 60];
const close = (a: Pt, b: Pt, eps = 1e-6) =>
  Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;
const inRect = (p: Pt, r: Rect) =>
  p[0] > r[0] + 1e-6 && p[0] < r[2] - 1e-6 && p[1] > r[1] + 1e-6 && p[1] < r[3] - 1e-6;

/** Samples every segment of the pieces: none may lie inside the rect. */
function samplesInside(pieces: Subpath[], r: Rect): number {
  let n = 0;
  for (const s of pieces) {
    let p = s.start;
    for (const g of s.segs) {
      for (let k = 0; k <= 50; k++) {
        const t = k / 50;
        const q: Pt =
          g.kind === 'line'
            ? [p[0] + (g.to[0] - p[0]) * t, p[1] + (g.to[1] - p[1]) * t]
            : cubicAt(p, g.c1, g.c2, g.to, t);
        if (inRect(q, r)) n++;
      }
      p = g.to;
    }
  }
  return n;
}

describe('cubic helpers', () => {
  it('finds the real roots in [0, 1]', () => {
    // (t − 0.2)(t − 0.5)(t − 0.9)
    const roots = cubicRoots(1, -1.6, 0.73, -0.09).sort();
    expect(roots.map((x) => x.toFixed(6))).toEqual(['0.200000', '0.500000', '0.900000']);
    expect(cubicRoots(0, 0, 2, -1)).toEqual([0.5]);
    expect(cubicRoots(0, 1, 0, 1)).toEqual([]);
  });

  it('cuts an exact piece of a cubic', () => {
    const p0: Pt = [0, 0];
    const c1: Pt = [10, 30];
    const c2: Pt = [40, 30];
    const p3: Pt = [50, 0];
    const piece = cubicPiece(p0, c1, c2, p3, 0.25, 0.75);
    for (const u of [0, 0.3, 0.5, 1]) {
      const onPiece = cubicAt(piece[0], piece[1], piece[2], piece[3], u);
      const onCurve = cubicAt(p0, c1, c2, p3, 0.25 + 0.5 * u);
      expect(close(onPiece, onCurve)).toBe(true);
    }
  });
});

describe('strokes', () => {
  it('a line through the rect keeps the two outside parts', () => {
    expect(outsideRanges([0, 50], { kind: 'line', to: [100, 50] }, [R])).toEqual([
      [0, 0.4],
      [0.6, 1],
    ]);
    const pieces = clipStroke(
      { start: [0, 50], segs: [{ kind: 'line', to: [100, 50] }], closed: false },
      [R],
    );
    expect(pieces.map((p) => [p.start, p.segs.map((s) => s.to)])).toEqual([
      [[0, 50], [[40, 50]]],
      [[60, 50], [[100, 50]]],
    ]);
  });

  it('a path that misses the rect is returned as it is', () => {
    const sub: Subpath = { start: [0, 0], segs: [{ kind: 'line', to: [10, 0] }], closed: false };
    expect(clipStroke(sub, [R])).toEqual([sub]);
  });

  it('a cubic through the rect is cut exactly, as sub-curves, nothing inside', () => {
    const sub: Subpath = {
      start: [0, 0],
      segs: [{ kind: 'cubic', c1: [20, 100], c2: [80, 100], to: [100, 0] }],
      closed: false,
    };
    const r: Rect = [40, 60, 60, 90];
    const pieces = clipStroke(sub, [r]);
    expect(pieces.length).toBe(2);
    expect(pieces.every((p) => p.segs.every((s) => s.kind === 'cubic'))).toBe(true);
    expect(samplesInside(pieces, r)).toBe(0);
    // The ends are untouched.
    expect(pieces[0]?.start).toEqual([0, 0]);
    expect(pieces[1]?.segs.at(-1)?.to).toEqual([100, 0]);
  });

  it('a closed outline cut once stays one open piece around the rest', () => {
    const square: Subpath = {
      start: [0, 0],
      segs: [
        { kind: 'line', to: [50, 0] },
        { kind: 'line', to: [50, 50] },
        { kind: 'line', to: [0, 50] },
      ],
      closed: true,
    };
    const pieces = clipStroke(square, [[40, -10, 60, 10]]);
    expect(pieces).toHaveLength(1);
    expect(samplesInside(pieces, [40, -10, 60, 10])).toBe(0);
  });

  it('stroke reach covers caps and joins', () => {
    expect(strokeReach(2, 0, 1)).toBeCloseTo(1.5);
    expect(strokeReach(2, 2, 1)).toBeCloseTo(Math.SQRT2 + 0.5);
    expect(strokeReach(2, 0, 0, 10)).toBeCloseTo(4.5);
  });
});

describe('fills', () => {
  const sq = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];

  it('a filled square minus a rect: the same area outside, nothing inside', () => {
    const groups = clipFill([sq(0, 0, 100, 100)], [R]);
    const total = groups.flat().reduce((a, p) => a + Math.abs(area(p)), 0);
    expect(total).toBeCloseTo(100 * 100 - 20 * 20);
    for (const g of groups) for (const p of g) for (const q of p) expect(inRect(q, R)).toBe(false);
  });

  it('a hole (even-odd / opposite winding) is kept in every region', () => {
    const outer = sq(0, 0, 100, 100);
    const hole = sq(10, 10, 30, 30).reverse();
    const groups = clipFill([outer, hole], [R]);
    // The region left of the rect has both the outer part and the hole.
    expect(groups.some((g) => g.length === 2)).toBe(true);
  });

  it('a fill far from the rect is untouched', () => {
    const p = sq(0, 0, 10, 10);
    expect(clipFill([p], [R])).toEqual([[p]]);
  });

  it('flattens curves within tolerance', () => {
    const sub: Subpath = {
      start: [0, 0],
      segs: [{ kind: 'cubic', c1: [0, 55.23], c2: [44.77, 100], to: [100, 100] }],
      closed: true,
    };
    const pts = flatten(sub, 0.05);
    expect(pts.length).toBeGreaterThan(20);
    expect(pts.at(-1)).toEqual([100, 100]);
  });
});
