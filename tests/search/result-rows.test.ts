import { describe, expect, it } from 'vitest';
import { addBatch, emptyResults, fillPage } from '../../src/features/search/findModel';
import {
  buildRows,
  pagesWithoutContext,
  rowAt,
  rowOf,
  scrollMap,
  type DocGroup,
} from '../../src/features/search/resultRows';
import type { ExtraHit } from '../../src/workers/work/search';
import type { Hit } from '../../src/workers/work/searchCore';

// Advanced Search rows (M2-09): grouping and the virtual window's context requests.

const hit = (page: number, start: number): Hit => ({
  page,
  start,
  length: 1,
  before: 'b',
  match: 'm',
  after: 'a',
});
const extra = (source: ExtraHit['source'], page: number): ExtraHit => ({
  source,
  page,
  before: '',
  match: 'm',
  after: '',
});

describe('result rows', () => {
  it('groups by document, then extras, then pages in document order', () => {
    // Streamed out of order (visible page first) with a page past the context cap.
    let a = addBatch(emptyResults(), [hit(5, 0), hit(5, 9), hit(1, 3)], [[7, 2]]);
    const b = addBatch(emptyResults(), [hit(0, 1)], []);
    const groups: DocGroup[] = [
      { docId: 'A', results: a, extras: [extra('bookmark', 2)] },
      { docId: 'B', results: b, extras: [] },
    ];
    const ix = buildRows(groups, true);
    const rows = Array.from({ length: ix.count }, (_, i) => rowAt(ix, i));
    expect(
      rows.map((r) => (r ? `${r.kind}:${r.docId}${'page' in r ? `:${String(r.page)}` : ''}` : '-')),
    ).toEqual([
      'doc:A',
      'extra:A',
      'page:A:1',
      'hit:A:1',
      'page:A:5',
      'hit:A:5',
      'hit:A:5',
      'page:A:7',
      'hit:A:7',
      'hit:A:7',
      'doc:B',
      'page:B:0',
      'hit:B:0',
    ]);
    expect(rowAt(ix, 0)).toMatchObject({ kind: 'doc', count: 6 });
    expect(rowAt(ix, 6)).toMatchObject({ kind: 'hit', page: 5, index: 1, hit: { start: 9 } });
    expect(rowAt(ix, 8)).toMatchObject({ kind: 'hit', page: 7, index: 0, hit: null });
    expect(rowAt(ix, ix.count)).toBeNull();

    // The window over rows 7–9 needs page 7's context; once filled, nothing.
    expect(pagesWithoutContext(ix, 7, 9)).toEqual([{ docId: 'A', page: 7 }]);
    expect(pagesWithoutContext(ix, 0, 5)).toEqual([]);
    a = fillPage(a, 7, [hit(7, 0), hit(7, 4)]);
    const [ga, gb] = groups as [DocGroup, DocGroup];
    const filled = buildRows([{ ...ga, results: a }, gb], true);
    expect(pagesWithoutContext(filled, 0, filled.count)).toEqual([]);
    expect(rowAt(filled, 9)).toMatchObject({ hit: { start: 4 } });

    expect(rowOf(ix, 'A', 5, 1)).toBe(6);
    expect(rowOf(ix, 'B', 0, 0)).toBe(12);
    expect(rowOf(ix, 'B', 3, 0)).toBe(-1);
  });

  it('one document: no document header; empty groups add nothing', () => {
    const ix = buildRows(
      [
        { docId: 'A', results: addBatch(emptyResults(), [hit(0, 0)], []), extras: [] },
        { docId: 'B', results: emptyResults(), extras: [] },
      ],
      false,
    );
    expect(ix.count).toBe(2);
    expect(rowAt(ix, 0)).toMatchObject({ kind: 'page', page: 0 });
  });

  it('indexes 100,000 hits as segments and finds row 50,000 quickly', () => {
    const counts: [number, number][] = Array.from({ length: 2000 }, (_, p) => [p, 50]);
    const results = addBatch(emptyResults(), [], counts);
    const t0 = performance.now();
    const ix = buildRows([{ docId: 'A', results, extras: [] }], false);
    const r = rowAt(ix, 50_000);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(ix.count).toBe(2000 * 51);
    // Row 50,000: page 980 (980 × 51 = 49,980), its hit 19.
    expect(r).toMatchObject({ kind: 'hit', page: 980, index: 19 });
  });
});

describe('scrollMap', () => {
  it('is the identity while the rows fit', () => {
    const m = scrollMap(10_000, 500);
    expect(m.height).toBe(10_000);
    expect(m.toReal(1234)).toBe(1234);
  });

  it('maps a capped scroll range onto all rows, end to end', () => {
    const m = scrollMap(28_000_000, 500, 8_000_000);
    expect(m.height).toBe(8_000_000);
    expect(m.toReal(0)).toBe(0);
    // Scrolled to the bottom: the view shows the last rows.
    expect(m.toReal(8_000_000 - 500)).toBeCloseTo(28_000_000 - 500, 3);
    expect(m.toScroll(m.toReal(123_456))).toBeCloseTo(123_456, 6);
  });
});
