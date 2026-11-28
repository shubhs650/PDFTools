// M14-05 (D-73, plan §5): the geometry of Angle, Radius and Diameter, test
// first: the inside angle, the circle through three points, the arc through
// them, and the cases with no answer (points in a line, points on top of each
// other).
import { describe, expect, it } from 'vitest';
import {
  angleArc,
  arcOps,
  arcPath,
  arcThrough,
  circleFrom3,
  curveDrawing,
  curveValue,
  insideAngle,
  methodOf,
  pointsNeeded,
  roundOf,
} from '../../src/model/measureCurve';

const P = (x: number, y: number) => ({ x, y });
const deg = (r: number): number => (r * 180) / Math.PI;

describe('the inside angle (Q9)', () => {
  it('measures the angle between the arms at the corner, 0° … 180°', () => {
    expect(insideAngle(P(10, 0), P(0, 0), P(0, 10))).toBeCloseTo(90, 9);
    expect(insideAngle(P(10, 0), P(0, 0), P(-10, 0))).toBeCloseTo(180, 9);
    expect(insideAngle(P(10, 0), P(0, 0), P(10, 10))).toBeCloseTo(45, 9);
    // Either order of the arms, either side.
    expect(insideAngle(P(0, 10), P(0, 0), P(10, 0))).toBeCloseTo(90, 9);
    expect(insideAngle(P(10, 0), P(0, 0), P(10, -10))).toBeCloseTo(45, 9);
    // Reflex angles read as their inside angle.
    expect(insideAngle(P(10, 0), P(0, 0), P(-10, -1))).toBeCloseTo(180 - deg(Math.atan(0.1)), 9);
  });

  it('reads the pipe-run sheet: 142.5° inside, 37.5° deflection', () => {
    const A = P(113.386, 311.811);
    const B = P(453.543, 311.811);
    const C = P(678.431, 484.373);
    expect(insideAngle(A, B, C)).toBeCloseTo(142.5, 1);
    expect(insideAngle(P(680.315, 311.811), B, C)).toBeCloseTo(37.5, 1);
  });

  it('is exact near 0° and 180° (no acos rounding)', () => {
    expect(insideAngle(P(1000, 0), P(0, 0), P(1000, 0.001))).toBeGreaterThan(0);
    expect(insideAngle(P(1000, 0), P(0, 0), P(1000, 0))).toBe(0);
    expect(insideAngle(P(1000, 0), P(0, 0), P(-1000, 0.001))).toBeLessThan(180);
  });

  it('has no answer when an arm has no length', () => {
    expect(insideAngle(P(0, 0), P(0, 0), P(10, 0))).toBeNull();
    expect(insideAngle(P(10, 0), P(0, 0), P(0, 0))).toBeNull();
  });

  it('draws its arc the short way from the first arm to the second', () => {
    const a = angleArc(P(10, 0), P(0, 0), P(0, 10));
    expect(a.a0).toBeCloseTo(0, 9);
    expect(a.a1).toBeCloseTo(Math.PI / 2, 9);
    expect(a.mid).toBeCloseTo(Math.PI / 4, 9);
    // Across ±180°: still the short way (90°, not 270°).
    const b = angleArc(P(-10, 1), P(0, 0), P(-1, -10));
    expect(Math.abs(b.a1 - b.a0)).toBeLessThan(Math.PI);
  });
});

describe('the circle through three points (Q10)', () => {
  it('finds the centre and radius', () => {
    const k = circleFrom3(P(10, 0), P(0, 10), P(-10, 0));
    expect(k?.c.x).toBeCloseTo(0, 9);
    expect(k?.c.y).toBeCloseTo(0, 9);
    expect(k?.r).toBeCloseTo(10, 9);
  });

  it('keeps its precision far from the origin (large sheets)', () => {
    const c = P(2380.5, 1683.75);
    const at = (t: number) => P(c.x + 0.5 * Math.cos(t), c.y + 0.5 * Math.sin(t));
    const k = circleFrom3(at(0.1), at(0.2), at(0.3));
    expect(k?.r).toBeCloseTo(0.5, 6);
    expect(k?.c.x).toBeCloseTo(c.x, 5);
  });

  it('reads the pipe-run sheet: the bend R 1,200 mm (24 pt at 1:50) and the tank Ø 3,000 mm', () => {
    const bend = circleFrom3(P(430.45, 311.811), P(452.318, 315.421), P(471.865, 325.87));
    expect(bend?.r).toBeCloseTo(68.03, 1);
    expect(bend?.c.x).toBeCloseTo(430.45, 1);
    expect(bend?.c.y).toBeCloseTo(379.843, 1);
    const tank = circleFrom3(P(935.433, 680.315), P(850.394, 765.354), P(776.747, 637.795));
    expect(2 * (tank?.r ?? 0)).toBeCloseTo(170.08, 1);
  });

  it('has no answer for points in a line or on top of each other', () => {
    expect(circleFrom3(P(0, 0), P(5, 5), P(10, 10))).toBeNull();
    expect(circleFrom3(P(0, 0), P(5, 5.000001), P(10, 10))).toBeNull();
    expect(circleFrom3(P(0, 0), P(0, 0), P(10, 0))).toBeNull();
    expect(circleFrom3(P(3, 4), P(3, 4), P(3, 4))).toBeNull();
    expect(circleFrom3(P(0, 0), P(10, 0), P(0, 0))).toBeNull();
  });

  it('the arc runs from the first point through the second to the third', () => {
    const c = P(0, 0);
    // Anticlockwise: 0° → 90° → 180°.
    const up = arcThrough(c, P(10, 0), P(0, 10), P(-10, 0));
    expect(up.a0).toBeCloseTo(0, 9);
    expect(up.a1 - up.a0).toBeCloseTo(Math.PI, 9);
    // Clockwise: 0° → −90° → 180°.
    const down = arcThrough(c, P(10, 0), P(0, -10), P(-10, 0));
    expect(down.a1 - down.a0).toBeCloseTo(-Math.PI, 9);
    // A long arc (270°) through its middle point.
    const long = arcThrough(c, P(10, 0), P(-10, 0), P(0, -10));
    expect(long.a1 - long.a0).toBeCloseTo((3 * Math.PI) / 2, 9);
  });
});

describe('Radius and Diameter', () => {
  it('two points: the centre, then a point on the edge; the full circle', () => {
    const g = roundOf('radius', [P(100, 100), P(130, 140)]);
    expect(g?.r).toBeCloseTo(50, 9);
    expect(g?.full).toBe(true);
    expect(g?.from).toEqual(P(100, 100));
    expect(g?.edge.x).toBeCloseTo(130, 9);
    expect(curveValue('radius', [P(100, 100), P(130, 140)])).toBeCloseTo(50, 9);
    expect(curveValue('diameter', [P(100, 100), P(130, 140)])).toBeCloseTo(100, 9);
    // A Diameter's line runs through the centre from the far side.
    const d = roundOf('diameter', [P(100, 100), P(130, 140)]);
    expect(d?.from.x).toBeCloseTo(70, 9);
    expect(d?.from.y).toBeCloseTo(60, 9);
  });

  it('three points: a Radius draws the arc, a Diameter the circle (either can switch)', () => {
    const pts = [P(10, 0), P(0, 10), P(-10, 0)];
    const r = roundOf('radius', pts);
    expect(r?.full).toBe(false);
    expect((r?.a1 ?? 0) - (r?.a0 ?? 0)).toBeCloseTo(Math.PI, 9);
    expect(roundOf('diameter', pts)?.full).toBe(true);
    expect(roundOf('radius', pts, 'circle')?.full).toBe(true);
    expect(roundOf('diameter', pts, 'arc')?.full).toBe(false);
    // The line ends on the middle click.
    expect(r?.edge.x).toBeCloseTo(0, 9);
    expect(r?.edge.y).toBeCloseTo(10, 9);
  });

  it('has no value for a centre on its edge point or three points in a line', () => {
    expect(curveValue('radius', [P(5, 5), P(5, 5)])).toBeNull();
    expect(curveValue('diameter', [P(0, 0), P(1, 1), P(2, 2)])).toBeNull();
    expect(curveValue('radius', [P(0, 0)])).toBeNull();
    expect(curveValue('angle', [P(0, 0), P(0, 0), P(1, 1)])).toBeNull();
    expect(curveDrawing('angle', [P(0, 0), P(0, 0), P(1, 1)])).toBeNull();
    expect(curveDrawing('diameter', [P(0, 0), P(1, 1), P(2, 2)])).toBeNull();
  });

  it('counts the points each method takes, and tells the method from them', () => {
    expect(pointsNeeded('angle', 'centre')).toBe(3);
    expect(pointsNeeded('radius', 'centre')).toBe(2);
    expect(pointsNeeded('diameter', 'three')).toBe(3);
    expect(methodOf([P(0, 0), P(1, 1)])).toBe('centre');
    expect(methodOf([P(0, 0), P(1, 1), P(2, 0)])).toBe('three');
  });
});

describe('the drawing', () => {
  it('an Angle: two arms, the arc at the corner, the caption outside it on the bisector', () => {
    const d = curveDrawing('angle', [P(100, 0), P(0, 0), P(0, 100)]);
    expect(d?.lines).toHaveLength(2);
    expect(d?.arcs[0]?.r).toBeCloseTo(28, 9);
    const box = d?.caption(30, 12);
    expect(box?.angle).toBe(0);
    // On the 45° line, beyond the arc.
    expect(box?.at.x).toBeCloseTo(box?.at.y ?? 0, 9);
    expect(Math.hypot(box?.at.x ?? 0, box?.at.y ?? 0)).toBeGreaterThan(28);
  });

  it('a small angle keeps an arc that fits its arms', () => {
    const d = curveDrawing('angle', [P(10, 0), P(0, 0), P(0, 10)]);
    expect(d?.arcs[0]?.r).toBeLessThanOrEqual(10);
    expect(d?.arcs[0]?.r).toBeGreaterThan(0);
  });

  it('a Radius: the circle, its line with one arrow, a centre cross; a Diameter: two arrows', () => {
    const r = curveDrawing('radius', [P(0, 0), P(50, 0)]);
    // The line, two barbs, two strokes of the cross.
    expect(r?.lines).toHaveLength(5);
    const d = curveDrawing('diameter', [P(0, 0), P(50, 0)]);
    // The line and two barbs at each end.
    expect(d?.lines).toHaveLength(5);
    expect(d?.lines[0]?.[0].x).toBeCloseTo(-50, 9);
    // The caption sits above the half of the line from the centre.
    const box = r?.caption(40, 12);
    expect(box?.at.x).toBeCloseTo(25, 9);
    expect(box?.at.y).toBeGreaterThan(6);
    // The drawing's bounds reach round the whole circle.
    const ys = r?.extent.map((p) => p.y) ?? [];
    expect(Math.min(...ys)).toBeCloseTo(-50, 1);
    expect(Math.max(...ys)).toBeCloseTo(50, 1);
  });

  it('arcs as PDF curves and SVG paths', () => {
    const f = (n: number): string => String(Math.round(n * 1000) / 1000);
    const quarter = arcOps({ c: P(0, 0), r: 10, a0: 0, a1: Math.PI / 2 }, f);
    expect(quarter.startsWith('10 0 m')).toBe(true);
    expect(quarter.match(/ c/gu)).toHaveLength(1);
    expect(quarter.endsWith('0 10 c')).toBe(true);
    const circle = arcOps({ c: P(0, 0), r: 10, a0: 0, a1: 2 * Math.PI }, f);
    expect(circle.match(/ c/gu)).toHaveLength(4);
    expect(arcPath({ c: P(0, 0), r: 10, a0: 0, a1: 2 * Math.PI }, 1)).toMatch(/A10 10 0 1 1/u);
    expect(arcPath({ c: P(0, 0), r: 10, a0: 0, a1: Math.PI / 2 }, 2)).toBe('M20 0 A20 20 0 0 1 0 20');
  });
});
