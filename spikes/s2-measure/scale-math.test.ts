import { describe, expect, it } from 'vitest';
import {
  MM_PER_POINT,
  calibrate,
  chooseScale,
  format,
  formatFtIn,
  fromMeasureRL,
  measure,
  polygonArea,
  polylineLength,
  toMeasureRL,
  unitsPerPoint,
  type Scale,
  type ScaleViewport,
} from './scale-math.ts';

const mm = (v: number): number => v / MM_PER_POINT; // paper mm → points
const s100: Scale = { paper: 1, real: 100, unit: 'm', precision: 2 };
const s5mm: Scale = { paper: 1, real: 5, unit: 'mm', precision: 1 };

describe('geometry', () => {
  it('polyline length, closed perimeter and shoelace area', () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
      { x: 0, y: 4 },
    ];
    expect(polylineLength(sq)).toBe(10);
    expect(polylineLength(sq, true)).toBe(14);
    expect(polygonArea(sq)).toBe(12);
    expect(polygonArea([...sq].reverse())).toBe(12);
  });
});

describe('scale', () => {
  it('1:100 in metres: 200 mm on paper is 20 m', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: mm(200), y: 0 },
    ];
    expect(measure('distance', pts, s100)).toBeCloseTo(20, 9);
    expect(format(measure('distance', pts, s100), s100, 'distance')).toBe('20.00 m');
  });

  it('area and perimeter of a 200 × 100 mm rectangle at 1:100', () => {
    const r = [
      { x: 0, y: 0 },
      { x: mm(200), y: 0 },
      { x: mm(200), y: mm(100) },
      { x: 0, y: mm(100) },
    ];
    expect(measure('perimeter', r, s100)).toBeCloseTo(60, 9);
    expect(measure('area', r, s100)).toBeCloseTo(200, 9);
    expect(format(200, s100, 'area')).toBe('200.00 m²');
  });

  it('calibration reproduces the ratio', () => {
    const s = calibrate({ x: 10, y: 10 }, { x: 10 + mm(50), y: 10 }, 5, 'm');
    expect(s.real / s.paper).toBeCloseTo(100, 9);
    expect(() => calibrate({ x: 1, y: 1 }, { x: 1, y: 1 }, 1, 'm')).toThrow();
  });

  it('ft-in formatting', () => {
    expect(formatFtIn(12.5)).toBe(`12'-6"`);
    expect(formatFtIn(1 + 1 / 12 + 1 / 96)).toBe(`1'-1 1/8"`);
    expect(formatFtIn(0)).toBe(`0'-0"`);
  });
});

describe('chooseScale (§7.4)', () => {
  const vps: ScaleViewport[] = [{ name: 'Detail A', bbox: [100, 100, 200, 200], scale: s5mm }];
  it('inside a viewport → that viewport', () => {
    const c = chooseScale(
      [
        { x: 120, y: 120 },
        { x: 150, y: 190 },
      ],
      vps,
      s100,
    );
    expect(c.kind === 'viewport' && c.viewport.name).toBe('Detail A');
  });
  it('outside → page default; no default → uncalibrated', () => {
    expect(chooseScale([{ x: 10, y: 10 }], vps, s100)).toEqual({ kind: 'page', scale: s100 });
    expect(chooseScale([{ x: 10, y: 10 }], vps, null)).toEqual({ kind: 'uncalibrated' });
  });
  it('crossing a viewport boundary → spanning warning', () => {
    const c = chooseScale(
      [
        { x: 10, y: 10 },
        { x: 150, y: 150 },
      ],
      vps,
      s100,
    );
    expect(c).toEqual({ kind: 'spanning', viewports: ['(page)', 'Detail A'], fallback: s100 });
  });
  it('overlapping viewports: the later (top) one wins', () => {
    const top: ScaleViewport = { name: 'Top', bbox: [140, 140, 160, 160], scale: s100 };
    const c = chooseScale([{ x: 150, y: 150 }], [...vps, top], null);
    expect(c.kind === 'viewport' && c.viewport.name).toBe('Top');
  });
});

describe('/Measure RL', () => {
  it('X converts points to real units; round-trips to the same scale', () => {
    const m = toMeasureRL(s100);
    expect(m.R).toBe('1 m = 100 m');
    expect(m.X[0]?.C).toBeCloseTo(unitsPerPoint(s100), 12);
    expect(m.X[0]?.D).toBe(100);
    expect(m.A[0]?.U).toBe('sq m');
    expect(fromMeasureRL(m)).toEqual(s100);
    expect(fromMeasureRL(toMeasureRL(s5mm))).toEqual(s5mm);
  });
  it('reads viewer-style unit spellings and rejects unknown units', () => {
    expect(
      fromMeasureRL({
        X: [{ U: 'ft', C: unitsPerPoint({ paper: 1, real: 48, unit: 'ft', precision: 0 }), D: 1 }],
      }),
    ).toEqual({ paper: 1, real: 48, unit: 'ft', precision: 0 });
    expect(fromMeasureRL({ X: [{ U: 'furlong', C: 1 }] })).toBeNull();
  });
});
