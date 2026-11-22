// M12-11 (D-59): the overlay's pure parts — the composition tables (kept
// from spike S29), Thicken across tile seams, the dark-overlap check, the
// comments drawn over the composition, the tile grid and matrices, the zoom
// steps, the grey-tile cache with its byte cap, and the view's transitions.
import { describe, expect, it } from 'vitest';
import { IDENTITY, applyAffine, type Affine } from '../../src/model/compare/material';
import { ByteCache } from '../../src/model/compare/byteCache';
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
  hexOf,
  over,
  presetOf,
  rgbOf,
  styleKey,
  styleTables,
  thicken,
  weights,
  type OverlayStyle,
} from '../../src/model/compare/overlay';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  TILE,
  fitZoom,
  sheetPixels,
  stepZoom,
  tileMatrix,
  visibleTiles,
} from '../../src/model/compare/overlayView';
import {
  DEFAULT_VIEW,
  drawnStyle,
  goSheet,
  overlapWarning,
  placeOf,
  setAligned,
  setBalance,
  setColour,
  setPreset,
  setLayout,
  setLock,
  setSplits,
  sheetsOf,
  toggleSide,
  differingDefaults,
} from '../../src/features/compare/overlay/overlayState';

const px = (rgba: Uint8ClampedArray, i: number) => [...rgba.subarray(i * 4, i * 4 + 4)];
const draw = (
  a: Uint8Array | null,
  b: Uint8Array | null,
  n: number,
  s: OverlayStyle = DEFAULT_STYLE,
) => compose(a, b, n, 1, styleTables(s));

describe('compose (tint + Multiply)', () => {
  // Four pixels: paper/paper, ink A only, ink B only, ink on both.
  const a = Uint8Array.from([255, 0, 255, 0]);
  const b = Uint8Array.from([255, 255, 0, 0]);

  it('gives white paper, red old, green new and exact black where both have ink', () => {
    const out = draw(a, b, 4);
    expect(px(out, 0)).toEqual([255, 255, 255, 255]);
    expect(px(out, 1)).toEqual([255, 0, 0, 255]);
    expect(px(out, 2)).toEqual([0, 255, 0, 255]);
    expect(px(out, 3)).toEqual([0, 0, 0, 255]);
  });

  it('keeps black on overlap for the presets red/blue and magenta/green', () => {
    expect(px(draw(a, b, 4, { ...DEFAULT_STYLE, colA: RED, colB: BLUE }), 3)).toEqual([
      0, 0, 0, 255,
    ]);
    expect(px(draw(a, b, 4, { ...DEFAULT_STYLE, colA: MAGENTA, colB: GREEN }), 3)).toEqual([
      0, 0, 0, 255,
    ]);
  });

  it('tints grey ink by its strength and draws a missing side as paper', () => {
    expect(px(draw(Uint8Array.from([128]), null, 1), 0)).toEqual([255, 128, 128, 255]);
    expect(px(draw(null, Uint8Array.from([0]), 1), 0)).toEqual([0, 255, 0, 255]);
  });

  it('hides a side and balances', () => {
    const hideA = draw(a, b, 4, { ...DEFAULT_STYLE, showA: false });
    expect(px(hideA, 1)).toEqual([255, 255, 255, 255]);
    expect(px(hideA, 3)).toEqual([0, 255, 0, 255]);
    const half = draw(a, b, 4, { ...DEFAULT_STYLE, balance: 0.5 });
    expect(px(half, 1)).toEqual([255, 128, 128, 255]);
    expect(px(half, 2)).toEqual([0, 255, 0, 255]);
    expect(weights({ ...DEFAULT_STYLE, balance: -1 })).toEqual([1, 0]);
  });

  it('Fade unchanged dims shared ink and keeps the colours', () => {
    const out = draw(a, b, 4, { ...DEFAULT_STYLE, fade: 1 });
    expect(px(out, 1)).toEqual([255, 0, 0, 255]);
    expect(px(out, 2)).toEqual([0, 255, 0, 255]);
    expect(px(out, 3)).toEqual([FADE_GREY, FADE_GREY, FADE_GREY, 255]);
  });

  it('keys styles by what changes the tables', () => {
    expect(styleKey(DEFAULT_STYLE)).toBe(styleKey({ ...DEFAULT_STYLE }));
    expect(styleKey(DEFAULT_STYLE)).not.toBe(styleKey({ ...DEFAULT_STYLE, fade: 1 }));
  });

  it('classifies pixels', () => {
    expect(classify(draw(a, b, 4))).toEqual({ white: 1, black: 1, colA: 1, colB: 1, other: 0 });
  });
});

describe('comments over the composition', () => {
  it('draws opaque comments as they are and blends see-through ones', () => {
    const dst = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 10, 20, 30, 255]);
    const src = new Uint8ClampedArray([255, 255, 0, 255, 255, 255, 0, 128, 1, 2, 3, 0]);
    over(dst, src);
    expect([...dst.subarray(0, 4)]).toEqual([255, 255, 0, 255]);
    expect([...dst.subarray(4, 8)]).toEqual([128, 128, 0, 255]);
    expect([...dst.subarray(8, 12)]).toEqual([10, 20, 30, 255]);
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
    for (let y = 0; y < W; y++) full[y * W + 5] = 0;
    const whole = thicken(full, W, W, 1);
    const m = 1;
    const tw = 5 + 2 * m;
    const tile = new Uint8Array(tw * (W + 2 * m)).fill(255);
    for (let y = 0; y < W; y++)
      for (let x = 4; x < W; x++) tile[(y + m) * tw + (x - 4)] = full[y * W + x] ?? 255;
    const t = crop(thicken(tile, tw, W + 2 * m, 1), tw, m, 5, W);
    for (let y = 0; y < W; y++)
      expect([...t.subarray(y * 5, y * 5 + 5)]).toEqual([...whole.subarray(y * W + 5, y * W + 10)]);
  });
});

describe('colours', () => {
  it('warns when two colours do not multiply to a dark overlap', () => {
    expect(darkOverlap(RED, GREEN)).toBe(true);
    expect(darkOverlap(RED, BLUE)).toBe(true);
    expect(darkOverlap(MAGENTA, GREEN)).toBe(true);
    expect(darkOverlap(RED, [255, 128, 0])).toBe(false);
  });

  it('reads and writes #rrggbb and names the presets', () => {
    expect(rgbOf('#ff8000')).toEqual([255, 128, 0]);
    expect(hexOf([0, 255, 16])).toBe('#00ff10');
    expect(presetOf(RED, BLUE)).toBe('redBlue');
    expect(presetOf(MAGENTA, GREEN)).toBe('magentaGreen');
    expect(presetOf(RED, [255, 128, 0])).toBeNull();
  });
});

describe('the tile grid', () => {
  it('covers the view, centre first, and stops at the sheet edge', () => {
    const tiles = visibleTiles(1200, 700, { x: 0, y: 0, w: 1200, h: 700 });
    expect(tiles).toHaveLength(6);
    expect(tiles[0]).toMatchObject({ col: 1, row: 0, x: TILE, y: 0 });
    const last = tiles.find((t) => t.col === 2 && t.row === 1);
    expect(last).toMatchObject({ w: 1200 - 2 * TILE, h: 700 - TILE });
  });

  it('only the tiles meeting a scrolled view; none outside the sheet', () => {
    const tiles = visibleTiles(5000, 5000, { x: 1000, y: 1000, w: 600, h: 300 });
    expect(tiles.map((t) => t.key).sort()).toEqual(['1:1', '1:2', '2:1', '2:2', '3:1', '3:2']);
    expect(visibleTiles(500, 500, { x: 600, y: 0, w: 100, h: 100 })).toEqual([]);
  });

  it('draws A through its placement into the tile', () => {
    const place: Affine = [0.5, 0, 0, 0.5, 10, 20];
    const m = tileMatrix(4, 100, 40, place);
    // A point of A → its place in B's frame → the tile's pixels.
    expect(applyAffine(m, 20, 8)).toEqual(applyAffine(tileMatrix(4, 100, 40), 20, 24));
    expect(tileMatrix(2, 0, 0)).toEqual([2, 0, 0, 2, 0, 0]);
    expect(tileMatrix(2, 0, 0, IDENTITY)).toEqual([2, 0, 0, 2, 0, 0]);
    expect(sheetPixels(100.4, 0.1, 2)).toEqual({ w: 201, h: 1 });
  });
});

describe('zoom', () => {
  it('fits the page or the width', () => {
    const page = fitZoom('page', 1190, 842, 1000, 600, 0);
    expect(page).toBeCloseTo(600 / (842 * (96 / 72)), 6);
    expect(fitZoom('width', 1190, 842, 1000, 600, 0)).toBeCloseTo(1000 / (1190 * (96 / 72)), 6);
    expect(fitZoom('page', 1e9, 1e9, 10, 10)).toBe(MIN_ZOOM);
  });

  it('steps through the zoom levels', () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(1.1, -1)).toBe(1);
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });
});

describe('the grey-tile cache', () => {
  it('evicts the least recently used tiles over its byte cap', () => {
    const c = new ByteCache<string>(100);
    c.set('a', 'A', 40);
    c.set('b', 'B', 40);
    expect(c.get('a')).toBe('A');
    c.set('c', 'C', 40);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe('A');
    expect(c.bytes).toBe(80);
    c.set('huge', 'H', 500);
    expect(c.get('huge')).toBe('H');
    expect(c.size).toBe(1);
  });

  it('drops a document by key prefix', () => {
    const c = new ByteCache<number>(1000);
    c.set('doc1\n0', 1, 10);
    c.set('doc1\n1', 2, 10);
    c.set('doc2\n0', 3, 10);
    c.dropPrefix('doc1\n');
    expect(c.size).toBe(1);
    expect(c.bytes).toBe(10);
  });
});

describe('the overlay view', () => {
  const page = (docId: string, page: number, file = 0) => ({ docId, page, file });

  it('turns the pairing table into sheets, skipping sheets left out', () => {
    const pages = {
      a: [page('A', 0), page('A', 1), page('A', 2)],
      b: [page('B', 0), page('B', 1)],
    };
    const sheets = sheetsOf(
      [
        { a: 0, b: 0, excluded: false },
        { a: 1, b: null, excluded: false },
        { a: 2, b: 1, excluded: true },
        { a: null, b: 1, excluded: false },
      ],
      pages,
    );
    expect(sheets).toEqual([
      { a: page('A', 0), b: page('B', 0), pair: 0 },
      { a: page('A', 1), b: null, pair: null },
      { a: null, b: page('B', 1), pair: null },
    ]);
  });

  it('blinks one side alone, then back to the style', () => {
    const v = { ...DEFAULT_VIEW, style: { ...DEFAULT_STYLE, balance: 0.4, fade: 1 } };
    expect(drawnStyle({ ...v, blink: 'a' })).toMatchObject({ showA: true, showB: false, fade: 0 });
    expect(drawnStyle({ ...v, blink: 'b' })).toMatchObject({ showA: false, showB: true });
    expect(drawnStyle(v)).toBe(v.style);
  });

  it('changes colours, sides and balance', () => {
    expect(setPreset(DEFAULT_VIEW, 'redBlue').style.colB).toEqual(BLUE);
    const custom = setColour(DEFAULT_VIEW, 'b', [255, 128, 0]);
    expect(overlapWarning(custom)).toBe(true);
    expect(overlapWarning(DEFAULT_VIEW)).toBe(false);
    expect(toggleSide(DEFAULT_VIEW, 'a').style.showA).toBe(false);
    expect(setBalance(DEFAULT_VIEW, -1.7).style.balance).toBe(-1);
    expect(setBalance(DEFAULT_VIEW, 0.333).style.balance).toBe(0.3);
  });

  it('goes to another sheet within the list', () => {
    const v = DEFAULT_VIEW;
    expect(goSheet(v, 3, 3)).toMatchObject({ sheet: 2 });
    expect(goSheet(v, -1, 3)).toBe(v);
  });

  it('opens in Review with the lock on, and switches layout, splitters and lock (M12-12)', () => {
    expect(DEFAULT_VIEW).toMatchObject({ layout: 'review', lock: true });
    expect(setLayout(DEFAULT_VIEW, 'overlay').layout).toBe('overlay');
    expect(setLayout(DEFAULT_VIEW, 'review')).toBe(DEFAULT_VIEW);
    expect(setSplits(DEFAULT_VIEW, { y: 0.3 }).splits).toEqual({
      x: DEFAULT_VIEW.splits.x,
      y: 0.3,
    });
    expect(setLock(DEFAULT_VIEW, false).lock).toBe(false);
    expect(setLock(DEFAULT_VIEW, true)).toBe(DEFAULT_VIEW);
  });

  it('draws A through its alignment once found, as is before', () => {
    const sheet = { a: page('A', 0), b: page('B', 0), pair: 1 };
    expect(placeOf(DEFAULT_VIEW, sheet)).toEqual(IDENTITY);
    const place: Affine = [1, 0, 0, 1, 14, 9];
    const v = setAligned(DEFAULT_VIEW, 1, { status: 'auto', method: 'vector', place, score: 0.9 });
    expect(placeOf(v, sheet)).toEqual(place);
    expect(placeOf(v, { ...sheet, pair: null })).toEqual(IDENTITY);
  });
});

describe('layers', () => {
  it('names the layers whose default differs between the two files', () => {
    const a = {
      encrypted: false,
      layers: [
        { name: 'HVAC', on: true },
        { name: 'FIRE', on: false },
      ],
    };
    const b = {
      encrypted: false,
      layers: [
        { name: 'HVAC', on: true },
        { name: 'FIRE', on: true },
        { name: 'CLOUDS', on: true },
      ],
    };
    expect(differingDefaults(a, b)).toEqual(['FIRE']);
    expect(differingDefaults(a, null)).toEqual([]);
  });
});
