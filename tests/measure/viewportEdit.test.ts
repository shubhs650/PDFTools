import { describe, expect, it } from 'vitest';
import { entryWithBox, viewportsFromPdf, viewportToPdf, type Scale } from '../../src/model/scale';
import {
  BOX_HANDLES,
  handlePoint,
  MIN_VIEWPORT,
  moveRect,
  resizeRect,
  sameRect,
  samePick,
  stepHandle,
  type Rect,
} from '../../src/model/viewportEdit';

// M14-09 (D-77, Q22, Q36): a scale viewport moved and resized on the page,
// kept inside it and never turned inside out; its /VP entry keeps its other keys.
const page = { width: 595, height: 842 };
const r: Rect = { left: 100, top: 200, width: 150, height: 100 };

describe('moving a viewport', () => {
  it('moves by the drag', () => {
    expect(moveRect(r, 20, -30, page)).toEqual({ ...r, left: 120, top: 170 });
  });
  it('stops at the page edges, keeping its size', () => {
    expect(moveRect(r, -500, -500, page)).toEqual({ ...r, left: 0, top: 0 });
    expect(moveRect(r, 1000, 1000, page)).toEqual({ ...r, left: 445, top: 742 });
  });
});

describe('resizing a viewport', () => {
  it('a corner moves two edges, the others stay', () => {
    expect(resizeRect(r, 'se', { x: 300, y: 350 }, page)).toEqual({
      left: 100,
      top: 200,
      width: 200,
      height: 150,
    });
    expect(resizeRect(r, 'nw', { x: 90, y: 190 }, page)).toEqual({
      left: 90,
      top: 190,
      width: 160,
      height: 110,
    });
  });
  it('an edge moves along its own axis only', () => {
    expect(resizeRect(r, 'e', { x: 400, y: 0 }, page)).toEqual({ ...r, width: 300 });
    expect(resizeRect(r, 'n', { x: 0, y: 150 }, page)).toEqual({ ...r, top: 150, height: 150 });
  });
  it('never smaller than the minimum, never inside out', () => {
    const tiny = resizeRect(r, 'w', { x: 400, y: 0 }, page);
    expect(tiny.width).toBe(MIN_VIEWPORT);
    expect(tiny.left + tiny.width).toBe(250);
    const flat = resizeRect(r, 's', { x: 0, y: 0 }, page);
    expect(flat).toEqual({ ...r, height: MIN_VIEWPORT });
  });
  it('stops at the page edges', () => {
    expect(resizeRect(r, 'ne', { x: 900, y: -40 }, page)).toEqual({
      left: 100,
      top: 0,
      width: 495,
      height: 300,
    });
  });
  it('from the keyboard: a step moves the handle', () => {
    expect(stepHandle(r, 'e', 10, 0, page)).toEqual({ ...r, width: 160 });
    // An edge ignores the other axis.
    expect(stepHandle(r, 'e', 0, 10, page)).toEqual(r);
    expect(stepHandle(r, 'sw', -1, 1, page)).toEqual({
      left: 99,
      top: 200,
      width: 151,
      height: 101,
    });
  });
  it('every handle sits on the rectangle', () => {
    for (const h of BOX_HANDLES) {
      const p = handlePoint(r, h);
      expect(p.x).toBeGreaterThanOrEqual(100);
      expect(p.x).toBeLessThanOrEqual(250);
      expect(p.y).toBeGreaterThanOrEqual(200);
      expect(p.y).toBeLessThanOrEqual(300);
      // Dragging a handle to where it is changes nothing.
      expect(sameRect(resizeRect(r, h, p, page), r)).toBe(true);
    }
    expect(handlePoint(r, 'n')).toEqual({ x: 175, y: 200 });
    expect(handlePoint(r, 'se')).toEqual({ x: 250, y: 300 });
  });
});

describe('the /VP entry', () => {
  const s5: Scale = { paper: 1, real: 5, unit: 'mm', precision: 1 };
  it('gets the new box and keeps its name, scale and other keys', () => {
    const base = viewportToPdf({ name: 'Detail A', bbox: [300, 400, 550, 700], scale: s5 });
    const viewer = { dict: { ...(base as { dict: object }).dict, PtData: { name: 'Mine' } } };
    const moved = entryWithBox(viewer, [310, 410, 560, 710]);
    expect(viewportsFromPdf([moved])).toEqual([
      { name: 'Detail A', bbox: [310, 410, 560, 710], scale: s5 },
    ]);
    expect((moved as { dict: Record<string, unknown> }).dict.PtData).toEqual({ name: 'Mine' });
  });
  it('leaves an entry it cannot read as it is', () => {
    expect(entryWithBox(null, [0, 0, 1, 1])).toBeNull();
  });
});

describe('the picked viewport after its page changes', () => {
  const s5: Scale = { paper: 1, real: 5, unit: 'mm', precision: 1 };
  const media: [number, number, number, number] = [0, 0, 595, 842];
  const vp = (name: string, bbox: [number, number, number, number]) =>
    viewportToPdf({ name, bbox, scale: s5 });
  const page = vp('Page', media);
  const a = vp('Detail A', [300, 400, 550, 700]);
  const b = vp('Detail B', [10, 10, 100, 100]);
  it('stays when it is moved, resized or re-scaled in place', () => {
    const moved = entryWithBox(a, [310, 400, 560, 700]);
    expect(samePick([page, a, b], [page, moved, b], 1, media)).toBe(true);
  });
  it('goes when a viewport is added or deleted, or another is at its index', () => {
    expect(samePick([page, a, b], [page, b], 1, media)).toBe(false);
    expect(samePick([page, a], [page, a, b], 1, media)).toBe(false);
    expect(samePick([page, a, b], [page, b, a], 1, media)).toBe(false);
    expect(samePick([a, page], [a, vp('Page', media)], 1, media)).toBe(false);
  });
});
