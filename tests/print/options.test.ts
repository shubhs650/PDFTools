// M2-15: print range parsing and raster / scale math.
import { describe, expect, it } from 'vitest';
import {
  MAX_PIXELS,
  bands,
  clampPercent,
  isLandscape,
  isPercentValid,
  parseRange,
  printedSize,
  rasterSize,
  viewerBlock,
} from '../../src/features/print/options';

describe('parseRange', () => {
  it('reads numbers and spans, 1-based in, 0-based out, in the order written', () => {
    expect(parseRange('1-3, 8', 10)).toEqual({ ok: true, pages: [0, 1, 2, 7] });
    expect(parseRange('8,1', 10)).toEqual({ ok: true, pages: [7, 0] });
    expect(parseRange('5-3', 10)).toEqual({ ok: true, pages: [4, 3, 2] });
  });

  it('accepts open spans, semicolons, spaces and any dash', () => {
    expect(parseRange('8-', 10)).toEqual({ ok: true, pages: [7, 8, 9] });
    expect(parseRange('-2', 10)).toEqual({ ok: true, pages: [0, 1] });
    expect(parseRange('1;3 5', 10)).toEqual({ ok: true, pages: [0, 2, 4] });
    expect(parseRange('2–3', 10)).toEqual({ ok: true, pages: [1, 2] });
    expect(parseRange(' 1 ,  2 ', 10)).toEqual({ ok: true, pages: [0, 1] });
  });

  it('accepts full-width digits and punctuation (IME input)', () => {
    expect(parseRange('１－３，５', 10)).toEqual({ ok: true, pages: [0, 1, 2, 4] });
  });

  it('rejects empty, malformed and out-of-range input', () => {
    expect(parseRange('', 10)).toEqual({ ok: false, error: 'empty' });
    expect(parseRange(' , ', 10)).toEqual({ ok: false, error: 'empty' });
    expect(parseRange('a', 10)).toEqual({ ok: false, error: 'syntax' });
    expect(parseRange('1-2-3', 10)).toEqual({ ok: false, error: 'syntax' });
    expect(parseRange('-', 10)).toEqual({ ok: false, error: 'syntax' });
    expect(parseRange('1.5', 10)).toEqual({ ok: false, error: 'syntax' });
    expect(parseRange('0', 10)).toEqual({ ok: false, error: 'outOfRange' });
    expect(parseRange('11', 10)).toEqual({ ok: false, error: 'outOfRange' });
    expect(parseRange('3-12', 10)).toEqual({ ok: false, error: 'outOfRange' });
  });
});

describe('rasterSize', () => {
  it('A4 at 150 and 300 DPI', () => {
    expect(rasterSize({ width: 595, height: 842 }, 150)).toEqual({
      scale: 150 / 72,
      dpi: 150,
      width: 1240,
      height: 1754,
      capped: false,
    });
    expect(rasterSize({ width: 595, height: 842 }, 300)).toMatchObject({
      width: 2479,
      height: 3508,
    });
  });

  it('caps a page at MAX_PIXELS by lowering the DPI (A0 at 300 → about 200)', () => {
    const r = rasterSize({ width: 3370, height: 2384 }, 300);
    expect(r.capped).toBe(true);
    expect(r.width * r.height).toBeLessThanOrEqual(MAX_PIXELS);
    expect(r.dpi).toBeGreaterThanOrEqual(190);
    expect(r.dpi).toBeLessThan(300);
    expect(r.scale).toBe(r.dpi / 72);
  });

  it('never rounds a tiny region to zero pixels', () => {
    expect(rasterSize({ width: 0.1, height: 0.1 }, 150)).toMatchObject({ width: 1, height: 1 });
  });
});

describe('bands', () => {
  it('splits into 1,024-row bands with a short last one', () => {
    expect(bands(2500)).toEqual([
      { top: 0, rows: 1024 },
      { top: 1024, rows: 1024 },
      { top: 2048, rows: 452 },
    ]);
    expect(bands(1024)).toEqual([{ top: 0, rows: 1024 }]);
  });
});

describe('printedSize', () => {
  const a4 = { width: 595, height: 842 };
  it('fit leaves the size to the paper', () => {
    expect(printedSize(a4, 'fit', 50)).toBeNull();
  });
  it('actual is the page size; custom scales it', () => {
    expect(printedSize(a4, 'actual', 50)).toEqual(a4);
    expect(printedSize(a4, 'custom', 50)).toEqual({ width: 297.5, height: 421 });
  });
  it('custom percent is clamped to 10–400 %', () => {
    expect(clampPercent(5)).toBe(10);
    expect(clampPercent(1000)).toBe(400);
    expect(clampPercent(Number.NaN)).toBe(100);
    expect(isPercentValid(5)).toBe(false);
    expect(isPercentValid(150)).toBe(true);
  });
  it('orientation auto follows the page', () => {
    expect(isLandscape(a4)).toBe(false);
    expect(isLandscape({ width: 842, height: 595 })).toBe(true);
  });
});

describe('viewerBlock (M2-16)', () => {
  it('whole pages with or without markups, when high quality is allowed', () => {
    expect(viewerBlock({ range: 'all', markups: 'on' }, true)).toBeNull();
    expect(viewerBlock({ range: 'custom', markups: 'off' }, true)).toBeNull();
    expect(viewerBlock({ range: 'current', markups: 'on' }, true)).toBeNull();
    expect(viewerBlock({ range: 'view', markups: 'on' }, true)).toBe('range');
    expect(viewerBlock({ range: 'area', markups: 'on' }, true)).toBe('range');
    expect(viewerBlock({ range: 'all', markups: 'only' }, true)).toBe('markups');
    expect(viewerBlock({ range: 'all', markups: 'on' }, false)).toBe('quality');
    // No built-in PDF viewer (navigator.pdfViewerEnabled false): never offered.
    expect(viewerBlock({ range: 'all', markups: 'on' }, true, false)).toBe('noViewer');
  });
});
