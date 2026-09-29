import { describe, expect, it } from 'vitest';
import { createFormatters } from '../../src/i18n/format';
import {
  PAPER,
  labelRect,
  measureKeys,
  measureKind,
  measurePoints,
  measuredValue,
  toUserSpace,
  valueText,
} from '../../src/model/measurement';
import { MM_PER_POINT, measureFromPdf, type Scale } from '../../src/model/scale';

// M3-16 (§7.4, ADR-007): the S2 expected table — a 200 × 100 mm building at
// 1:100 in metres and an 80 × 40 mm plate at 1:5 in millimetres.
const mm = (v: number): number => v / MM_PER_POINT;
const en = createFormatters('en-US');
const s100: Scale = { paper: 1, real: 100, unit: 'm', precision: 2 };
const s5: Scale = { paper: 1, real: 5, unit: 'mm', precision: 1 };
const rect = (w: number, h: number) => [
  { x: 100, y: 100 },
  { x: 100 + mm(w), y: 100 },
  { x: 100 + mm(w), y: 100 + mm(h) },
  { x: 100, y: 100 + mm(h) },
];
const building = rect(200, 100);
const plate = rect(80, 40);
const closed = <T>(pts: T[]): T[] => [...pts, pts[0] as T];

describe('measurement kinds', () => {
  it('only line/polyline/polygon with their dimension intent', () => {
    expect(measureKind({ type: 4, intent: 'LineDimension' })).toBe('distance');
    expect(measureKind({ type: 8, intent: 'PolyLineDimension' })).toBe('perimeter');
    expect(measureKind({ type: 7, intent: '/PolygonDimension' })).toBe('area');
    expect(measureKind({ type: 4 })).toBeNull();
    expect(measureKind({ type: 4, intent: 'LineArrow' })).toBeNull();
    expect(measureKind({ type: 7, intent: 'PolygonCloud' })).toBeNull();
    expect(measureKind({ type: 8, intent: 'LineDimension' })).toBeNull();
  });

  it('points of a line and of a polygon', () => {
    const a = { x: 1, y: 2 };
    const b = { x: 3, y: 4 };
    expect(measurePoints({ type: 4, linePoints: { start: a, end: b } })).toEqual([a, b]);
    expect(measurePoints({ type: 7, vertices: [a, b] })).toEqual([a, b]);
    expect(measurePoints({ type: 7 })).toEqual([]);
  });
});

describe('values match the S2 expected table', () => {
  const cases: [string, 'distance' | 'perimeter' | 'area', { x: number; y: number }[], Scale][] = [
    ['20.00 m', 'distance', building.slice(0, 2), s100],
    ['60.00 m', 'perimeter', closed(building), s100],
    ['200.00 m²', 'area', building, s100],
    ['400.0 mm', 'distance', plate.slice(0, 2), s5],
    ['1,200.0 mm', 'perimeter', closed(plate), s5],
    ['80,000.0 mm²', 'area', plate, s5],
  ];
  for (const [text, kind, pts, s] of cases)
    it(`${kind} → ${text}`, () => {
      expect(valueText(kind, pts, s, en)).toEqual({ value: text, calibrated: true });
    });

  it('a polyline perimeter is open: the closing side is not added', () => {
    expect(measuredValue('perimeter', building, s100)).toBeCloseTo(50, 9);
  });

  it('without a scale: the paper length in mm, marked uncalibrated', () => {
    expect(valueText('distance', building.slice(0, 2), null, en)).toEqual({
      value: '200.0 mm',
      calibrated: false,
    });
    expect(measuredValue('area', building, null)).toBeCloseTo(20000, 6);
    expect(PAPER.real).toBe(1);
  });

  it('ft-in scales show feet and inches', () => {
    const ft: Scale = { paper: 1, real: 48, unit: 'ft', precision: 2, ftIn: 16 };
    // 1/4" = 1'-0": 3 inches on paper is 12 ft.
    const pts = [
      { x: 0, y: 0 },
      { x: 3 * 72, y: 0 },
    ];
    expect(valueText('distance', pts, ft, en).value).toBe(`12'-0"`);
  });
});

describe('object keys', () => {
  it('a distance gets /IT, /Measure, /Cap and /CP /Top', () => {
    const k = measureKeys('distance', s100);
    expect(k.set.IT).toEqual({ name: 'LineDimension' });
    expect(k.set.Cap).toBe(true);
    expect(k.set.CP).toEqual({ name: 'Top' });
    expect(measureFromPdf(k.set.Measure)).toEqual(s100);
    expect(k.remove).toEqual([]);
  });

  it('areas have no caption keys; no scale removes /Measure', () => {
    const k = measureKeys('area', null);
    expect(Object.keys(k.set)).toEqual(['IT']);
    expect(k.set.IT).toEqual({ name: 'PolygonDimension' });
    expect(k.remove).toEqual(['Measure']);
  });
});

describe('labels', () => {
  const page = { width: 595, height: 842 };
  it('sits above a line’s midpoint and is centred on it', () => {
    const r = labelRect(
      'distance',
      [
        { x: 100, y: 300 },
        { x: 300, y: 300 },
      ],
      '20.00 m',
      page,
    );
    expect(r.origin.x + r.size.width / 2).toBeCloseTo(200, 6);
    expect(r.origin.y + r.size.height).toBeLessThanOrEqual(300);
  });

  it('is centred on an area and stays on the page', () => {
    const r = labelRect('area', building, '200.00 m²', page);
    const cx = building.reduce((s, p) => s + p.x, 0) / 4;
    expect(r.origin.x + r.size.width / 2).toBeCloseTo(cx, 6);
    const edge = labelRect(
      'distance',
      [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ],
      '1 m',
      page,
    );
    expect(edge.origin.x).toBe(0);
    expect(edge.origin.y).toBe(0);
  });

  it('converts to user space with the page frame', () => {
    expect(toUserSpace([{ x: 10, y: 20 }], { height: 842, originX: 5, originY: 7 })).toEqual([
      { x: 15, y: 829 },
    ]);
  });
});
