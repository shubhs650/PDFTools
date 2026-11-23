// @vitest-environment jsdom
// M12-26 (ADR-033, D-60): alignment made easy to find — "Checked by you" on a
// sheet that needs checking, the guided Line up steps, Undo last point, when
// Apply is useful, Apply to "Sheets that need checking", the sheet's entry in
// the comparison file, and the first-time tips shown once.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyTargets,
  canApply,
  completePairs,
  lineUpStep,
  nudgeManual,
  pickPoint,
  setApplyTo,
  setPicking,
  startManual,
  undoPoint,
} from '../../src/features/compare/align/manualAlign';
import { sheetEntry } from '../../src/features/compare/file/data';
import {
  DEFAULT_VIEW,
  isAlignChecked,
  needsCheck,
  pairNeedsCheck,
  setAligned,
  setAlignChecked,
  type OverlayView,
  type Sheet,
} from '../../src/features/compare/overlay/overlayState';
import {
  COMPARE_TIPS_STORAGE_KEY,
  TIPS,
  hideTips,
  nextTip,
  offerTips,
  replayTips,
  skipTips,
  tipsStore,
} from '../../src/features/compare/tips/tipsStore';
import type { SheetAlignment } from '../../src/model/compare/align/aligner';
import { IDENTITY, type Affine } from '../../src/model/compare/material';

const page = (docId: string, n: number) => ({ docId, page: n, file: 0 });
const sheet0: Sheet = { a: page('A', 0), b: page('B', 0), pair: 0 };
const sheet1: Sheet = { a: page('A', 1), b: page('B', 1), pair: 1 };
const added: Sheet = { a: null, b: page('B', 2), pair: null };
const al = (status: SheetAlignment['status'], place: Affine = IDENTITY): SheetAlignment => ({
  status,
  method: 'image',
  place,
  score: 0.4,
});

describe('a sheet that needs checking', () => {
  it('is one whose automatic alignment is uncertain, until the user says it looks right', () => {
    let v = setAligned(setAligned(DEFAULT_VIEW, 0, al('low')), 1, al('auto'));
    expect(needsCheck(v, sheet0)).toBe(true);
    expect(needsCheck(v, sheet1)).toBe(false);
    expect(needsCheck(v, added)).toBe(false);
    v = setAlignChecked(v, 0);
    expect(isAlignChecked(v, sheet0)).toBe(true);
    expect(needsCheck(v, sheet0)).toBe(false);
    // The same again changes nothing; off forgets it.
    expect(setAlignChecked(v, 0)).toBe(v);
    expect(setAlignChecked(v, 0, false).alignChecked).toEqual({});
  });

  it('is saved as checked in the comparison file only while its alignment is uncertain', () => {
    let v = setAlignChecked(setAligned(DEFAULT_VIEW, 0, al('low')), 0);
    expect(sheetEntry(v, sheet0)).toEqual({
      a: [0, 0],
      b: [0, 0],
      status: 'lowConfidence',
      checked: true,
    });
    v = setAligned(v, 0, al('manual', [1, 0, 0, 1, 4, 0]));
    expect(sheetEntry(v, sheet0)).toEqual({
      a: [0, 0],
      b: [0, 0],
      aToB: [1, 0, 0, 1, 4, 0],
      status: 'manual',
    });
  });
});

describe('the Line up steps', () => {
  const start = (): OverlayView => startManual(setAligned(DEFAULT_VIEW, 0, al('low')), sheet0);
  const m = (v: OverlayView) => {
    if (!v.manual) throw new Error('not lining up');
    return v.manual;
  };

  it('go 1 old point, 2 new point, 3 optional second pair, 4 Apply', () => {
    let v = start();
    expect(lineUpStep(m(v))).toBe(1);
    expect(canApply(m(v))).toBe(false);
    v = pickPoint(v, 'a', { x: 10, y: 10 });
    expect(lineUpStep(m(v))).toBe(2);
    v = pickPoint(v, 'b', { x: 14, y: 12 });
    expect(lineUpStep(m(v))).toBe(3);
    expect(canApply(m(v))).toBe(true);
    v = pickPoint(v, 'a', { x: 200, y: 10 });
    expect(lineUpStep(m(v))).toBe(3);
    v = pickPoint(v, 'b', { x: 204, y: 12 });
    expect(lineUpStep(m(v))).toBe(4);
  });

  it('go to Apply when picking stops with a pair; typed or nudged values can be applied too', () => {
    let v = pickPoint(pickPoint(start(), 'a', { x: 10, y: 10 }), 'b', { x: 11, y: 10 });
    v = setPicking(v, false);
    expect(lineUpStep(m(v))).toBe(4);
    const nudged = nudgeManual(setPicking(start(), false), 1, 0);
    expect(canApply(m(nudged))).toBe(true);
  });

  it('Undo last point takes the last click: the second side of a pair, else the pair begun', () => {
    let v = start();
    v = pickPoint(v, 'b', { x: 14, y: 12 });
    v = pickPoint(v, 'a', { x: 10, y: 10 });
    expect(completePairs(m(v))).toHaveLength(1);
    // B was clicked first: undo takes A's point and the next click picks A again.
    v = undoPoint(v);
    expect(m(v).points).toEqual([{ a: null, b: { x: 14, y: 12 }, first: 'b' }]);
    expect(m(v).place).toEqual(IDENTITY);
    expect(lineUpStep(m(v))).toBe(1);
    v = undoPoint(v);
    expect(m(v).points).toEqual([]);
    // Nothing left: nothing happens.
    expect(undoPoint(v)).toEqual(v);
  });

  it('Undo last point picks again after three pairs', () => {
    let v = start();
    for (const x of [10, 200, 400]) {
      v = pickPoint(v, 'a', { x, y: x / 2 });
      v = pickPoint(v, 'b', { x: x + 2, y: x / 2 });
    }
    expect(m(v).picking).toBe(false);
    v = undoPoint(v);
    expect(m(v).picking).toBe(true);
    expect(completePairs(m(v))).toHaveLength(2);
  });

  it('Apply to "Sheets that need checking" leaves out the ones checked by you', () => {
    let v = start();
    v = setAligned(v, 1, al('low'));
    v = setAligned(v, 2, al('low'));
    v = setAligned(v, 3, al('auto'));
    v = setAlignChecked(v, 2);
    expect(pairNeedsCheck(v, 2)).toBe(false);
    v = setApplyTo(v, 'low');
    expect(applyTargets(v, m(v), 4)).toEqual([0, 1]);
  });
});

describe('the first-time tips', () => {
  beforeEach(() => {
    localStorage.clear();
    tipsStore.setState({ showing: null });
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('show on the first comparison, one after the other, then never again', () => {
    offerTips('c1');
    expect(tipsStore.getState().showing).toEqual({ id: 'c1', step: 0 });
    // Another comparison does not take them over.
    offerTips('c2');
    expect(tipsStore.getState().showing?.id).toBe('c1');
    for (let i = 1; i < TIPS.length; i++) {
      nextTip();
      expect(tipsStore.getState().showing?.step).toBe(i);
    }
    nextTip();
    expect(tipsStore.getState().showing).toBeNull();
    expect(localStorage.getItem(COMPARE_TIPS_STORAGE_KEY)).not.toBeNull();
    offerTips('c3');
    expect(tipsStore.getState().showing).toBeNull();
  });

  it('start again when the result went away before the end; Skip tips ends them for good', () => {
    offerTips('c1');
    hideTips('c1');
    offerTips('c1');
    expect(tipsStore.getState().showing).toEqual({ id: 'c1', step: 0 });
    skipTips();
    offerTips('c1');
    expect(tipsStore.getState().showing).toBeNull();
  });

  it('show again after Help replays them', () => {
    offerTips('c1');
    skipTips();
    replayTips();
    offerTips('c1');
    expect(tipsStore.getState().showing).toEqual({ id: 'c1', step: 0 });
  });
});
