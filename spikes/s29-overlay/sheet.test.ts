import { describe, expect, it } from 'vitest';
import { mul, similarity, type Matrix } from './pdfiumKit';
import { displayToOutUser, tileMatrix, userToDisplay } from './sheet';

const apply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

describe('userToDisplay', () => {
  const box = [10, 20, 110, 70] as const; // 100 × 50, offset
  it('rotation 0: top-left of the crop box is the origin', () => {
    expect(apply(userToDisplay(0, box), 10, 70)).toEqual([0, 0]);
    expect(apply(userToDisplay(0, box), 110, 20)).toEqual([100, 50]);
  });
  it('rotation 90: the lower-left corner goes to the top-left', () => {
    expect(apply(userToDisplay(1, box), 10, 20)).toEqual([0, 0]);
    expect(apply(userToDisplay(1, box), 10, 70)).toEqual([50, 0]);
    expect(apply(userToDisplay(1, box), 110, 20)).toEqual([0, 100]);
  });
  it('rotation 180 and 270', () => {
    expect(apply(userToDisplay(2, box), 110, 20)).toEqual([0, 0]);
    expect(apply(userToDisplay(3, box), 110, 70)).toEqual([0, 0]);
    expect(apply(userToDisplay(3, box), 10, 70)).toEqual([0, 100]);
  });
  it('folds into the overlay page (y up) and keeps an alignment', () => {
    const m = mul(mul(userToDisplay(0, box), similarity(2, 0, 5, 5)), displayToOutUser(200));
    expect(apply(m, 10, 70)).toEqual([5, 195]);
  });
});

describe('tileMatrix', () => {
  it('is zoom then the tile offset, with A carried into B first', () => {
    expect(apply(tileMatrix(4, 100, 40), 30, 20)).toEqual([20, 40]);
    const aToB = similarity(0.5, 0, 10, 0);
    expect(apply(tileMatrix(4, 0, 0, aToB), 20, 8)).toEqual(apply(tileMatrix(4, 0, 0), 20, 4));
  });
});
