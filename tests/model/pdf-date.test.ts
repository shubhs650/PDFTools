import { describe, expect, it } from 'vitest';
import { parsePdfDate } from '../../src/model/pdfDate';

// PDF date strings (M2-11, M2-12).

describe('parsePdfDate', () => {
  it('reads full dates with offsets', () => {
    expect(parsePdfDate("D:20240131235959+01'00'")?.toISOString()).toBe('2024-01-31T22:59:59.000Z');
    expect(parsePdfDate("D:20240131120000-05'30'")?.toISOString()).toBe('2024-01-31T17:30:00.000Z');
    expect(parsePdfDate('D:20240131120000Z')?.toISOString()).toBe('2024-01-31T12:00:00.000Z');
    expect(parsePdfDate('D:20240131120000+0530')?.toISOString()).toBe('2024-01-31T06:30:00.000Z');
  });

  it('fills missing parts and accepts no prefix', () => {
    expect(parsePdfDate('D:2024')?.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(parsePdfDate('20240315')?.toISOString()).toBe('2024-03-15T00:00:00.000Z');
  });

  it('rejects what is not a date', () => {
    for (const s of ['', null, undefined, 'yesterday', 'D:20241301', 'D:2024013125']) {
      expect(parsePdfDate(s)).toBeNull();
    }
  });
});
