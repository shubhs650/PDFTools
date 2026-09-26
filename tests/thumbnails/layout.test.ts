import { describe, expect, it } from 'vitest';
import { itemAt, thumbLayout, visibleRange } from '../../src/features/thumbnails/layout';

// Thumbnail list geometry (M2-08).

const opts = { width: 100, labelHeight: 20, gap: 10 };

describe('thumbnail layout', () => {
  it('stacks items at the thumbnail width, aspect kept, with labels and gaps', () => {
    const l = thumbLayout(
      [
        { width: 200, height: 300 },
        { width: 300, height: 200 },
      ],
      opts,
    );
    expect([...l.imageHeights]).toEqual([150, 67]);
    expect([...l.tops]).toEqual([10, 190, 287]);
  });

  it('finds the item at a position and the range to render', () => {
    const l = thumbLayout(
      Array.from({ length: 2000 }, () => ({ width: 100, height: 100 })),
      opts,
    ); // each item 130 px incl. gap
    expect(itemAt(l, 0)).toBe(0);
    expect(itemAt(l, 139)).toBe(0);
    expect(itemAt(l, 141)).toBe(1);
    expect(itemAt(l, 1e9)).toBe(1999);
    expect(visibleRange(l, 1300, 400, 2)).toEqual([7, 15]); // items 9..13 in view
    expect(visibleRange(l, 0, 400, 2)).toEqual([0, 5]);
    expect(visibleRange(thumbLayout([], opts), 0, 400)).toEqual([0, -1]);
  });
});
