import { describe, expect, it } from 'vitest';
import { subsetTagOf } from '../../src/workers/render/commentFonts/appearance';

// M11-07: a subset font's name starts with six capital letters and "+"
// (PDF 32000-1 §9.6.4); anything else breaks /BaseFont in other viewers.
describe('subsetTagOf', () => {
  it('is six capital letters for any key, and stable', () => {
    for (let i = 0; i < 2000; i++) {
      const key = `Face-${String(i)}:${String(i % 7 ? 400 : '')}:${String(i * 31)},${String(i * 7)}`;
      expect(subsetTagOf(key)).toMatch(/^[A-Z]{6}$/u);
    }
    expect(subsetTagOf('Tinos-Regular::1,19,21')).toBe(subsetTagOf('Tinos-Regular::1,19,21'));
    expect(subsetTagOf('a')).not.toBe(subsetTagOf('b'));
  });
});
