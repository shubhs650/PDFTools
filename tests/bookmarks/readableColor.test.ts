// M6-15: bookmark colours shown with WCAG AA contrast (rule 12). The file's
// colour is kept when it is readable on every row background; otherwise it
// moves toward the theme's text colour only as far as needed.
import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  parseHex,
  readableOn,
  type Rgb,
} from '../../src/features/bookmarks/readableColor';

const hex = (s: string): Rgb => {
  const c = parseHex(s);
  if (!c) throw new Error(s);
  return c;
};
const LIGHT = { bg: [hex('#ffffff'), hex('#d6e4f5')], text: hex('#1f1f1f') };
const DARK = { bg: [hex('#292929'), hex('#1a3a5c')], text: hex('#ffffff') };

describe('contrast', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio(hex('#000000'), hex('#ffffff'))).toBeCloseTo(21, 5);
    expect(contrastRatio(hex('#ffffff'), hex('#ffffff'))).toBeCloseTo(1, 5);
    expect(contrastRatio(hex('#ff0000'), hex('#ffffff'))).toBeCloseTo(4, 1);
    expect(contrastRatio(hex('#767676'), hex('#ffffff'))).toBeCloseTo(4.54, 2);
  });

  it('parses #rrggbb and #rgb only', () => {
    expect(parseHex('#FF8000')).toEqual([1, 128 / 255, 0]);
    expect(parseHex(' #000000 ')).toEqual([0, 0, 0]);
    expect(parseHex('red')).toBeNull();
    expect(parseHex('#fff')).toEqual([1, 1, 1]); // as minified CSS has the tokens
    expect(parseHex('#ffff')).toBeNull();
    expect(parseHex('Canvas')).toBeNull();
  });
});

describe('readableOn', () => {
  it('keeps a colour that is already readable on every background', () => {
    const blue = hex('#0000ff');
    expect(readableOn(blue, LIGHT.bg, LIGHT.text)).toEqual(blue);
    const yellow = hex('#ffff00');
    expect(readableOn(yellow, DARK.bg, DARK.text)).toEqual(yellow);
  });

  it('darkens pure red just enough on the light theme, and stays red', () => {
    const red = hex('#ff0000');
    const c = readableOn(red, LIGHT.bg, LIGHT.text);
    expect(c).not.toEqual(red);
    for (const bg of LIGHT.bg) expect(contrastRatio(c, bg)).toBeGreaterThanOrEqual(4.5);
    // Still clearly red: the red channel dominates.
    expect(c[0]).toBeGreaterThan(c[1] * 2);
    expect(c[0]).toBeGreaterThan(c[2] * 2);
  });

  it('lightens dark blue on the dark theme', () => {
    const navy = hex('#000080');
    const c = readableOn(navy, DARK.bg, DARK.text);
    for (const bg of DARK.bg) expect(contrastRatio(c, bg)).toBeGreaterThanOrEqual(4.5);
    expect(c[2]).toBeGreaterThan(c[0]);
  });

  it('falls back to the text colour when nothing else is readable', () => {
    const grey = hex('#808080');
    const mid = [hex('#808080')];
    expect(readableOn(grey, mid, hex('#a0a0a0'))).toEqual(hex('#a0a0a0'));
  });
});
