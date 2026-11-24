import { describe, expect, it } from 'vitest';
import { plainNumber, plainNumbers } from '../../src/model/pdf/plainNumbers';

// M13-04: PDFium writes an arrow head's turn as "8.74228e-08" on an exactly level or
// upright line; PDF numbers have no exponent, so the head vanished. Rewritten plain.

describe('plainNumbers', () => {
  it('rewrites the arrow head turn PDFium writes for a level line', () => {
    const ap =
      '/GS gs\n1 w 100 742 m 300 742 l S\nq -1 8.74228e-08 -8.74228e-08 -1 100 742 cm\n-7.79423 4.5 m 0 0 l -7.79423 -4.5 l S\nQ\n';
    const r = plainNumbers(ap);
    expect(r.changed).toBe(true);
    expect(r.content).toContain('q -1 0 0 -1 100 742 cm');
    expect(r.content).toContain('-7.79423 4.5 m 0 0 l -7.79423 -4.5 l S');
  });

  it('keeps larger values and upright lines exact to 6 decimals', () => {
    expect(plainNumbers('6.12323e-17 1 -1 6.12323e-17 10 20 cm').content).toBe('0 1 -1 0 10 20 cm');
    expect(plainNumbers('1.5E+3 2.5e-3 Td').content).toBe('1500 0.0025 Td');
  });

  it('leaves strings, hex strings, comments and names alone', () => {
    const s = '(1e-5 mm \\) 2e3) Tj <1e3f> Tj % 3e-3\n/1e5 gs /P <</A 2e2>> BDC 4e-9 w';
    expect(plainNumbers(s).content).toBe(
      '(1e-5 mm \\) 2e3) Tj <1e3f> Tj % 3e-3\n/1e5 gs /P <</A 200>> BDC 0 w',
    );
  });

  it('nothing to do: the same string, unchanged', () => {
    const s = '1 0 -0 1 300 742 cm 0.5 w';
    expect(plainNumbers(s)).toEqual({ content: s, changed: false });
  });
});

describe('plainNumber', () => {
  it('six decimals at most, no trailing zeros, never -0', () => {
    expect(plainNumber(-8.74228e-8)).toBe('0');
    expect(plainNumber(0.1234567)).toBe('0.123457');
    expect(plainNumber(12)).toBe('12');
    expect(plainNumber(-2.5)).toBe('-2.5');
  });
});
