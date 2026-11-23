// M12-19 (D-64): the text comparison view's model. The list's entries (a
// move's inner edits after it), the marks by colour and shape on each side,
// the content-sync curve (monotone, an inserted page does not throw the
// sides out of step), the bands' places, and the list's filters, search,
// checked tick and next / previous.
import { describe, expect, it } from 'vitest';
import type { TextChange, TextComparison, TextSpan } from '../../src/model/compare/text/match';
import {
  DEFAULT_FILTER,
  countByStyle,
  entriesOf,
  entryPlaces,
  mapAlong,
  marksBySide,
  pageAtY,
  pageMap,
  shapesOf,
  stepEntry,
  styleOf,
  syncCurve,
  visibleEntries,
  type PageStack,
} from '../../src/model/compare/textView';

const span = (page: number, text: string, y0: number, y1 = y0 + 10): TextSpan => ({
  page,
  text,
  t0: 0,
  t1: 1,
  rects: [{ page, x0: 50, y0, x1: 200, y1 }],
});

const result = (changes: TextChange[], sync: number[] = []): TextComparison => ({
  changes,
  sync: Float32Array.from(sync),
  limited: { a: [], b: [] },
  scanned: { a: [], b: [] },
  stats: { units: [0, 0], tokens: [0, 0], matched: 0, ms: 0 },
});

/** Pages of 800 pt with a 10 pt gap. */
const stack = (n: number, h = 800, gap = 10): PageStack => ({
  tops: Array.from({ length: n }, (_, i) => i * (h + gap)),
  heights: Array.from({ length: n }, () => h),
});

const same = { a: pageMap([0, 1, 2, 3, 4]), b: pageMap([0, 1, 2, 3, 4]) };

describe('entries and marks', () => {
  it('groups the kinds into the legend and lists a move with its inner edits after it', () => {
    expect(styleOf('header')).toBe('replaced');
    expect(styleOf('reference')).toBe('replaced');
    expect(styleOf('renumbered')).toBe('replaced');
    expect(styleOf('figure')).toBe('figure');
    const r = result([
      { kind: 'inserted', b: span(0, 'new words', 100) },
      {
        kind: 'moved',
        a: span(0, 'block', 300, 340),
        b: span(1, 'block', 50, 90),
        inner: [{ kind: 'replaced', a: span(0, '10', 310), b: span(1, '12', 60), pct: 20 }],
      },
      { kind: 'deleted', a: span(1, 'gone', 400) },
    ]);
    const e = entriesOf(r);
    expect(e.map((x) => [x.style, x.parent])).toEqual([
      ['inserted', null],
      ['moved', null],
      ['replaced', 1],
      ['deleted', null],
    ]);
    expect(countByStyle(e)).toEqual({ deleted: 1, inserted: 1, replaced: 1, moved: 1, figure: 0 });
    expect(entriesOf(null)).toEqual([]);
  });

  it('marks deleted struck on A, inserted underlined on B, replaced on both, moved filled, figures framed', () => {
    expect(shapesOf('deleted')).toEqual({ a: 'strike', b: null });
    expect(shapesOf('inserted')).toEqual({ a: null, b: 'underline' });
    expect(shapesOf('replaced')).toEqual({ a: 'strike', b: 'underline' });
    expect(shapesOf('moved')).toEqual({ a: 'fill', b: 'fill' });
    expect(shapesOf('figure')).toEqual({ a: 'frame', b: 'frame' });
    const r = result([
      { kind: 'replaced', a: span(0, 'old', 100), b: span(0, 'new', 120) },
      {
        kind: 'moved',
        a: span(1, 'm', 300, 340),
        b: span(2, 'm', 50, 90),
        inner: [{ kind: 'inserted', b: span(2, 'x', 60) }],
      },
    ]);
    // Side page 0 of A is document page 3 (a page range "4-5").
    const m = marksBySide(entriesOf(r), { a: pageMap([3, 4]), b: pageMap([0, 1, 2]) });
    expect(m.a.get(3)?.map((x) => x.shape)).toEqual(['strike']);
    expect(m.a.get(4)?.map((x) => [x.shape, x.style])).toEqual([['fill', 'moved']]);
    expect(m.b.get(0)?.map((x) => x.shape)).toEqual(['underline']);
    // The inner edit is drawn after (over) the move's fill.
    expect(m.b.get(2)?.map((x) => x.shape)).toEqual(['fill', 'underline']);
  });
});

describe('content sync', () => {
  it('maps a place between sync points by its share of the distance', () => {
    const st = { a: stack(3), b: stack(3) };
    // Paragraph at A p1 y100 ↔ B p1 y200, A p2 y100 ↔ B p2 y100.
    const c = syncCurve(
      Float32Array.from([0, 100, 0, 100, 1, 100, 1, 200, 2, 100, 2, 100]),
      st,
      same,
    );
    expect(Array.from(c.a)).toEqual([100, 910, 1720]);
    expect(Array.from(c.b)).toEqual([100, 1010, 1720]);
    expect(mapAlong(c, 'a', 910)).toBe(1010);
    expect(mapAlong(c, 'b', 1010)).toBe(910);
    // Half way between the first two points.
    expect(mapAlong(c, 'a', 505)).toBeCloseTo(555);
    // Before the first and after the last: the nearest point's offset.
    expect(mapAlong(c, 'a', 50)).toBe(50);
    expect(mapAlong(c, 'a', 2000)).toBe(2000);
    // No points: the same place.
    expect(mapAlong({ a: new Float64Array(), b: new Float64Array() }, 'b', 42)).toBe(42);
  });

  it('keeps an inserted page from throwing the sides out of step', () => {
    // B has a new page 1; A's page 1 is B's page 2.
    const st = { a: stack(2), b: stack(3) };
    const c = syncCurve(Float32Array.from([0, 100, 0, 100, 1, 100, 2, 100]), st, same);
    // The middle of A's page 1 is the middle of B's page 2.
    const g = mapAlong(c, 'a', 810 + 400);
    expect(pageAtY(st.b, g)).toEqual({ page: 2, y: 400 });
  });

  it('drops the points of a moved paragraph that would fold the curve back', () => {
    const st = { a: stack(3), b: stack(3) };
    const c = syncCurve(
      Float32Array.from([
        0, 100, 0, 100, 0, 500, 2, 600 /* moved far down */, 1, 100, 1, 100, 2, 100, 2, 100,
      ]),
      st,
      same,
    );
    expect(Array.from(c.a)).toEqual([100, 910, 1720]);
    expect(Array.from(c.b)).toEqual([100, 910, 1720]);
  });

  it('finds the page under a place in the stack', () => {
    const st = stack(3);
    expect(pageAtY(st, 0)).toEqual({ page: 0, y: 0 });
    expect(pageAtY(st, 805)).toEqual({ page: 0, y: 805 });
    expect(pageAtY(st, 810)).toEqual({ page: 1, y: 0 });
    expect(pageAtY(st, 5000)).toEqual({ page: 2, y: 5000 - 1620 });
  });
});

describe('bands', () => {
  it('places a change on both sides; an insertion points at where it would have been', () => {
    const st = { a: stack(2), b: stack(2) };
    const c = syncCurve(Float32Array.from([0, 0, 0, 0, 1, 0, 1, 50]), st, same);
    expect(
      entryPlaces({ kind: 'replaced', a: span(0, 'a', 100), b: span(0, 'b', 120) }, st, same, c),
    ).toEqual({ a: { top: 100, bottom: 110 }, b: { top: 120, bottom: 130 } });
    const ins = entryPlaces({ kind: 'inserted', b: span(1, 'new', 300) }, st, same, c);
    expect(ins?.b).toEqual({ top: 1110, bottom: 1120 });
    // B 1115 is 50 pt below the last point's place on B: A 1065.
    expect(ins?.a).toEqual({ top: 1065, bottom: 1065 });
    const del = entryPlaces({ kind: 'deleted', a: span(0, 'x', 400) }, st, same, c);
    expect(del?.a).toEqual({ top: 400, bottom: 410 });
    expect(del?.b.top).toBeCloseTo(405 + (405 / 810) * 50);
  });
});

describe('the list', () => {
  const r = result([
    { kind: 'inserted', b: span(0, 'Pump P-101A added', 100) },
    { kind: 'deleted', a: span(0, 'Valve V-12', 200) },
    { kind: 'replaced', a: span(0, '1,450.00 mm', 300), b: span(0, '1,500.00 mm', 300) },
    { kind: 'moved', a: span(1, 'Clause 4', 50), b: span(0, 'Clause 4', 600) },
  ]);
  const entries = entriesOf(r);

  it('filters by kind, search (case and width folded) and the checked tick', () => {
    expect(visibleEntries(entries, DEFAULT_FILTER, new Set())).toEqual([0, 1, 2, 3]);
    const noDel = { ...DEFAULT_FILTER, styles: { ...DEFAULT_FILTER.styles, deleted: false } };
    expect(visibleEntries(entries, noDel, new Set())).toEqual([0, 2, 3]);
    expect(visibleEntries(entries, { ...DEFAULT_FILTER, query: 'ｐ-101a' }, new Set())).toEqual([
      0,
    ]);
    expect(visibleEntries(entries, { ...DEFAULT_FILTER, query: '1,450' }, new Set())).toEqual([2]);
    expect(
      visibleEntries(entries, { ...DEFAULT_FILTER, hideChecked: true }, new Set([1, 2])),
    ).toEqual([0, 3]);
  });

  it('steps to the next and previous entry, wrapping round', () => {
    const v = [0, 2, 3];
    expect(stepEntry(v, null, 1)).toBe(0);
    expect(stepEntry(v, null, -1)).toBe(3);
    expect(stepEntry(v, 0, 1)).toBe(2);
    // From an entry the filter hides: the next one shown.
    expect(stepEntry(v, 1, 1)).toBe(2);
    expect(stepEntry(v, 1, -1)).toBe(0);
    expect(stepEntry(v, 3, 1)).toBe(0);
    expect(stepEntry(v, 0, -1)).toBe(3);
    expect(stepEntry([], 0, 1)).toBeNull();
  });
});
