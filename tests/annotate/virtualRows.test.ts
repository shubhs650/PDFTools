import { describe, expect, it } from 'vitest';
import {
  indexAt,
  offsetsOf,
  pageFrom,
  scrollToShow,
  visibleRange,
} from '../../src/features/annotate/comments/virtualRows';

// M6-05: the Comments pane's measured (variable-height) virtualization.

describe('variable-height rows (M6-05)', () => {
  const tops = offsetsOf([30, 80, 50, 50, 120, 30]);

  it('sums heights into row tops, the last entry the total', () => {
    expect([...tops]).toEqual([0, 30, 110, 160, 210, 330, 360]);
    expect([...offsetsOf([])]).toEqual([0]);
  });

  it('finds the row at a height, clamped to the rows', () => {
    expect(indexAt(tops, 0)).toBe(0);
    expect(indexAt(tops, 29.9)).toBe(0);
    expect(indexAt(tops, 30)).toBe(1);
    expect(indexAt(tops, 209)).toBe(3);
    expect(indexAt(tops, 10_000)).toBe(5);
    expect(indexAt(tops, -5)).toBe(0);
    expect(indexAt(offsetsOf([]), 10)).toBe(0);
  });

  it('draws the rows in view plus the overscan', () => {
    expect(visibleRange(tops, 100, 100, 0)).toEqual([1, 3]);
    expect(visibleRange(tops, 100, 100, 1)).toEqual([0, 4]);
    expect(visibleRange(tops, 0, 1000, 2)).toEqual([0, 5]);
    expect(visibleRange(offsetsOf([]), 0, 100, 2)).toEqual([0, -1]);
  });

  it('scrolls just enough to show a row, its top when taller than the view', () => {
    expect(scrollToShow(tops, 2, 0, 200)).toBe(0); // 110–160 already in view
    expect(scrollToShow(tops, 4, 0, 200)).toBe(130); // bottom 330 at the view's bottom
    expect(scrollToShow(tops, 0, 100, 200)).toBe(0);
    expect(scrollToShow(tops, 4, 0, 100)).toBe(210); // 120 px card in a 100 px view
    expect(scrollToShow(tops, 9, 42, 100)).toBe(42);
  });

  it('pages by about a view, at least one row', () => {
    expect(pageFrom(tops, 0, 200, 1)).toBe(3);
    expect(pageFrom(tops, 5, 200, -1)).toBe(2);
    expect(pageFrom(tops, 4, 20, 1)).toBe(5);
    expect(pageFrom(tops, 0, 200, -1)).toBe(0);
  });
});
