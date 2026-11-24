// M13-10: a Distance drawn as a dimension, the pure geometry (TDD).
import { describe, expect, it } from 'vitest';
import {
  boundsOf,
  dimensionGeometry,
  dimensionMiddle,
  LEADER_EXTENSION,
  leaderFor,
  leaderFromFile,
  leaderNormal,
  leaderOf,
  leaderOperators,
  offsetOf,
  unionRect,
} from '../../src/model/dimension';
import { labelRect } from '../../src/model/measurement';

const A = { x: 100, y: 200 };
const B = { x: 300, y: 200 };

describe('leader normal and offset (ISO 32000-1 Table 175: positive /LL is clockwise)', () => {
  it('a line drawn left to right: positive goes down the page in both spaces', () => {
    // y down (EmbedPDF): down the page is +y.
    expect(leaderNormal(A, B, true)).toEqual({ x: -0, y: 1 });
    // y up (PDF user space): down the page is -y.
    expect(leaderNormal(A, B, false)).toEqual({ x: 0, y: -1 });
  });

  it('the pointer below a left-to-right line gives a positive offset, above a negative one', () => {
    expect(offsetOf(A, B, { x: 150, y: 240 }, true)).toBeCloseTo(40);
    expect(offsetOf(A, B, { x: 150, y: 170 }, true)).toBeCloseTo(-30);
    // Drawn right to left, the same place is the other sign.
    expect(offsetOf(B, A, { x: 150, y: 240 }, true)).toBeCloseTo(-40);
  });

  it('only the sideways part of the pointer counts', () => {
    expect(offsetOf(A, B, { x: 900, y: 225 }, true)).toBeCloseTo(25);
  });

  it('a line of no length has no normal and no offset', () => {
    expect(leaderNormal(A, A, true)).toBeNull();
    expect(offsetOf(A, A, B, true)).toBe(0);
  });

  it('the same /LL is the same side on screen and in the file (a mirror flips clockwise)', () => {
    const H = 842;
    const user = (p: { x: number; y: number }) => ({ x: p.x, y: H - p.y });
    const slanted = { x: 260, y: 330 };
    const p = { x: 140, y: 310 };
    expect(offsetOf(user(A), user(slanted), user(p), false)).toBeCloseTo(
      offsetOf(A, slanted, p, true),
    );
  });
});

describe('leader from an offset or a file', () => {
  it('a small offset is no offset: a plain line', () => {
    expect(leaderFor(0.4)).toBeNull();
    expect(leaderFor(-0.9)).toBeNull();
    expect(leaderFor(Number.NaN)).toBeNull();
  });

  it('an offset becomes /LL, with our extension and no gap', () => {
    expect(leaderFor(-42.126)).toEqual({ ll: -42.13, lle: LEADER_EXTENSION, llo: 0 });
  });

  it('a file without /LL (or /LL 0) has no leader; negative /LLE and /LLO count as 0', () => {
    expect(leaderFromFile(undefined, 3, 0)).toBeNull();
    expect(leaderFromFile(0, 3, 0)).toBeNull();
    expect(leaderFromFile(12, -1, undefined)).toEqual({ ll: 12, lle: 0, llo: 0 });
  });

  it('leaderOf reads our extra field from an annotation object', () => {
    expect(leaderOf({ leader: { ll: 5, lle: 3, llo: 1 } })).toEqual({ ll: 5, lle: 3, llo: 1 });
    expect(leaderOf({ leader: { ll: 0 } })).toBeNull();
    expect(leaderOf({})).toBeNull();
    expect(leaderOf(null)).toBeNull();
  });
});

describe('dimension geometry', () => {
  it('the dimension line sits /LL beside the points; leaders go /LLE past it', () => {
    const g = dimensionGeometry(A, B, { ll: 40, lle: 3, llo: 2 }, true);
    expect(g.start).toEqual({ x: 100, y: 240 });
    expect(g.end).toEqual({ x: 300, y: 240 });
    expect(g.leaders[0]).toEqual([
      { x: 100, y: 202 },
      { x: 100, y: 243 },
    ]);
    expect(g.leaders[1]).toEqual([
      { x: 300, y: 202 },
      { x: 300, y: 243 },
    ]);
  });

  it('a negative /LL goes the other way, the extension and gap too', () => {
    const g = dimensionGeometry(A, B, { ll: -40, lle: 3, llo: 2 }, true);
    expect(g.start.y).toBe(160);
    expect(g.leaders[0]).toEqual([
      { x: 100, y: 198 },
      { x: 100, y: 157 },
    ]);
  });

  it('no leader: the line itself', () => {
    const g = dimensionGeometry(A, B, null, true);
    expect(g.start).toEqual(A);
    expect(g.end).toEqual(B);
  });

  it("the label goes over the dimension line's middle", () => {
    expect(dimensionMiddle(A, B, { ll: 40, lle: 3, llo: 0 })).toEqual({ x: 200, y: 240 });
    const r = labelRect('distance', [A, B], '200 mm', { width: 595, height: 842 }, 10, {
      ll: 40,
      lle: 3,
      llo: 0,
    });
    expect(r.origin.y + r.size.height).toBeCloseTo(238);
    expect(r.origin.x + r.size.width / 2).toBeCloseTo(200);
  });

  it('bounds and union', () => {
    const r = boundsOf([A, B, { x: 150, y: 260 }], 2);
    expect(r).toEqual({ origin: { x: 98, y: 198 }, size: { width: 204, height: 64 } });
    expect(unionRect(r, { origin: { x: 0, y: 250 }, size: { width: 10, height: 100 } })).toEqual({
      origin: { x: 0, y: 198 },
      size: { width: 302, height: 152 },
    });
  });

  it('the leader operators: two solid strokes in plain numbers', () => {
    const g = dimensionGeometry(
      { x: 100, y: 500 },
      { x: 300, y: 500 },
      { ll: 40.5, lle: 3, llo: 0 },
      false,
    );
    expect(leaderOperators(g)).toBe('q [] 0 d 100 500 m 100 456.5 l 300 500 m 300 456.5 l S Q\n');
  });
});
