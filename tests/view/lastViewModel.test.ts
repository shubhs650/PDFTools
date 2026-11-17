import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEW } from '../../src/app/store/documentStore';
import {
  fitToDocument,
  lastViewOf,
  parseLastView,
  sameView,
  type LastView,
} from '../../src/features/view/lastViewModel';

const view: LastView = {
  v: 1,
  page: 41,
  zoom: 1.25,
  mode: 'facing',
  rotation: 90,
  savedAt: 1000,
};

describe("a file's last view (M11-08·O3, D-53)", () => {
  it('records the page, zoom, layout and view rotation, not the resolved scale', () => {
    const rec = lastViewOf(
      { page: 41, zoom: 1.25, scale: 1.25, mode: 'facing', rotation: 90 },
      1000,
    );
    expect(rec).toEqual(view);
    expect(Object.keys(rec)).not.toContain('scale');
  });

  it('reads a stored record back', () => {
    expect(parseLastView(view)).toEqual(view);
    expect(parseLastView({ ...view, zoom: 'fitVisible' })).toEqual({ ...view, zoom: 'fitVisible' });
    expect(parseLastView({ ...view, zoom: 'fitPage' })?.zoom).toBe('fitPage');
  });

  it('clamps a stored zoom factor to the zoom range', () => {
    expect(parseLastView({ ...view, zoom: 500 })?.zoom).toBe(64);
    expect(parseLastView({ ...view, zoom: 0.0001 })?.zoom).toBe(0.01);
  });

  it.each([
    ['nothing', undefined],
    ['not an object', 'page 3'],
    ['another version', { ...view, v: 2 }],
    ['a negative page', { ...view, page: -1 }],
    ['a fractional page', { ...view, page: 1.5 }],
    ['an unknown layout', { ...view, mode: 'booklet' }],
    ['an odd rotation', { ...view, rotation: 45 }],
    ['an unknown zoom', { ...view, zoom: 'fitHeight' }],
    ['a zero zoom', { ...view, zoom: 0 }],
    ['an infinite zoom', { ...view, zoom: Infinity }],
    ['no time', { ...view, savedAt: 'yesterday' }],
  ])('ignores a damaged record: %s', (_, raw) => {
    expect(parseLastView(raw)).toBeNull();
  });

  it('opens a file that lost pages at its last page', () => {
    expect(fitToDocument(view, 100).page).toBe(41);
    expect(fitToDocument(view, 10).page).toBe(9);
    expect(fitToDocument(view, 0).page).toBe(0);
  });

  it('compares views without their time', () => {
    const later: LastView = { ...view, savedAt: 2000 };
    expect(sameView(view, later)).toBe(true);
    expect(sameView(view, { ...view, page: 2 })).toBe(false);
    expect(sameView(view, { ...view, zoom: 'fitWidth' })).toBe(false);
    expect(sameView(view, { ...view, mode: 'single' })).toBe(false);
    expect(sameView(view, { ...view, rotation: 0 })).toBe(false);
    expect(sameView(undefined, view)).toBe(false);
  });

  it('knows a view that needs no restoring', () => {
    const plain = lastViewOf(DEFAULT_VIEW, 1);
    expect(sameView(DEFAULT_VIEW, plain)).toBe(true);
    expect(sameView(DEFAULT_VIEW, { ...plain, page: 1 })).toBe(false);
    expect(sameView(DEFAULT_VIEW, { ...plain, rotation: 180 })).toBe(false);
  });
});
