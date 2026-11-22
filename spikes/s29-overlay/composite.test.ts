import { describe, expect, it } from 'vitest';
import {
  BLUE,
  DEFAULT_STYLE,
  FADE_GREY,
  GREEN,
  MAGENTA,
  RED,
  classify,
  compose,
  crop,
  darkOverlap,
  styleTables,
  thicken,
} from './composite';

const px = (rgba: Uint8ClampedArray, i: number) => [...rgba.subarray(i * 4, i * 4 + 4)];

describe('compose (tint + Multiply)', () => {
  // Four pixels: paper/paper, ink A only, ink B only, ink on both.
  const a = Uint8Array.from([255, 0, 255, 0]);
  const b = Uint8Array.from([255, 255, 0, 0]);

  it('gives white paper, red old, green new and exact black where both have ink', () => {
    const out = compose(a, b, 4, 1);
    expect(px(out, 0)).toEqual([255, 255, 255, 255]);
    expect(px(out, 1)).toEqual([255, 0, 0, 255]);
    expect(px(out, 2)).toEqual([0, 255, 0, 255]);
    expect(px(out, 3)).toEqual([0, 0, 0, 255]);
  });

  it('keeps black on overlap for the presets red/blue and magenta/green', () => {
    expect(px(compose(a, b, 4, 1, { ...DEFAULT_STYLE, colA: RED, colB: BLUE }), 3)).toEqual([
      0, 0, 0, 255,
    ]);
    expect(px(compose(a, b, 4, 1, { ...DEFAULT_STYLE, colA: MAGENTA, colB: GREEN }), 3)).toEqual([
      0, 0, 0, 255,
    ]);
  });

  it('tints grey ink by its strength (anti-aliasing stays a lighter tint)', () => {
    const out = compose(Uint8Array.from([128]), null, 1, 1);
    expect(px(out, 0)).toEqual([255, 128, 128, 255]);
  });

  it('hides a side and balances', () => {
    const hideA = compose(a, b, 4, 1, { ...DEFAULT_STYLE, showA: false });
    expect(px(hideA, 1)).toEqual([255, 255, 255, 255]);
    expect(px(hideA, 3)).toEqual([0, 255, 0, 255]);
    const half = compose(a, b, 4, 1, { ...DEFAULT_STYLE, balance: 0.5 });
    expect(px(half, 1)).toEqual([255, 128, 128, 255]); // old at half strength
    expect(px(half, 2)).toEqual([0, 255, 0, 255]); // new full
  });

  it('Fade unchanged dims shared ink and keeps the colours', () => {
    const out = compose(a, b, 4, 1, { ...DEFAULT_STYLE, fade: 1 });
    expect(px(out, 1)).toEqual([255, 0, 0, 255]);
    expect(px(out, 2)).toEqual([0, 255, 0, 255]);
    expect(px(out, 3)).toEqual([FADE_GREY, FADE_GREY, FADE_GREY, 255]);
  });

  it('classifies pixels', () => {
    expect(classify(compose(a, b, 4, 1))).toEqual({
      white: 1,
      black: 1,
      colA: 1,
      colB: 1,
      other: 0,
    });
  });
});

describe('thicken', () => {
  it('turns a one-pixel hairline into three pixels', () => {
    const w = 7;
    const src = new Uint8Array(w * w).fill(255);
    for (let y = 0; y < w; y++) src[y * w + 3] = 0;
    const out = thicken(src, w, w, 1);
    expect([...out.subarray(3 * w, 4 * w)]).toEqual([255, 255, 0, 0, 0, 255, 255]);
  });

  it('matches across tiles when each tile is rendered with a margin', () => {
    const W = 10;
    const full = new Uint8Array(W * W).fill(255);
    for (let y = 0; y < W; y++) full[y * W + 5] = 0; // hairline at x = 5
    const whole = thicken(full, W, W, 1);
    // The right tile, x 5 … 9, rendered with a one-pixel margin (x 4 … 9, padded).
    const m = 1;
    const tile = new Uint8Array((5 + 2 * m) * (W + 2 * m)).fill(255);
    for (let y = 0; y < W; y++)
      for (let x = 4; x < W; x++) tile[(y + m) * (5 + 2 * m) + (x - 4)] = full[y * W + x] ?? 255;
    const t = crop(thicken(tile, 5 + 2 * m, W + 2 * m, 1), 5 + 2 * m, m, 5, W);
    for (let y = 0; y < W; y++)
      expect([...t.subarray(y * 5, y * 5 + 5)]).toEqual([...whole.subarray(y * W + 5, y * W + 10)]);
  });
});

describe('darkOverlap', () => {
  it('accepts the presets and warns for two similar colours', () => {
    expect(darkOverlap(RED, GREEN)).toBe(true);
    expect(darkOverlap(RED, BLUE)).toBe(true);
    expect(darkOverlap(MAGENTA, GREEN)).toBe(true);
    expect(darkOverlap(RED, [255, 128, 0])).toBe(false);
  });
});

describe('neutral overlap', () => {
  it('draws an unchanged anti-aliased edge grey instead of olive, and keeps the extremes', () => {
    const t = styleTables(DEFAULT_STYLE, 'neutral');
    const a = Uint8Array.from([128, 0, 255, 0]);
    const b = Uint8Array.from([128, 255, 0, 0]);
    const out = compose(a, b, 4, 1, t);
    expect(px(out, 0)).toEqual([128, 128, 128, 255]);
    expect(px(out, 1)).toEqual([255, 0, 0, 255]);
    expect(px(out, 2)).toEqual([0, 255, 0, 255]);
    expect(px(out, 3)).toEqual([0, 0, 0, 255]);
    // Plain Multiply gives olive for the same edge.
    expect(px(compose(a, b, 4, 1), 0)).toEqual([128, 128, 64, 255]);
  });
});
