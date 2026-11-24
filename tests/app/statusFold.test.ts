import { describe, expect, it } from 'vitest';
import { nextFold } from '../../src/app/statusFold';

// The status bar's fold (M13-04, D-70): view modes fold into a menu before any
// status toggle loses its words; it unfolds once the wider level fits again.

describe('nextFold', () => {
  it('stays unfolded while everything fits', () => {
    expect(nextFold(0, 500, [480])).toBe(0);
    expect(nextFold(0, 500, [500])).toBe(0);
  });

  it('folds the view modes first, then the words, one level at a time', () => {
    expect(nextFold(0, 400, [480])).toBe(1);
    expect(nextFold(1, 400, [480, 420])).toBe(2);
    expect(nextFold(1, 430, [480, 420])).toBe(1);
  });

  it('never folds past the words', () => {
    expect(nextFold(2, 100, [480, 420, 300])).toBe(2);
  });

  it('unfolds when the level below needed no more than the room it has now', () => {
    expect(nextFold(2, 425, [480, 420, 300])).toBe(1);
    expect(nextFold(1, 480, [480, 420])).toBe(0);
    expect(nextFold(1, 479, [480, 420])).toBe(1);
  });

  it('a level not measured yet is left alone', () => {
    expect(nextFold(1, 2000, [undefined, 420])).toBe(1);
  });
});
