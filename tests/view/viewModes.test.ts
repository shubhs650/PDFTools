import { describe, expect, it } from 'vitest';
import {
  VIEW_MODES,
  clampToRange,
  fromQuarterTurns,
  isFacing,
  isPaged,
  pagedScrollRange,
  rotateView,
  spreadIndexOf,
  spreadsFor,
  toQuarterTurns,
  unionSpan,
} from '../../src/features/view/viewModes';
import { fitVisibleZoom, rotateBox } from '../../src/features/view/zoom';

describe('view modes (M1-16)', () => {
  it('has the four §5 modes; two are paged, two are facing', () => {
    expect(VIEW_MODES).toEqual(['single', 'continuous', 'facing', 'continuousFacing']);
    expect(VIEW_MODES.filter(isPaged)).toEqual(['single', 'facing']);
    expect(VIEW_MODES.filter(isFacing)).toEqual(['facing', 'continuousFacing']);
  });

  it('groups single pages', () => {
    expect(spreadsFor(3, false)).toEqual([[0], [1], [2]]);
    expect(spreadsFor(0, false)).toEqual([]);
  });

  it('pairs facing pages for even and odd page counts', () => {
    expect(spreadsFor(4, true)).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(spreadsFor(5, true)).toEqual([[0, 1], [2, 3], [4]]);
    expect(spreadsFor(1, true)).toEqual([[0]]);
  });

  it('with a cover page, page 1 stands alone', () => {
    expect(spreadsFor(4, true, true)).toEqual([[0], [1, 2], [3]]);
    expect(spreadsFor(5, true, true)).toEqual([[0], [1, 2], [3, 4]]);
    expect(spreadsFor(3, false, true)).toEqual([[0], [1], [2]]); // cover only matters when facing
  });

  it('finds the spread of a page', () => {
    const s = spreadsFor(5, true);
    expect(spreadIndexOf(s, 0)).toBe(0);
    expect(spreadIndexOf(s, 3)).toBe(1);
    expect(spreadIndexOf(s, 4)).toBe(2);
    expect(spreadIndexOf(s, 99)).toBe(0);
  });
});

describe('paged scroll range', () => {
  it('holds a tall spread between its top and its bottom', () => {
    const r = pagedScrollRange({ top: 1000, bottom: 3000 }, 800, 10);
    expect(r).toEqual({ top: 990, bottom: 2210 });
    expect(clampToRange(500, r)).toBe(990);
    expect(clampToRange(5000, r)).toBe(2210);
    expect(clampToRange(1500, r)).toBe(1500);
  });

  it('pins a spread shorter than the viewport to its top', () => {
    expect(pagedScrollRange({ top: 1000, bottom: 1400 }, 800, 10)).toEqual({
      top: 990,
      bottom: 990,
    });
  });

  it('uses the union of mixed-size pages in one spread', () => {
    expect(
      unionSpan([
        { top: 100, bottom: 900 },
        { top: 100, bottom: 1300 },
      ]),
    ).toEqual({ top: 100, bottom: 1300 });
    expect(unionSpan([])).toBeNull();
  });
});

describe('view rotation', () => {
  it('turns in 90° steps both ways', () => {
    expect(rotateView(0, 1)).toBe(90);
    expect(rotateView(270, 1)).toBe(0);
    expect(rotateView(0, -1)).toBe(270);
    expect(rotateView(180, -1)).toBe(90);
  });

  it('converts to and from EmbedPDF quarter turns', () => {
    expect(toQuarterTurns(270)).toBe(3);
    expect(fromQuarterTurns(1)).toBe(90);
    expect(fromQuarterTurns(5)).toBe(90);
    expect(fromQuarterTurns(-1)).toBe(270);
  });

  it('fit visible follows the rotated content (landscape content on a rotated portrait page)', () => {
    const page = { width: 600, height: 800 };
    const content = { left: 100, top: 50, right: 500, bottom: 750 }; // 400 wide, 700 tall
    expect(fitVisibleZoom(rotateBox(content, page, 0), 820, 10)).toBeCloseTo(2);
    expect(fitVisibleZoom(rotateBox(content, page, 90), 1420, 10)).toBeCloseTo(2);
    expect(fitVisibleZoom(rotateBox(content, page, 270), 1420, 10)).toBeCloseTo(2);
  });
});
