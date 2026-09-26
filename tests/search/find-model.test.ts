import { describe, expect, it } from 'vitest';
import {
  addBatch,
  emptyResults,
  fillPage,
  firstFrom,
  ordinal,
  step,
} from '../../src/features/search/findModel';
import type { Hit } from '../../src/workers/work/searchCore';

// Quick Find navigation (M2-07): document order whatever the stream order.

const hit = (page: number, start: number): Hit => ({
  page,
  start,
  length: 1,
  before: '',
  match: 'x',
  after: '',
});

describe('find model', () => {
  // Streamed visible-first: page 5, then 7, then wrapping to 1.
  const r = addBatch(
    addBatch(emptyResults(), [hit(5, 0), hit(5, 9), hit(7, 3)], []),
    [hit(1, 2)],
    [],
  );

  it('groups hits by page and counts them', () => {
    expect(r.total).toBe(4);
    expect([...r.pages.keys()]).toEqual([5, 7, 1]);
    expect(r.pages.get(5)?.count).toBe(2);
  });

  it('starts at the first hit at or after the current page, wrapping', () => {
    expect(firstFrom(r, 6)).toEqual({ page: 7, index: 0 });
    expect(firstFrom(r, 8)).toEqual({ page: 1, index: 0 });
    expect(firstFrom(emptyResults(), 0)).toBeNull();
  });

  it('steps in document order and wraps both ways', () => {
    let c = { page: 1, index: 0 };
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      seen.push(`${String(c.page)}:${String(c.index)}`);
      c = step(r, c, 1) ?? c;
    }
    expect(seen).toEqual(['1:0', '5:0', '5:1', '7:0', '1:0']);
    expect(step(r, { page: 1, index: 0 }, -1)).toEqual({ page: 7, index: 0 });
    expect(step(r, { page: 7, index: 0 }, -1)).toEqual({ page: 5, index: 1 });
  });

  it('numbers the current hit among all ("n of N")', () => {
    expect(ordinal(r, { page: 1, index: 0 })).toBe(1);
    expect(ordinal(r, { page: 5, index: 1 })).toBe(3);
    expect(ordinal(r, { page: 7, index: 0 })).toBe(4);
  });

  it('pages past the context cap arrive as counts and are filled later', () => {
    const capped = addBatch(r, [], [[9, 3]]);
    expect(capped.total).toBe(7);
    expect(capped.pages.get(9)).toEqual({ hits: null, count: 3 });
    expect(step(capped, { page: 7, index: 0 }, 1)).toEqual({ page: 9, index: 0 });
    const filled = fillPage(capped, 9, [hit(9, 1), hit(9, 4), hit(9, 8)]);
    expect(filled.pages.get(9)?.hits).toHaveLength(3);
    expect(filled.total).toBe(7);
    expect(ordinal(filled, { page: 9, index: 2 })).toBe(7);
  });
});
