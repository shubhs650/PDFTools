import { describe, expect, it } from 'vitest';
import { createFormatters } from '../../src/i18n/format';
import {
  affineFrom,
  areaMm2,
  areaText,
  areaValue,
  autoAreaUnit,
  autoVolumeUnit,
  depthMm,
  holeProblem,
  holesThatFit,
  MM2_PER,
  MM3_PER,
  netArea,
  segmentsMeet,
  volumeText,
  volumeValue,
} from '../../src/model/measureQuantity';
import type { Pt } from '../../src/model/measureGeometry';
import { MM_PER_POINT, type Scale } from '../../src/model/scale';

// M14-06 (D-73, plan M14 §6, Q7, Q8, Q28): net areas, volumes, units.
const en = createFormatters('en-US');
const plan: Scale = { paper: 1, real: 100, unit: 'mm', precision: 0 };
const ft: Scale = { paper: 1, real: 48, unit: 'ft', precision: 2, ftIn: 16 };
const inches: Scale = { paper: 1, real: 12, unit: 'in', precision: 1 };
const cm: Scale = { paper: 1, real: 50, unit: 'cm', precision: 1 };
const oneToOne: Scale = { paper: 1, real: 1, unit: 'mm', precision: 1 };

const P = (pts: number[][]): Pt[] => pts.map(([x = 0, y = 0]) => ({ x, y }));

// The measure corpus' slab (sheet 01, MEASURE_MANIFEST.json "slab-net-area" and "slab-volume"):
// 9000 × 9000 mm at 1:100 with a 1.5 × 1.5 m and a 2 × 4 m opening.
const SLAB = P([
  [127.559, 487.559],
  [382.677, 487.559],
  [382.677, 742.677],
  [127.559, 742.677],
]);
const HOLE_A = P([
  [184.252, 544.252],
  [226.772, 544.252],
  [226.772, 586.772],
  [184.252, 586.772],
]);
const HOLE_B = P([
  [283.465, 586.772],
  [340.157, 586.772],
  [340.157, 700.157],
  [283.465, 700.157],
]);

const square = (x: number, y: number, s: number): Pt[] =>
  P([
    [x, y],
    [x + s, y],
    [x + s, y + s],
    [x, y + s],
  ]);

describe('net area and volume (Q7, Q8)', () => {
  it('the slab: 81 m² gross, 70.75 m² net, 17.6875 m³ at 250 mm', () => {
    expect(areaMm2(SLAB, [], plan) / 1e6).toBeCloseTo(81, 2);
    expect(areaMm2(SLAB, [HOLE_A, HOLE_B], plan) / 1e6).toBeCloseTo(70.75, 2);
    const v = volumeValue(
      SLAB,
      { holes: [HOLE_A, HOLE_B], depth: { value: 250, unit: 'mm' } },
      plan,
    );
    expect(v.unit).toBe('m3');
    expect(v.value).toBeCloseTo(17.6875, 3);
    expect(volumeText(v, en)).toBe('17.69 m³');
  });

  it('a hole takes its own area off, whichever way it was drawn', () => {
    const reversed = [...HOLE_A].reverse();
    expect(netArea(SLAB, [reversed])).toBeCloseTo(netArea(SLAB, [HOLE_A]), 9);
    expect(netArea(SLAB, [HOLE_A])).toBeLessThan(netArea(SLAB));
  });

  it('never goes below zero', () => {
    expect(netArea(square(0, 0, 10), [square(0, 0, 20)])).toBe(0);
  });

  it('a depth in any length unit', () => {
    expect(depthMm({ value: 1.5, unit: 'm' })).toBe(1500);
    expect(depthMm({ value: 6, unit: 'in' })).toBeCloseTo(152.4, 9);
    expect(depthMm({ value: 2, unit: 'ft' })).toBeCloseTo(609.6, 9);
  });
});

describe('area and volume units (Q28)', () => {
  it('metric lengths give m² and m³; imperial give sq ft and cu ft', () => {
    expect(autoAreaUnit(plan)).toBe('m2');
    expect(autoAreaUnit(cm)).toBe('m2');
    expect(autoAreaUnit(ft)).toBe('ft2');
    expect(autoAreaUnit(inches)).toBe('ft2');
    expect(autoVolumeUnit(plan)).toBe('m3');
    expect(autoVolumeUnit(ft)).toBe('ft3');
  });

  it('paper size stays in mm² and mm³', () => {
    expect(autoAreaUnit(null)).toBe('mm2');
    expect(autoAreaUnit(oneToOne)).toBe('mm2');
    expect(autoVolumeUnit(null)).toBe('mm3');
  });

  it('the conversions', () => {
    expect(MM2_PER.ft2).toBeCloseTo(92903.04, 6);
    expect(MM2_PER.m2).toBe(1e6);
    expect(MM3_PER.yd3).toBeCloseTo(764554857.984, 3);
    expect(MM3_PER.ft3 * 27).toBeCloseTo(MM3_PER.yd3, 3);
  });

  it('an area in a chosen unit and decimals', () => {
    // 90 × 90 mm of paper at 1:100: 9 × 9 m.
    const exact = square(100, 100, 90 / MM_PER_POINT);
    expect(areaText(areaValue(exact, { areaUnit: 'cm2', areaDecimals: 0 }, plan), en)).toBe(
      '810,000 cm²',
    );
    expect(areaText(areaValue(SLAB, {}, plan), en)).toBe('81.00 m²');
    expect(areaText(areaValue(SLAB, { areaDecimals: 3, holes: [HOLE_A] }, plan), en)).toBe(
      '78.750 m²',
    );
  });

  it('the garage on the imperial sheet: 250 sq ft (cu yd as an option)', () => {
    const garage = P([
      [113.386, 198.425],
      [473.386, 198.425],
      [473.386, 423.425],
      [113.386, 423.425],
    ]);
    expect(areaText(areaValue(garage, {}, ft), en)).toBe('250.00 sq ft');
    const v = volumeValue(garage, { depth: { value: 1, unit: 'ft' }, volumeUnit: 'yd3' }, ft);
    expect(v.value).toBeCloseTo(250 / 27, 6);
    expect(volumeText(v, en)).toBe('9.26 cu yd');
    expect(volumeText(volumeValue(garage, { depth: { value: 1, unit: 'ft' } }, ft), en)).toBe(
      '250.00 cu ft',
    );
  });
});

describe('where a cutout may go (Q8)', () => {
  it('inside the outline and clear of the other holes', () => {
    expect(holeProblem(SLAB, [], HOLE_A)).toBeNull();
    expect(holeProblem(SLAB, [HOLE_A], HOLE_B)).toBeNull();
  });

  it('not across or outside the outline', () => {
    expect(holeProblem(SLAB, [], square(100, 500, 50))).toBe('outside');
    expect(holeProblem(SLAB, [], square(10, 10, 20))).toBe('outside');
    // Every point inside a concave outline, but an edge leaves it.
    const u = P([
      [0, 0],
      [30, 0],
      [30, 30],
      [20, 30],
      [20, 10],
      [10, 10],
      [10, 30],
      [0, 30],
    ]);
    const across = P([
      [5, 25],
      [25, 25],
      [25, 28],
      [5, 28],
    ]);
    expect(across.every((p) => p.y > 10)).toBe(true);
    expect(holeProblem(u, [], across)).toBe('outside');
  });

  it('not over, inside or around another hole', () => {
    expect(holeProblem(SLAB, [HOLE_A], square(200, 560, 40))).toBe('overlap');
    expect(holeProblem(SLAB, [HOLE_A], square(190, 550, 10))).toBe('overlap');
    expect(holeProblem(SLAB, [square(190, 550, 10)], square(180, 540, 40))).toBe('overlap');
    // The hole being edited is not checked against itself.
    expect(holeProblem(SLAB, [HOLE_A], square(186, 546, 30), 0)).toBeNull();
  });

  it('needs three points and an area', () => {
    expect(holeProblem(SLAB, [], HOLE_A.slice(0, 2))).toBe('tooSmall');
    expect(
      holeProblem(
        SLAB,
        [],
        P([
          [200, 600],
          [210, 600],
          [220, 600],
        ]),
      ),
    ).toBe('tooSmall');
  });

  it('holes that no longer fit a reshaped outline are dropped', () => {
    const smaller = square(127.559, 487.559, 110);
    expect(holesThatFit(smaller, [HOLE_A, HOLE_B])).toEqual([HOLE_A]);
  });

  it('segments that only touch meet', () => {
    expect(segmentsMeet({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 })).toBe(
      true,
    );
    expect(segmentsMeet({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 })).toBe(
      false,
    );
  });
});

describe('holes follow their outline (move, resize, turn)', () => {
  it('a move', () => {
    const to = SLAB.map((p) => ({ x: p.x + 10, y: p.y - 5 }));
    const f = affineFrom(SLAB, to);
    const p = f?.({ x: 200, y: 600 });
    expect(p?.x).toBeCloseTo(210, 9);
    expect(p?.y).toBeCloseTo(595, 9);
  });

  it('a resize about the first corner', () => {
    const o = SLAB[0] ?? { x: 0, y: 0 };
    const to = SLAB.map((p) => ({ x: o.x + (p.x - o.x) * 2, y: o.y + (p.y - o.y) * 0.5 }));
    const p = affineFrom(SLAB, to)?.({ x: o.x + 10, y: o.y + 10 });
    expect(p?.x).toBeCloseTo(o.x + 20, 9);
    expect(p?.y).toBeCloseTo(o.y + 5, 9);
  });

  it('no map from points in a line', () => {
    expect(
      affineFrom(
        P([
          [0, 0],
          [1, 1],
          [2, 2],
        ]),
        P([
          [0, 0],
          [1, 1],
          [2, 2],
        ]),
      ),
    ).toBeNull();
  });
});
