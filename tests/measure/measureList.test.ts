import { describe, expect, it } from 'vitest';
import { createFormatters } from '../../src/i18n/format';
import {
  entryText,
  groupMeasurements,
  isPaperScale,
  measureEntry,
  sumOf,
  sumText,
  sumValue,
  totalOf,
  type MeasureEntryInput,
} from '../../src/model/measureList';
import { MM_PER_POINT, type Scale } from '../../src/model/scale';

// M14-08 (D-76, plan M14 §8): grouping and totals with units.
const en = createFormatters('en-US');
const mm = (v: number): number => v / MM_PER_POINT;
const s100: Scale = { paper: 1, real: 100, unit: 'm', precision: 2 };
const s5: Scale = { paper: 1, real: 5, unit: 'mm', precision: 1 };
const s50cm: Scale = { paper: 1, real: 50, unit: 'cm', precision: 1 };
const ft: Scale = { paper: 1, real: 48, unit: 'ft', precision: 2, ftIn: 16 };
const oneToOne: Scale = { paper: 1, real: 1, unit: 'mm', precision: 1 };

/** A horizontal line `paperMm` long on the page. */
const line = (paperMm: number) => [
  { x: 100, y: 100 },
  { x: 100 + mm(paperMm), y: 100 },
];
/** A w × h paper-mm rectangle (closed by the polygon). */
const rect = (w: number, h: number) => [
  { x: 100, y: 100 },
  { x: 100 + mm(w), y: 100 },
  { x: 100 + mm(w), y: 100 + mm(h) },
  { x: 100, y: 100 + mm(h) },
];

/** The value, which the test needs to be there. */
function must<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error('missing');
  return v;
}

let n = 0;
const input = (o: Partial<MeasureEntryInput>): MeasureEntryInput => ({
  id: `m${String(++n)}`,
  page: 0,
  tool: 'length',
  points: line(10),
  scale: s100,
  spans: null,
  where: '',
  at: { x: 0, y: 0 },
  ...o,
});

describe('a measurement in the pane (M14-08)', () => {
  it('has its value in its scale and in millimetres', () => {
    const e = measureEntry(input({ points: line(20), scale: s100 }));
    expect(e.value).toBeCloseTo(2, 9); // 20 mm at 1:100 = 2 m
    expect(e.base).toBeCloseTo(2000, 6);
    expect(entryText(e, en)).toBe('2.00 m');
    expect(e.paper).toBe(false);
  });

  it('an area is in unit² and mm²', () => {
    const e = measureEntry(input({ tool: 'area', points: rect(200, 100), scale: s100 }));
    expect(e.quantity).toBe('area');
    expect(e.value).toBeCloseTo(200, 6); // 20 m × 10 m
    expect(e.base).toBeCloseTo(200e6, 0);
    expect(entryText(e, en)).toBe('200.00 m²');
  });

  it('a perimeter adds its closing edge (its points repeat the first)', () => {
    const pts = rect(10, 10);
    const e = measureEntry(input({ tool: 'perimeter', points: [...pts, must(pts[0])], scale: s5 }));
    expect(e.value).toBeCloseTo(200, 6); // 40 mm paper at 1:5
  });

  it('spanning two scales: no number, flagged (Q30)', () => {
    const e = measureEntry(input({ spans: ['Detail A', '(page)'] }));
    expect(e.value).toBeNull();
    expect(e.base).toBeNull();
    expect(entryText(e, en)).toBeNull();
    expect(e.spans).toEqual(['Detail A', '(page)']);
  });

  it('no scale or 1 : 1 is paper size (Q29)', () => {
    expect(isPaperScale(null)).toBe(true);
    expect(isPaperScale(oneToOne)).toBe(true);
    expect(isPaperScale({ ...oneToOne, unit: 'in' })).toBe(true);
    expect(isPaperScale(s100)).toBe(false);
    const e = measureEntry(input({ points: line(25), scale: null }));
    expect(e.paper).toBe(true);
    expect(entryText(e, en)).toBe('25.0 mm');
  });

  it('keeps a label, trimmed', () => {
    expect(measureEntry(input({ label: '  Wall W1 ' })).label).toBe('Wall W1');
    expect(measureEntry(input({})).label).toBe('');
  });
});

describe('totals with units (M14-08)', () => {
  it('adds lengths in different units in the unit most of them use', () => {
    const list = [
      measureEntry(input({ points: line(20), scale: s100 })), // 2 m
      measureEntry(input({ points: line(10), scale: s100 })), // 1 m
      measureEntry(input({ points: line(100), scale: s5 })), // 500 mm
    ];
    const sum = sumOf(list);
    expect(sum?.scale.unit).toBe('m');
    expect(sum?.count).toBe(3);
    expect(sumValue(must(sum), 'length')).toBeCloseTo(3.5, 9);
    expect(sumText(must(sum), 'length', en)).toBe('3.50 m');
  });

  it('a tie keeps the first unit', () => {
    const list = [
      measureEntry(input({ points: line(100), scale: s5 })), // 500 mm
      measureEntry(input({ points: line(20), scale: s100 })), // 2 m
    ];
    expect(sumText(must(sumOf(list)), 'length', en)).toBe('2,500.0 mm');
  });

  it('adds areas through mm² (m² and cm² together)', () => {
    const list = [
      measureEntry(input({ tool: 'area', points: rect(200, 100), scale: s100 })), // 200 m²
      measureEntry(input({ tool: 'area', points: rect(20, 20), scale: s50cm })), // 1000 × 1000 cm = 1 m²
      measureEntry(input({ tool: 'area', points: rect(10, 10), scale: s100 })), // 1 m²
    ];
    const sum = must(sumOf(list));
    expect(sum.scale.unit).toBe('m');
    expect(sumValue(sum, 'area')).toBeCloseTo(202, 6);
    expect(sumText(sum, 'area', en)).toBe('202.00 m²');
  });

  it('shows feet as ft-in when that scale does', () => {
    // 1 inch paper at 1:48 = 4 ft; twice = 8 ft.
    const list = [
      measureEntry(input({ points: line(25.4), scale: ft })),
      measureEntry(input({ points: line(25.4), scale: ft })),
    ];
    expect(sumText(must(sumOf(list)), 'length', en)).toBe(`8'-0"`);
  });

  it('keeps paper-size values apart and leaves spanning ones out', () => {
    const list = [
      measureEntry(input({ points: line(20), scale: s100 })), // 2 m
      measureEntry(input({ points: line(30), scale: null })), // 30 mm paper
      measureEntry(input({ points: line(5), scale: oneToOne })), // 5 mm paper
      measureEntry(input({ spans: ['Detail A', '(page)'] })),
    ];
    const total = totalOf(list);
    expect(sumText(must(total.real), 'length', en)).toBe('2.00 m');
    expect(total.real?.count).toBe(1);
    expect(sumText(must(total.paper), 'length', en)).toBe('35.0 mm');
    expect(total.left).toBe(1);
  });

  it('no values: no sums', () => {
    const total = totalOf([measureEntry(input({ spans: ['A', 'B'] }))]);
    expect(total).toEqual({ real: null, paper: null, left: 1 });
  });
});

describe('groups (M14-08)', () => {
  const list = [
    measureEntry(input({ id: 'a2', tool: 'area', page: 1, points: rect(10, 10) })),
    measureEntry(input({ id: 'l3', page: 1, at: { x: 10, y: 50 } })),
    measureEntry(input({ id: 'l2', page: 0, at: { x: 90, y: 20 } })),
    measureEntry(input({ id: 'l1', page: 0, at: { x: 10, y: 20 } })),
    measureEntry(input({ id: 'p1', tool: 'polylength', page: 2 })),
  ];

  it('one per tool in the ribbon order, each in page order with its total', () => {
    const groups = groupMeasurements(list);
    expect(groups.map((g) => g.tool)).toEqual(['length', 'polylength', 'area']);
    expect(groups[0]?.entries.map((e) => e.id)).toEqual(['l1', 'l2', 'l3']);
    expect(groups[0]?.total.real?.count).toBe(3);
    expect(sumText(must(groups[0]?.total.real), 'length', en)).toBe('3.00 m');
    expect(groups[2]?.quantity).toBe('area');
  });

  it('This page: only that page, with its own totals', () => {
    const groups = groupMeasurements(list, { page: 1 });
    expect(groups.map((g) => g.tool)).toEqual(['length', 'area']);
    expect(groups[0]?.entries.map((e) => e.id)).toEqual(['l3']);
    expect(sumText(must(groups[0]?.total.real), 'length', en)).toBe('1.00 m');
    expect(groupMeasurements(list, { page: 5 })).toEqual([]);
  });
});

describe('Angle, Radius and Diameter in the pane (M14-05)', () => {
  const corner = [
    { x: 200, y: 100 },
    { x: 100, y: 100 },
    { x: 100, y: 0 },
  ];
  it('an angle is in degrees, never at paper size or spanning, with no total', () => {
    const a = measureEntry(
      input({ tool: 'angle', points: corner, scale: null, spans: ['A', 'B'] }),
    );
    expect(a.value).toBeCloseTo(90, 9);
    expect(a.paper).toBe(false);
    expect(a.spans).toBeNull();
    expect(entryText(a, en)).toBe('90.0°');
    const [g] = groupMeasurements([a]);
    expect(g?.tool).toBe('angle');
    expect(g?.total).toEqual({ real: null, paper: null, left: 0 });
  });

  it('a radius and a diameter are lengths in the scale, listed after Area, with no total', () => {
    const r = measureEntry(input({ tool: 'radius', points: line(10) }));
    expect(entryText(r, en)).toBe('1.00 m');
    const d = measureEntry(input({ tool: 'diameter', points: line(10) }));
    expect(entryText(d, en)).toBe('2.00 m');
    const area = measureEntry(input({ tool: 'area', points: rect(10, 10) }));
    const groups = groupMeasurements([d, r, area]);
    expect(groups.map((g) => g.tool)).toEqual(['area', 'radius', 'diameter']);
    expect(groups[1]?.total.real).toBeNull();
  });

  it('three points in a line: no value', () => {
    const e = measureEntry(input({ tool: 'radius', points: [...line(10), { x: 300, y: 100 }] }));
    expect(e.value).toBeNull();
  });
});
