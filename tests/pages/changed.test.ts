import { describe, expect, it } from 'vitest';
import { changedPages } from '../../src/features/pages/changed';

// M4-09/M4-20: only pages whose identity changed are
// refreshed — each refreshed page costs a text-geometry job in the Work worker.

const page = (objectNumber: number, rotation: 0 | 1 | 2 | 3 = 0, width = 595) => ({
  objectNumber,
  rotation,
  size: { width, height: 842 },
});

describe('changedPages', () => {
  const before = [page(3), page(5), page(7), page(9)];

  it('a rotation or a resize refreshes that page only', () => {
    expect(changedPages(before, [page(3), page(5, 1), page(7), page(9)])).toEqual([1]);
    expect(changedPages(before, [page(3), page(5), page(7, 0, 612), page(9)])).toEqual([2]);
  });

  it('a move or a delete refreshes every index that holds another page', () => {
    expect(changedPages(before, [page(3), page(7), page(5), page(9)])).toEqual([1, 2]);
    expect(changedPages(before, [page(5), page(7), page(9)])).toEqual([0, 1, 2]);
    expect(changedPages(before, [...before, page(11)])).toEqual([4]);
  });

  it('copied comments change no page identity: nothing is refreshed', () => {
    expect(changedPages(before, before)).toEqual([]);
  });
});
