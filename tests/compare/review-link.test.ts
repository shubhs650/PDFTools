// M12-12 (D-62): the Review layout's link between windows — each window's
// map into the overlay's frame, the follower's centre and zoom, the scroll
// position for a page point and back, and the splitters' limits.
import { describe, expect, it } from 'vitest';
import { IDENTITY, invertAffine, type Affine } from '../../src/model/compare/material';
import {
  DEFAULT_SPLITS,
  MIN_WINDOW_PX,
  between,
  centreOf,
  clampSplit,
  followerView,
  mapPoint,
  sameScale,
  scaleOf,
  scrollFor,
  splitForKey,
  toReference,
} from '../../src/model/compare/link';

/** A similarity in displayed space: k·R(deg)·p + (tx, ty). */
function sim(k: number, deg: number, tx: number, ty: number): Affine {
  const r = (deg * Math.PI) / 180;
  return [k * Math.cos(r), k * Math.sin(r), -k * Math.sin(r), k * Math.cos(r), tx, ty];
}

describe('window maps', () => {
  const place = sim(0.5, 0.6, 40, -25);

  it('puts A through its alignment and B and the overlay as they are', () => {
    expect(toReference('a', place, true)).toEqual(place);
    expect(toReference('b', place, true)).toEqual(IDENTITY);
    expect(toReference('overlay', place, true)).toEqual(IDENTITY);
    // A sheet only A has is drawn in A's own frame.
    expect(toReference('a', place, false)).toEqual(IDENTITY);
  });

  it('maps a point of A to B and back', () => {
    const aToB = between(place, IDENTITY);
    const bToA = between(IDENTITY, place);
    const p = { x: 300, y: 120 };
    const q = mapPoint(aToB, p);
    const back = mapPoint(bToA, q);
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
    expect(mapPoint(invertAffine(place), q).x).toBeCloseTo(p.x, 9);
  });

  it('gives the follower the zoom that shows a feature the same size (pair 15: A1 against A3)', () => {
    const a1ToA3 = sim(0.4994, 0, 0, 0);
    expect(scaleOf(a1ToA3)).toBeCloseTo(0.4994, 9);
    const f = followerView(a1ToA3, { x: 1000, y: 600 }, 3);
    expect(f.centre.x).toBeCloseTo(499.4, 6);
    expect(f.centre.y).toBeCloseTo(299.64, 6);
    expect(f.scale).toBeCloseTo(3 / 0.4994, 6);
    // The other way round.
    const back = followerView(invertAffine(a1ToA3), f.centre, f.scale);
    expect(back.scale).toBeCloseTo(3, 9);
    expect(back.centre.x).toBeCloseTo(1000, 6);
  });

  it('treats a degenerate map as scale 1', () => {
    expect(scaleOf([0, 0, 0, 0, 0, 0])).toBe(1);
  });

  it('compares zoom levels within the plugin’s rounding', () => {
    expect(sameScale(1.2341, 1.234)).toBe(true);
    expect(sameScale(1.25, 1.234)).toBe(false);
  });
});

describe('scroll position', () => {
  it('centres a page point and reads it back', () => {
    const page = { left: 10, top: 2410 };
    const view = { width: 800, height: 500 };
    const s = scrollFor({ x: 200, y: 100 }, 2, page, view);
    expect(s).toEqual({ left: 10, top: 2360 });
    expect(centreOf(s, 2, page, view)).toEqual({ x: 200, y: 100 });
  });
});

describe('splitters', () => {
  it('opens with the overlay larger and A and B even', () => {
    expect(DEFAULT_SPLITS.x).toBeGreaterThan(0.5);
    expect(DEFAULT_SPLITS.y).toBe(0.5);
  });

  it('keeps each window at least the minimum size', () => {
    expect(clampSplit(0.01, 1000)).toBeCloseTo(MIN_WINDOW_PX / 1000, 9);
    expect(clampSplit(0.99, 1000)).toBeCloseTo(1 - MIN_WINDOW_PX / 1000, 9);
    expect(clampSplit(0.4, 1000)).toBe(0.4);
    // Less room than two windows: the middle.
    expect(clampSplit(0.1, 200)).toBe(0.5);
    expect(clampSplit(Number.NaN, 1000)).toBe(0.5);
  });

  it('moves with the keys', () => {
    expect(splitForKey('ArrowRight', 0.5, 1000)).toBeCloseTo(0.52, 9);
    expect(splitForKey('ArrowUp', 0.5, 1000)).toBeCloseTo(0.48, 9);
    expect(splitForKey('Home', 0.5, 1000)).toBeCloseTo(0.16, 9);
    expect(splitForKey('End', 0.5, 1000)).toBeCloseTo(0.84, 9);
    expect(splitForKey('a', 0.5, 1000)).toBeNull();
  });
});
