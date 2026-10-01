import { describe, expect, it } from 'vitest';
import { dropIndex, moveByOne, moveTo, movedRange } from '../../src/features/pages/move';

// M4-10: reorder arithmetic (FPDF_MovePages' `to` from an insertion point).

describe('moveTo', () => {
  it('moves pages forward and backward', () => {
    // 6 pages; move 1 and 2 (indexes) before page index 5 → they land at 3, 4.
    expect(moveTo([1, 2], 5, 6)).toBe(3);
    // Move the last page to the front.
    expect(moveTo([5], 0, 6)).toBe(0);
    // To the end.
    expect(moveTo([0], 6, 6)).toBe(5);
  });
  it('is null when nothing changes or everything is selected', () => {
    expect(moveTo([2, 3], 2, 6)).toBeNull();
    expect(moveTo([2, 3], 4, 6)).toBeNull(); // the gap right after them
    expect(moveTo([0, 1, 2], 1, 3)).toBeNull();
    expect(moveTo([], 1, 3)).toBeNull();
  });
  it('gathers a scattered selection', () => {
    expect(moveTo([0, 4], 3, 6)).toBe(2);
    expect(movedRange([0, 4], 2)).toEqual([2, 3]);
  });
});

describe('moveByOne', () => {
  it('moves a contiguous selection by one place, stops at the edges', () => {
    expect(moveByOne([2, 3], 1, 6)).toBe(3);
    expect(moveByOne([2, 3], -1, 6)).toBe(1);
    expect(moveByOne([0], -1, 6)).toBeNull();
    expect(moveByOne([4, 5], 1, 6)).toBeNull();
  });
  it('first gathers a scattered selection at its first page', () => {
    expect(moveByOne([1, 4], 1, 6)).toBe(1);
  });
});

describe('dropIndex', () => {
  it('drops before the item whose middle is below the pointer', () => {
    const tops = [0, 100, 200, 300];
    expect(dropIndex(tops, 10)).toBe(0);
    expect(dropIndex(tops, 60)).toBe(1);
    expect(dropIndex(tops, 180)).toBe(2);
    expect(dropIndex(tops, 290)).toBe(3);
  });
});
