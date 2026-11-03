import { describe, expect, it } from 'vitest';
import {
  gridMove,
  hexToRgb,
  normalizeHex,
  PALETTE_COLUMNS,
  paletteColor,
  STANDARD_COLORS,
} from '../../src/ui/components/colorPalette';
import { PRESET_HEX } from '../../src/features/annotate/tools/stylePalette';
import { DEFAULT_RED, HIGHLIGHT_YELLOW } from '../../src/features/annotate/tools/toolDefaults';

describe('standard colors (M6-16)', () => {
  it('is a full 8 × 6 grid of distinct lower-case colours with distinct names', () => {
    expect(PALETTE_COLUMNS).toBe(8);
    expect(STANDARD_COLORS).toHaveLength(48);
    for (const c of STANDARD_COLORS) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(STANDARD_COLORS.map((c) => c.hex)).size).toBe(48);
    expect(new Set(STANDARD_COLORS.map((c) => c.name)).size).toBe(48);
  });

  it('starts with black and white rows, then the pure colours', () => {
    expect(STANDARD_COLORS[0]?.hex).toBe('#000000');
    expect(STANDARD_COLORS[7]?.hex).toBe('#ffffff');
    expect(STANDARD_COLORS.slice(8, 16).map((c) => c.hex)).toContain('#ff0000');
  });

  it('holds the shipped defaults and every style-palette preset', () => {
    for (const hex of [DEFAULT_RED, HIGHLIGHT_YELLOW, ...Object.values(PRESET_HEX)])
      expect(paletteColor(hex), hex).toBeDefined();
  });

  it('matches colours in any case and rejects non-colours', () => {
    expect(paletteColor('#FF0000')?.name).toBe('colorPicker.color.red');
    expect(paletteColor('#123456')).toBeUndefined();
    expect(paletteColor('transparent')).toBeUndefined();
    expect(normalizeHex('#ABCDEF')).toBe('#abcdef');
    expect(normalizeHex('#abc')).toBeNull();
    expect(hexToRgb('#ff8000')).toEqual([255, 128, 0]);
  });
});

describe('gridMove (ARIA grid keys)', () => {
  const move = (i: number, key: string, ctrl = false) => gridMove(i, key, ctrl, 48, 8);
  it('moves by one cell and stops at the edges', () => {
    expect(move(0, 'ArrowRight')).toBe(1);
    expect(move(7, 'ArrowRight')).toBe(7);
    expect(move(8, 'ArrowLeft')).toBe(8);
    expect(move(9, 'ArrowLeft')).toBe(8);
    expect(move(3, 'ArrowDown')).toBe(11);
    expect(move(43, 'ArrowDown')).toBe(43);
    expect(move(11, 'ArrowUp')).toBe(3);
    expect(move(3, 'ArrowUp')).toBe(3);
  });
  it('Home/End go to the row ends; with Ctrl to the first and last cell', () => {
    expect(move(13, 'Home')).toBe(8);
    expect(move(13, 'End')).toBe(15);
    expect(move(13, 'Home', true)).toBe(0);
    expect(move(13, 'End', true)).toBe(47);
  });
  it('ignores other keys', () => {
    expect(move(5, 'Enter')).toBeNull();
    expect(move(5, 'a')).toBeNull();
  });
});
