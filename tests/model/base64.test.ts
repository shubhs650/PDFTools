import { describe, expect, it } from 'vitest';
import { fromBase64, isBase64, toBase64 } from '../../src/model/base64';

// M8-01 (ADR-025): base64 for the comments PDF inside a JSON v2 export.

describe('base64', () => {
  it('round-trips bytes of every value and of any length, chunk boundaries included', () => {
    for (const n of [0, 1, 2, 3, 255, 0x8000 - 1, 0x8000, 0x8000 + 1, 100_001]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 256);
      const s = toBase64(bytes);
      expect(s).toBe(Buffer.from(bytes).toString('base64'));
      expect(isBase64(s)).toBe(true);
      expect(fromBase64(s)).toEqual(bytes);
    }
  });

  it('refuses what is not padded, standard base64', () => {
    for (const s of ['abc', 'ab=c', 'a-b_', 'QUJD\n', 'QUJD====', 'QU JD'])
      expect(fromBase64(s)).toBeNull();
  });
});
