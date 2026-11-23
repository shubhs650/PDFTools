// M12-13 (D-60, Q7, Q8): the state of a manual alignment in the overlay
// view — picking point pairs in either order, the placement shown on the
// overlay while it is set, fine-tune and nudges, which sheets Apply sets, and
// what leaving the sheet or the Review layout does to it.
import { describe, expect, it } from 'vitest';
import {
  applyTargets,
  cancelManual,
  nextSide,
  nudgeManual,
  pickPoint,
  removePair,
  setApplyTo,
  setManualPlace,
  setPicking,
  startManual,
} from '../../src/features/compare/align/manualAlign';
import {
  DEFAULT_VIEW,
  goSheet,
  placeOf,
  setAligned,
  setLayout,
  type OverlayView,
  type Sheet,
} from '../../src/features/compare/overlay/overlayState';
import type { SheetAlignment } from '../../src/model/compare/align/aligner';
import { placeValues } from '../../src/model/compare/align/manual';
import { IDENTITY, type Affine } from '../../src/model/compare/material';

const page = (docId: string, n: number) => ({ docId, page: n, file: 0 });
const sheet0: Sheet = { a: page('A', 0), b: page('B', 0), pair: 0 };
const sheet1: Sheet = { a: page('A', 1), b: page('B', 1), pair: 1 };
const added: Sheet = { a: null, b: page('B', 2), pair: null };
const auto = (place: Affine, status: SheetAlignment['status'] = 'auto'): SheetAlignment => ({
  status,
  method: 'vector',
  place,
  score: 0.9,
});
const SHIFT: Affine = [1, 0, 0, 1, 5, 6];

function started(v: OverlayView = DEFAULT_VIEW): OverlayView {
  return startManual(setAligned(v, 0, auto(SHIFT)), sheet0);
}

describe('starting a manual alignment', () => {
  it('starts from the placement in use, picking, in the Review layout', () => {
    const v = started({ ...DEFAULT_VIEW, layout: 'overlay' });
    expect(v.layout).toBe('review');
    expect(v.manual).toMatchObject({ pair: 0, base: SHIFT, place: SHIFT, picking: true });
    expect(v.manual && nextSide(v.manual)).toBe('a');
  });

  it('is not offered for a sheet only one revision has', () => {
    expect(startManual(DEFAULT_VIEW, added)).toBe(DEFAULT_VIEW);
  });
});

describe('picking point pairs', () => {
  it('A then B makes a pair; one pair shifts the placement in use', () => {
    let v = started();
    v = pickPoint(v, 'a', { x: 100, y: 100 });
    expect(v.manual && nextSide(v.manual)).toBe('b');
    // Nothing moves until the pair is complete.
    expect(v.manual?.place).toEqual(SHIFT);
    v = pickPoint(v, 'b', { x: 110, y: 90 });
    expect(v.manual?.place).toEqual([1, 0, 0, 1, 10, -10]);
    // The overlay shows the placement being set, for this sheet only.
    expect(placeOf(v, sheet0)).toEqual([1, 0, 0, 1, 10, -10]);
    expect(placeOf(v, sheet1)).toEqual(IDENTITY);
  });

  it('B first works too; a second click on the same side moves that point', () => {
    let v = started();
    v = pickPoint(v, 'b', { x: 50, y: 50 });
    v = pickPoint(v, 'b', { x: 60, y: 50 });
    expect(v.manual?.points).toEqual([{ a: null, b: { x: 60, y: 50 }, first: 'b' }]);
    expect(v.manual && nextSide(v.manual)).toBe('a');
    v = pickPoint(v, 'a', { x: 40, y: 50 });
    expect(v.manual?.place).toEqual([1, 0, 0, 1, 20, 0]);
  });

  it('two pairs give scale and rotation; the third completes picking', () => {
    let v = started();
    const pairs: [number, number, number, number][] = [
      [100, 100, 100, 100],
      [900, 100, 900, 116],
      [500, 600, 490, 608],
    ];
    for (const [ax, ay, bx, by] of pairs.slice(0, 2)) {
      v = pickPoint(v, 'a', { x: ax, y: ay });
      v = pickPoint(v, 'b', { x: bx, y: by });
    }
    expect(placeValues(v.manual?.place ?? IDENTITY).deg).toBeCloseTo(
      (Math.atan2(16, 800) * 180) / Math.PI,
      9,
    );
    const [ax, ay, bx, by] = pairs[2] ?? [0, 0, 0, 0];
    v = pickPoint(v, 'a', { x: ax, y: ay });
    v = pickPoint(v, 'b', { x: bx, y: by });
    expect(v.manual?.points).toHaveLength(3);
    expect(v.manual?.picking).toBe(false);
    expect(v.manual && nextSide(v.manual)).toBeNull();
    // A fourth click changes nothing.
    expect(pickPoint(setPicking(v, true), 'a', { x: 1, y: 1 }).manual?.points).toHaveLength(3);
    // Removing a pair lets the placement follow the two left.
    const two = removePair(v, 2);
    expect(two.manual?.points).toHaveLength(2);
    expect(placeValues(two.manual?.place ?? IDENTITY).deg).toBeCloseTo(
      (Math.atan2(16, 800) * 180) / Math.PI,
      9,
    );
  });

  it('points too close together are refused; the placement stays as it was', () => {
    let v = started();
    v = pickPoint(v, 'a', { x: 100, y: 100 });
    v = pickPoint(v, 'b', { x: 100, y: 100 });
    const before = v.manual?.place;
    v = pickPoint(v, 'a', { x: 105, y: 100 });
    v = pickPoint(v, 'b', { x: 700, y: 100 });
    expect(v.manual?.problem).toEqual({ reason: 'tooClose', side: 'a' });
    expect(v.manual?.place).toEqual(before);
  });

  it('nothing is picked while picking is off', () => {
    const v = setPicking(started(), false);
    expect(pickPoint(v, 'a', { x: 1, y: 1 })).toEqual(v);
  });
});

describe('fine-tune, nudges and leaving', () => {
  it('values and nudges set the placement shown', () => {
    let v = setManualPlace(started(), [1, 0, 0, 1, 3, 4]);
    v = nudgeManual(v, 0.1, -1);
    const p = v.manual?.place ?? IDENTITY;
    expect(p[4]).toBeCloseTo(3.1, 12);
    expect(p[5]).toBeCloseTo(3, 12);
    expect(placeOf(v, sheet0)).toEqual(p);
  });

  it('cancel, another sheet or Overlay only leave the placement in use', () => {
    const v = setManualPlace(started(), [1, 0, 0, 1, 3, 4]);
    expect(placeOf(cancelManual(v), sheet0)).toEqual(SHIFT);
    expect(goSheet(v, 1, 2).manual).toBeNull();
    // Overlay only keeps the values but stops picking (no A and B windows there).
    expect(setLayout(v, 'overlay').manual).toMatchObject({
      picking: false,
      place: [1, 0, 0, 1, 3, 4],
    });
  });
});

describe('Apply to', () => {
  it('this sheet, all sheets, or the low-confidence sheets and this one', () => {
    let v = started();
    v = setAligned(v, 1, auto(IDENTITY, 'low'));
    v = setAligned(v, 2, auto(IDENTITY, 'as-is'));
    v = setAligned(v, 3, auto(IDENTITY, 'low'));
    const m = v.manual;
    if (!m) throw new Error('no manual alignment');
    expect(applyTargets(v, m, 4)).toEqual([0]);
    const all = setApplyTo(v, 'all').manual;
    const low = setApplyTo(v, 'low').manual;
    if (!all || !low) throw new Error('no manual alignment');
    expect(applyTargets(v, all, 4)).toEqual([0, 1, 2, 3]);
    expect(applyTargets(v, low, 4)).toEqual([0, 1, 3]);
  });
});
