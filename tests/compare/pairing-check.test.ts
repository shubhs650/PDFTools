import { describe, expect, it } from 'vitest';
import { fitWidth, heightAt, shownSize } from '../../src/model/compare/pageFit';
import { CHECK_BELOW, rowCheck } from '../../src/model/compare/pairing';

// M12-24 (ADR-033): which sheets of the pairing table are marked "Check", and
// the size page pictures are drawn at.

describe('rowCheck', () => {
  it('marks added and removed pages, whatever the score', () => {
    expect(rowCheck({ a: null, b: 3, excluded: false }, null)).toBe('added');
    expect(rowCheck({ a: 2, b: null, excluded: false }, 0.9)).toBe('removed');
  });

  it('marks a pair matching under 50 %', () => {
    expect(CHECK_BELOW).toBe(0.5);
    expect(rowCheck({ a: 1, b: 1, excluded: false }, 0.49)).toBe('low');
    expect(rowCheck({ a: 1, b: 1, excluded: false }, 0.5)).toBeNull();
    expect(rowCheck({ a: 1, b: 1, excluded: false }, 1)).toBeNull();
  });

  it('leaves out a sheet not compared, or with no score', () => {
    expect(rowCheck({ a: 1, b: 1, excluded: true }, 0.1)).toBeNull();
    expect(rowCheck({ a: 0, b: 0, excluded: false }, null)).toBeNull();
  });
});

describe('page pictures', () => {
  const a3Landscape = { width: 1191, height: 842, rotation: 0 };
  const a4Portrait = { width: 595, height: 842, rotation: 0 };
  const box = { width: 160, height: 120 };

  it('fits a landscape drawing to the width and a portrait page to the height', () => {
    expect(fitWidth(a3Landscape, box)).toBe(160);
    expect(heightAt(a3Landscape, 160)).toBe(113);
    expect(fitWidth(a4Portrait, box)).toBe(85);
    expect(heightAt(a4Portrait, 85)).toBe(120);
  });

  it('turns the page by its own /Rotate', () => {
    const turned = { ...a4Portrait, rotation: 1 };
    expect(shownSize(turned)).toEqual({ width: 842, height: 595 });
    expect(fitWidth(turned, box)).toBe(160);
    expect(fitWidth({ ...a4Portrait, rotation: 2 }, box)).toBe(85);
  });

  it('never returns an empty picture', () => {
    expect(fitWidth({ width: 0, height: 0, rotation: 0 }, box)).toBe(160);
    expect(fitWidth({ width: 10_000, height: 1, rotation: 0 }, { width: 1, height: 1 })).toBe(1);
  });
});
