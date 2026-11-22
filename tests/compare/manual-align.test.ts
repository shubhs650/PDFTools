// M12-13 (D-60, Q8): manual alignment — the placement from 1 to 3 point
// pairs, the error shown, the numeric fine-tune about the sheet's centre, the
// arrow-key nudge and the turn between the viewer's layout and the displayed
// page. TDD.
import { describe, expect, it } from 'vitest';
import {
  MIN_SPAN,
  NUDGE_LARGE,
  NUDGE_STEP,
  displayedToLaid,
  laidToDisplayed,
  nudgeForKey,
  nudged,
  placeFromPoints,
  placeValues,
  pointError,
  withValue,
  type PointPair,
} from '../../src/model/compare/align/manual';
import { simFrom, simToAffine } from '../../src/model/compare/align/similarity';
import { IDENTITY, applyAffine, quarterTurn, type Affine } from '../../src/model/compare/material';

const close = (m: Affine, want: Affine, digits = 9): void => {
  m.forEach((v, i) => {
    expect(v).toBeCloseTo(want[i] ?? 0, digits);
  });
};

/** Pairs made by placing A's spots through `truth`. */
const pairsBy = (truth: Affine, spots: [number, number][]): PointPair[] =>
  spots.map(([x, y]) => {
    const [u, v] = applyAffine(truth, x, y);
    return { a: { x, y }, b: { x: u, y: v } };
  });

describe('the placement from point pairs', () => {
  it('needs at least one pair', () => {
    expect(placeFromPoints([], IDENTITY)).toBeNull();
  });

  it('one pair shifts the placement in use, keeping its scale and rotation', () => {
    const base = simToAffine(simFrom(0.98, -1.2, 5, 7));
    const fit = placeFromPoints([{ a: { x: 100, y: 200 }, b: { x: 140, y: 230 } }], base);
    if (!fit?.ok) throw new Error('no fit');
    const v = placeValues(fit.place);
    expect(v.scale).toBeCloseTo(0.98, 12);
    expect(v.deg).toBeCloseTo(-1.2, 12);
    const [x, y] = applyAffine(fit.place, 100, 200);
    expect(x).toBeCloseTo(140, 9);
    expect(y).toBeCloseTo(230, 9);
  });

  it('one pair from as is is a pure shift', () => {
    const fit = placeFromPoints([{ a: { x: 10, y: 20 }, b: { x: 24, y: 29 } }], IDENTITY);
    expect(fit).toEqual({ ok: true, place: [1, 0, 0, 1, 14, 9] });
  });

  it('two pairs give the shift, one scale and the rotation exactly', () => {
    const truth = simToAffine(simFrom(0.982, -1.2, 14, -9));
    const fit = placeFromPoints(
      pairsBy(truth, [
        [100, 100],
        [1000, 700],
      ]),
      IDENTITY,
    );
    if (!fit?.ok) throw new Error('no fit');
    close(fit.place, truth);
  });

  it('three pairs give the best fit, and the error says how far each pair is off', () => {
    const truth = simToAffine(simFrom(1, 0.5, 3, 4));
    const pairs = pairsBy(truth, [
      [100, 100],
      [1000, 100],
      [500, 700],
    ]);
    // The third B spot picked 1.5 pt off to the right.
    const third = pairs[2];
    if (!third) throw new Error('pairs');
    third.b = { x: third.b.x + 1.5, y: third.b.y };
    const fit = placeFromPoints(pairs, IDENTITY);
    if (!fit?.ok) throw new Error('no fit');
    const e = pointError(pairs, fit.place);
    expect(e.each).toHaveLength(3);
    // Least squares spreads the slip: no pair is off by the whole 1.5 pt, none by zero.
    expect(e.max).toBeGreaterThan(0.3);
    expect(e.max).toBeLessThan(1.5);
    expect(e.rms).toBeGreaterThan(0.3);
    expect(e.rms).toBeLessThanOrEqual(e.max);
    // Exact pairs: no error.
    const exact = pairsBy(truth, [
      [100, 100],
      [1000, 100],
      [500, 700],
    ]);
    const fit2 = placeFromPoints(exact, IDENTITY);
    if (!fit2?.ok) throw new Error('no fit');
    expect(pointError(exact, fit2.place).max).toBeLessThan(1e-9);
  });

  it('refuses two spots too close together on either page', () => {
    const near: PointPair[] = [
      { a: { x: 100, y: 100 }, b: { x: 100, y: 100 } },
      { a: { x: 100 + MIN_SPAN / 2, y: 100 }, b: { x: 500, y: 100 } },
    ];
    expect(placeFromPoints(near, IDENTITY)).toEqual({ ok: false, reason: 'tooClose', side: 'a' });
    const nearB: PointPair[] = [
      { a: { x: 100, y: 100 }, b: { x: 100, y: 100 } },
      { a: { x: 500, y: 100 }, b: { x: 101, y: 101 } },
    ];
    expect(placeFromPoints(nearB, IDENTITY)).toEqual({ ok: false, reason: 'tooClose', side: 'b' });
  });

  it('refuses a scale no plot has (a pair mixed up)', () => {
    const mixed: PointPair[] = [
      { a: { x: 100, y: 100 }, b: { x: 100, y: 100 } },
      { a: { x: 130, y: 100 }, b: { x: 1100, y: 100 } },
    ];
    expect(placeFromPoints(mixed, IDENTITY)).toEqual({ ok: false, reason: 'scale' });
  });

  it('uses no more than three pairs', () => {
    const truth = simToAffine(simFrom(1, 0, 3, 4));
    const pairs = pairsBy(truth, [
      [100, 100],
      [900, 100],
      [500, 600],
    ]);
    pairs.push({ a: { x: 10, y: 10 }, b: { x: 900, y: 900 } });
    const fit = placeFromPoints(pairs, IDENTITY);
    if (!fit?.ok) throw new Error('no fit');
    close(fit.place, truth);
  });
});

describe('numeric fine-tune and nudges', () => {
  const centre = { x: 595, y: 421 };

  it('reads the shift, scale and rotation of a placement', () => {
    const v = placeValues(simToAffine(simFrom(0.982, -1.2, 14, -9)));
    expect(v.dx).toBeCloseTo(14, 12);
    expect(v.dy).toBeCloseTo(-9, 12);
    expect(v.scale).toBeCloseTo(0.982, 12);
    expect(v.deg).toBeCloseTo(-1.2, 12);
  });

  it('a new shift is taken as typed', () => {
    const p = withValue(simToAffine(simFrom(1, 1, 5, 5)), 'dx', 12.5, centre);
    if (!p) throw new Error('none');
    const v = placeValues(p);
    expect(v.dx).toBeCloseTo(12.5, 12);
    expect(v.dy).toBeCloseTo(5, 12);
    expect(v.deg).toBeCloseTo(1, 12);
  });

  it('a new rotation or scale turns A about the sheet centre: the drawing there stays put', () => {
    const place = simToAffine(simFrom(1.01, 0.3, 20, -10));
    const there = applyAffine(Array.from(place) as Affine, 0, 0);
    expect(there).toBeDefined();
    for (const [key, value] of [
      ['deg', -1.5],
      ['scale', 0.95],
    ] as const) {
      const p = withValue(place, key, value, centre);
      if (!p) throw new Error('none');
      expect(placeValues(p)[key]).toBeCloseTo(value, 12);
      // The spot of A that was on the centre still is.
      const inv = (m: Affine, x: number, y: number) => {
        const det = m[0] * m[3] - m[1] * m[2];
        const dx = x - m[4];
        const dy = y - m[5];
        return [(m[3] * dx - m[2] * dy) / det, (-m[1] * dx + m[0] * dy) / det] as const;
      };
      const [ax, ay] = inv(place, centre.x, centre.y);
      const [x, y] = applyAffine(p, ax, ay);
      expect(x).toBeCloseTo(centre.x, 9);
      expect(y).toBeCloseTo(centre.y, 9);
    }
  });

  it('refuses a scale of zero or a value that is no number', () => {
    expect(withValue(IDENTITY, 'scale', 0, centre)).toBeNull();
    expect(withValue(IDENTITY, 'deg', Number.NaN, centre)).toBeNull();
  });

  it('arrows nudge by a tenth of a point, a point with Shift', () => {
    expect(nudgeForKey('ArrowLeft', false)).toEqual({ dx: -NUDGE_STEP, dy: 0 });
    expect(nudgeForKey('ArrowDown', true)).toEqual({ dx: 0, dy: NUDGE_LARGE });
    expect(nudgeForKey('Enter', false)).toBeNull();
    const p = nudged(simToAffine(simFrom(1, 2, 3, 4)), 0.1, -1);
    const v = placeValues(p);
    expect(v.dx).toBeCloseTo(3.1, 12);
    expect(v.dy).toBeCloseTo(3, 12);
    expect(v.deg).toBeCloseTo(2, 12);
  });
});

describe('the viewer’s layout and the displayed page', () => {
  it('turns like the comparison material does, both ways', () => {
    const w = 842;
    const h = 595;
    for (const turns of [0, 1, 2, 3]) {
      const { turn } = quarterTurn(turns, w, h);
      for (const p of [
        { x: 0, y: 0 },
        { x: 100, y: 30 },
        { x: w, y: h },
      ]) {
        const d = laidToDisplayed(turns, w, h, p);
        const [x, y] = applyAffine(turn, p.x, p.y);
        expect(d.x).toBeCloseTo(x, 9);
        expect(d.y).toBeCloseTo(y, 9);
        const back = displayedToLaid(turns, w, h, d);
        expect(back.x).toBeCloseTo(p.x, 9);
        expect(back.y).toBeCloseTo(p.y, 9);
      }
    }
  });
});
