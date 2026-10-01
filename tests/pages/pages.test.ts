import { describe, expect, it } from 'vitest';
import { PAGE_CACHES } from '../../src/features/pages/invalidate';
import { nextSelection, remapSelection } from '../../src/features/pages/selection';
import { blankSize, insertAt, PAPER } from '../../src/features/pages/sizes';
import { resolveScope } from '../../src/features/extract/scope';

// M4-09: thumbnail selection, insert sizes and positions, the delete scope,
// and the cache map (ADR-016).

describe('thumbnail selection', () => {
  const none = { selected: [], anchor: 0 };
  it('click selects one page and sets the anchor', () => {
    expect(nextSelection(none, 3, { shift: false, toggle: false })).toEqual({
      selected: [3],
      anchor: 3,
    });
  });
  it('Ctrl+click toggles', () => {
    const a = nextSelection({ selected: [1], anchor: 1 }, 4, { shift: false, toggle: true });
    expect(a).toEqual({ selected: [1, 4], anchor: 4 });
    expect(nextSelection(a, 1, { shift: false, toggle: true })).toEqual({
      selected: [4],
      anchor: 1,
    });
  });
  it('Shift+click extends from the anchor, either way; Ctrl+Shift adds the range', () => {
    expect(nextSelection({ selected: [5], anchor: 5 }, 2, { shift: true, toggle: false })).toEqual({
      selected: [2, 3, 4, 5],
      anchor: 5,
    });
    expect(
      nextSelection({ selected: [0, 9], anchor: 5 }, 6, { shift: true, toggle: true }).selected,
    ).toEqual([0, 5, 6, 9]);
  });
  it('follows a page operation: deleted pages leave, the rest move', () => {
    // Pages 0..5; page 1 deleted: 0→0, 1→gone, 2→1, …
    const map = [0, -1, 1, 2, 3, 4];
    expect(remapSelection({ selected: [1, 3, 5], anchor: 1 }, map)).toEqual({
      selected: [2, 4],
      anchor: 2,
    });
  });
});

describe('insert blank page', () => {
  it('copies the neighbour as shown (a rotated sheet gives a landscape page)', () => {
    expect(blankSize('neighbour', 'portrait', { width: 595, height: 842, rotation: 0 })).toEqual({
      width: 595,
      height: 842,
    });
    expect(blankSize('neighbour', 'portrait', { width: 595, height: 842, rotation: 1 })).toEqual({
      width: 842,
      height: 595,
    });
  });
  it('paper sizes in points, with the orientation', () => {
    expect(blankSize('a4', 'portrait', undefined)).toEqual({ width: 595.28, height: 841.89 });
    expect(blankSize('letter', 'landscape', undefined)).toEqual({ width: 792, height: 612 });
    expect(PAPER.a3).toEqual([841.89, 1190.55]);
    // No neighbour (an empty selection): A4.
    expect(blankSize('neighbour', 'portrait', undefined)).toEqual({
      width: 595.28,
      height: 841.89,
    });
  });
  it('before or after a page, clamped to the document', () => {
    expect(insertAt('before', 0, 5)).toBe(0);
    expect(insertAt('after', 4, 5)).toBe(5);
    expect(insertAt('after', 9, 5)).toBe(5);
  });
});

describe('delete scope', () => {
  it('a range, the selection or the current page, in document order', () => {
    const ctx = { pageCount: 10, current: 3, selection: [7, 2] };
    expect(resolveScope({ kind: 'custom', custom: '8, 1-3' }, ctx)).toEqual({
      ok: true,
      pages: [0, 1, 2, 7],
    });
    expect(resolveScope({ kind: 'selection', custom: '' }, ctx)).toEqual({
      ok: true,
      pages: [2, 7],
    });
    expect(resolveScope({ kind: 'current', custom: '' }, ctx)).toEqual({ ok: true, pages: [3] });
    expect(resolveScope({ kind: 'custom', custom: '12' }, ctx)).toEqual({
      ok: false,
      error: 'outOfRange',
    });
  });
});

describe('cache map (ADR-016)', () => {
  it('names every main-thread cache a page operation drops', () => {
    expect(PAGE_CACHES).toHaveLength(10);
    expect(PAGE_CACHES.join(' ')).toMatch(/tileCache/);
    expect(PAGE_CACHES.join(' ')).toMatch(/Snap worker/);
  });
});
