// M6-10: where the paperclip goes and what its appearance stream says (pure).
import { describe, expect, it } from 'vitest';
import {
  ATTACH_ICON_SIZE,
  ATTACH_MAX_BYTES,
  attachRect,
  paperclipAppearance,
  rgbOperands,
} from '../../src/model/attachFile';

const PAGE = { width: 595, height: 842 };

describe('attachRect', () => {
  it('centres the 20 pt icon on the click', () => {
    expect(attachRect({ x: 300, y: 200 }, PAGE)).toEqual({
      origin: { x: 290, y: 190 },
      size: { width: ATTACH_ICON_SIZE, height: ATTACH_ICON_SIZE },
    });
  });

  it('keeps the icon inside the page at its edges', () => {
    expect(attachRect({ x: 2, y: 3 }, PAGE).origin).toEqual({ x: 0, y: 0 });
    expect(attachRect({ x: 594, y: 841 }, PAGE).origin).toEqual({ x: 575, y: 822 });
  });
});

describe('rgbOperands', () => {
  it('turns #RRGGBB into PDF operands', () => {
    expect(rgbOperands('#FF0000')).toBe('1 0 0');
    expect(rgbOperands('#0080ff')).toBe('0 0.502 1');
  });

  it('falls back to black for anything else', () => {
    expect(rgbOperands('red')).toBe('0 0 0');
  });
});

describe('paperclipAppearance', () => {
  it('scales the 20-unit drawing into the rect and strokes it in the colour', () => {
    const ap = paperclipAppearance({ left: 100, bottom: 700, right: 130, top: 730 }, '#0000FF');
    expect(ap.startsWith('q 1.5 0 0 1.5 100 700 cm ')).toBe(true);
    expect(ap).toContain('1 1 1 RG 3.5 w'); // the white under-stroke
    expect(ap).toContain('0 0 1 RG 1.5 w');
    expect(ap.endsWith(' Q')).toBe(true);
    // Balanced q/Q and nothing but PDF operators and numbers.
    expect(ap.match(/\bq\b/g)?.length).toBe(ap.match(/\bQ\b/g)?.length);
    expect(ap).toMatch(/^[\d.\s a-zA-Z-]+$/);
  });
});

it('the limit is the plan’s 25 MB', () => {
  expect(ATTACH_MAX_BYTES).toBe(25_000_000);
});
