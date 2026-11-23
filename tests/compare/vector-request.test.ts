// M12-16 (D-59): what the main thread asks the vector overlay builder for
// (the sheet's pages, A's placement as the view draws it, the colours, the
// layer switches and the layer panel's group names), and the display mode's
// view state.
import { describe, expect, it } from 'vitest';
import { IDENTITY, type Affine } from '../../src/model/compare/material';
import { BLUE, DEFAULT_STYLE, RED } from '../../src/model/compare/overlay';
import type { SheetAlignment } from '../../src/model/compare/align/aligner';
import type { Comparison } from '../../src/features/compare/model';
import {
  DEFAULT_VIEW,
  drawnStyle,
  setAligned,
  setVector,
  type Sheet,
} from '../../src/features/compare/overlay/overlayState';
import { vectorRequest, vectorSheet } from '../../src/features/compare/overlay/vectorOverlay';

const shift: Affine = [1, 0, 0, 1, 5, -3];
const pair: Sheet = {
  a: { docId: 'A', page: 2, file: 0 },
  b: { docId: 'B', page: 1, file: 0 },
  pair: 0,
};
const aligned: SheetAlignment = { status: 'auto', method: 'vector', place: shift, score: 0.9 };
const c: Comparison = {
  id: 'cmp',
  type: 'overlay',
  stage: 'result',
  a: [{ docId: 'A', range: '' }],
  b: [{ docId: 'B', range: '' }],
};

describe('the vector overlay request', () => {
  it('takes the sheet’s pages and A’s placement once aligned', () => {
    expect(vectorSheet(DEFAULT_VIEW, pair)).toEqual({
      a: { docId: 'A', pageIndex: 2 },
      b: { docId: 'B', pageIndex: 1 },
      place: IDENTITY,
    });
    const v = setAligned(DEFAULT_VIEW, 0, aligned);
    expect(vectorSheet(v, pair).place).toEqual(shift);
    // A sheet only one revision has is drawn as is.
    expect(vectorSheet(v, { a: null, b: pair.b, pair: null }).place).toEqual(IDENTITY);
    expect(vectorSheet(v, pair, { a: true }).hide).toEqual({ a: true });
  });

  it('carries the colours, the switched layers only, and the layer groups’ names', () => {
    const view = {
      ...DEFAULT_VIEW,
      style: { ...DEFAULT_STYLE, colA: RED, colB: BLUE },
      layers: { A: { 12: false }, B: {} },
    };
    const req = vectorRequest(c, view, [vectorSheet(view, pair)], (d) => `${d}.pdf`);
    expect(req.colA).toEqual(RED);
    expect(req.colB).toEqual(BLUE);
    expect(req.layers).toEqual({ A: { 12: false } });
    expect(req.labels).toEqual({ a: { A: 'Old — A.pdf' }, b: { B: 'New — B.pdf' } });
  });
});

describe('the display mode', () => {
  it('turns Blink off and draws the vector page without balance or fade', () => {
    const v = {
      ...DEFAULT_VIEW,
      blink: 'a' as const,
      style: { ...DEFAULT_STYLE, balance: 0.5, fade: 1 },
    };
    const on = setVector(v, true);
    expect(on.vector).toBe(true);
    expect(on.blink).toBeNull();
    expect(drawnStyle(on)).toMatchObject({ balance: 0, fade: 0, showA: true, showB: true });
    expect(setVector(on, true)).toBe(on);
    expect(setVector(on, false).vector).toBe(false);
  });
});
