import { describe, expect, it } from 'vitest';
import {
  apply,
  buildGrid,
  candidates,
  concat,
  flattenCubic,
  indexBytes,
  intersect,
  snap,
  thin,
  type SnapKind,
} from '../../src/model/snapIndex';

// M3-18 (ADR-008): the S7 snap-core tests, ported, plus snap-mode filtering
// and the dense-page thinning.
const segs = (...xs: number[][]): Float32Array => new Float32Array(xs.flat());

describe('matrices', () => {
  it('apply and concat follow the PDF row-vector convention', () => {
    const scale = [2, 0, 0, 2, 0, 0];
    const move = [1, 0, 0, 1, 10, 20];
    // Scale first, then translate.
    expect(apply(concat(scale, move), 1, 1)).toEqual([12, 22]);
    // Translate first, then scale.
    expect(apply(concat(move, scale), 1, 1)).toEqual([22, 42]);
    const rot90 = [0, 1, -1, 0, 0, 0];
    const [x, y] = apply(rot90, 1, 0);
    expect(x).toBeCloseTo(0, 12);
    expect(y).toBeCloseTo(1, 12);
  });
});

describe('flattenCubic', () => {
  it('approximates a quarter circle within tolerance and ends exactly on p3', () => {
    const k = 0.5523 * 100;
    const pts = flattenCubic([100, 0], [100, k], [k, 100], [0, 100], 0.25);
    expect(pts[pts.length - 1]).toEqual([0, 100]);
    for (const [x, y] of pts) expect(Math.abs(Math.hypot(x, y) - 100)).toBeLessThan(0.3);
    expect(pts.length).toBeGreaterThan(4);
  });
  it('a straight cubic is one piece', () => {
    expect(flattenCubic([0, 0], [1, 0], [2, 0], [3, 0])).toEqual([[3, 0]]);
  });
});

describe('intersect', () => {
  it('crossing, touching, parallel and disjoint segments', () => {
    const s = segs(
      [0, 0, 10, 10],
      [0, 10, 10, 0],
      [20, 0, 30, 0],
      [20, 1, 30, 1],
      [10, 10, 20, 10],
    );
    expect(intersect(s, 0, 1)).toEqual([5, 5]);
    expect(intersect(s, 2, 3)).toBeNull(); // parallel
    expect(intersect(s, 0, 4)).toEqual([10, 10]); // touching at an end
    expect(intersect(s, 1, 2)).toBeNull(); // disjoint
  });
});

describe('grid + snap', () => {
  // A 100 × 50 rectangle with a diagonal, plus far-away clutter.
  const clutter = Array.from({ length: 500 }, (_, i) => [1000 + i, 1000, 1000 + i, 1010]);
  const g = buildGrid(
    segs(
      [0, 0, 100, 0],
      [100, 0, 100, 50],
      [100, 50, 0, 50],
      [0, 50, 0, 0],
      [0, 0, 100, 50],
      ...clutter,
    ),
  );

  it('index finds only nearby segments', () => {
    const c = candidates(g, 50, 0, 2);
    expect(c).toContain(0);
    expect(c.every((i) => i < 5)).toBe(true);
  });

  it('endpoint beats closer lower-priority candidates', () => {
    const s = snap(g, 101, 1, 5);
    expect(s).toMatchObject({ kind: 'endpoint', x: 100, y: 0 });
  });

  it('midpoint when no endpoint or intersection is in range', () => {
    expect(snap(g, 50, 3, 4)).toMatchObject({ kind: 'midpoint', x: 50, y: 0 });
  });

  it('intersection of the diagonal with a new crossing line', () => {
    const g2 = buildGrid(segs([0, 0, 100, 50], [0, 50, 100, 0]));
    expect(snap(g2, 51, 26, 5)).toMatchObject({ kind: 'intersection', x: 50, y: 25 });
  });

  it('nearest-on-segment when only an edge is close', () => {
    const s = snap(g, 30, -1, 2);
    expect(s?.kind).toBe('nearest');
    expect(s?.x).toBeCloseTo(30, 5);
    expect(s?.y).toBeCloseTo(0, 5);
  });

  it('nothing within the radius', () => {
    expect(snap(g, 500, 500, 5)).toBeNull();
  });

  it('works on an empty page', () => {
    expect(snap(buildGrid(new Float32Array(0)), 1, 1, 5)).toBeNull();
  });

  it('only the enabled kinds snap', () => {
    const only = (...k: SnapKind[]) => new Set<SnapKind>(k);
    expect(snap(g, 101, 1, 5, only('nearest', 'midpoint'))?.kind).toBe('nearest');
    expect(snap(g, 50, 3, 4, only('endpoint'))).toBeNull();
    expect(snap(g, 50, 3, 4, only())).toBeNull();
    const g2 = buildGrid(segs([0, 0, 100, 50], [0, 50, 100, 0]));
    expect(snap(g2, 51, 26, 5, only('nearest'))?.kind).toBe('nearest');
  });
});

describe('dense pages (ADR-008 d3)', () => {
  it('thinning drops segments shorter than the limit', () => {
    const s = segs([0, 0, 0.2, 0], [0, 0, 10, 0], [5, 5, 5, 5.3]);
    expect([...thin(s, 0.5)]).toEqual([0, 0, 10, 0]);
    expect(indexBytes(buildGrid(s))).toBeGreaterThan(s.byteLength);
  });
});
