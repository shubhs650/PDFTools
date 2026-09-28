import { describe, expect, it } from 'vitest';
import {
  contrastOnWhite,
  duplicateScheme,
  exportScheme,
  importScheme,
  MAX_FILE_BYTES,
  PRESETS,
  validateScheme,
  type StatusScheme,
} from '../../src/model/statusScheme';

const custom: StatusScheme = {
  id: 'c1',
  name: 'Site review',
  codes: [
    { code: 'OK', label: 'No comments', color: '#1e7a34' },
    { code: 'RR', label: 'Revise & resubmit', color: '#b3261e' },
  ],
};

describe('status schemes (M3-13, D-23)', () => {
  it('has the three presets, read-only, codes as data', () => {
    expect(PRESETS.map((p) => p.codes.map((c) => c.code).join(''))).toEqual([
      '1234',
      'ABCD',
      'APANRRRJFI',
    ]);
    expect(PRESETS.every((p) => p.preset)).toBe(true);
    expect(PRESETS.every((p) => p.codes.every((c) => c.labelKey && !c.label))).toBe(true);
  });

  it('duplicates a preset into an editable scheme with its labels', () => {
    const d = duplicateScheme(PRESETS[0] ?? custom, 'n1', (k) => `L:${k}`, 'Copy of 1–4');
    expect(d.preset).toBeUndefined();
    expect(d.id).toBe('n1');
    expect(d.codes[0]).toEqual({
      code: '1',
      label: 'L:schemes.preset.numeric.1',
      color: '#1e7a34',
    });
  });

  it('validates codes, labels, colours and duplicates', () => {
    expect(validateScheme(custom)).toEqual([]);
    expect(validateScheme({ ...custom, name: ' ' })).toContain('name');
    expect(validateScheme({ ...custom, codes: [] })).toContain('noCodes');
    expect(
      validateScheme({
        ...custom,
        codes: [...custom.codes, { code: 'ok', label: 'x', color: '#000000' }],
      }),
    ).toContain('duplicate');
    expect(
      validateScheme({
        ...custom,
        codes: [{ code: 'TOO-LONG-CODE', label: 'x', color: '#000000' }],
      }),
    ).toContain('code');
    expect(
      validateScheme({ ...custom, codes: [{ code: 'A', label: 'x', color: 'red' }] }),
    ).toContain('color');
    expect(
      validateScheme({ ...custom, codes: [{ code: 'A\u0000', label: 'x', color: '#000000' }] }),
    ).toContain('code');
  });

  it('checks colour contrast on the white page', () => {
    expect(contrastOnWhite('#000000')).toBeCloseTo(21, 0);
    expect(contrastOnWhite('#ffff00')).toBeLessThan(3);
    expect(contrastOnWhite('#1e7a34')).toBeGreaterThan(4.5);
  });

  it('round-trips export → import', () => {
    const text = exportScheme(custom);
    const r = importScheme(text, 'new-id');
    expect(r).toEqual({ scheme: { ...custom, id: 'new-id' }, errors: [] });
  });

  it('refuses nasty input: oversize, bad JSON, unknown keys, wrong types, prototype keys', () => {
    const ok = JSON.parse(exportScheme(custom)) as Record<string, unknown>;
    const bad = (v: unknown) => importScheme(typeof v === 'string' ? v : JSON.stringify(v), 'x');
    expect(bad('x'.repeat(MAX_FILE_BYTES + 1)).errors).toEqual(['tooLarge']);
    expect(bad('{not json').errors).toEqual(['json']);
    expect(bad([]).errors).toEqual(['format']);
    expect(bad({ ...ok, format: 'other' }).errors).toEqual(['format']);
    expect(bad({ ...ok, version: 2 }).errors).toEqual(['version']);
    expect(bad({ ...ok, extra: 1 }).errors).toEqual(['unknownKey']);
    expect(bad({ ...ok, scheme: { ...(ok.scheme as object), script: 'alert(1)' } }).errors).toEqual(
      ['unknownKey'],
    );
    expect(
      bad('{"format":"pdftools-scheme","version":1,"__proto__":{"x":1},"scheme":{}}').errors,
    ).toEqual(['unknownKey']);
    expect(bad({ ...ok, scheme: { name: 'N', codes: 'A' } }).errors).toEqual(['codes']);
    expect(
      bad({
        ...ok,
        scheme: {
          name: 'N',
          codes: Array.from({ length: 50 }, (_, i) => ({
            code: String(i),
            label: 'x',
            color: '#000000',
          })),
        },
      }).errors,
    ).toEqual(['tooManyCodes']);
    expect(
      bad({
        ...ok,
        scheme: { name: 'N', codes: [{ code: 'A', label: 'x', color: '#000000', onload: 'x' }] },
      }).errors,
    ).toEqual(['unknownKey']);
    expect(
      bad({
        ...ok,
        scheme: {
          name: 'N',
          codes: [
            { code: 'A', label: 'x', color: '#000000' },
            { code: 'a', label: 'y', color: '#000000' },
          ],
        },
      }).errors,
    ).toEqual(['duplicate']);
  });
});
