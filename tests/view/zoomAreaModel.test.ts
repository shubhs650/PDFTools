import { describe, expect, it } from 'vitest';
import { createAppStore, effectiveTool } from '../../src/app/store/appStore';
import { MAX_ZOOM, MIN_ZOOM } from '../../src/features/view/plugins';
import {
  MIN_AREA_SIDE,
  areaBetween,
  areaZoom,
  distanceTo,
  fractionIn,
  isAreaDrag,
  scrollToPlace,
} from '../../src/features/view/zoomAreaModel';

const view = { width: 1020, height: 620 };
const GAP = 10; // 1000 × 600 inside the gaps

describe('Zoom to Area (M11-08·O4)', () => {
  it('takes the rectangle between two pointer positions, whichever way it was dragged', () => {
    const r = { left: 10, top: 20, width: 90, height: 30 };
    expect(areaBetween({ x: 10, y: 20 }, { x: 100, y: 50 })).toEqual(r);
    expect(areaBetween({ x: 100, y: 50 }, { x: 10, y: 20 })).toEqual(r);
    expect(areaBetween({ x: 100, y: 20 }, { x: 10, y: 50 })).toEqual(r);
  });

  it('treats a press that hardly moved as a click', () => {
    expect(isAreaDrag({ left: 0, top: 0, width: 3, height: 4 })).toBe(false);
    expect(isAreaDrag({ left: 0, top: 0, width: MIN_AREA_SIDE, height: 0 })).toBe(true);
    expect(isAreaDrag({ left: 0, top: 0, width: 200, height: 2 })).toBe(true);
  });

  it('fills the window with the area: the side that fits less decides', () => {
    // 250 × 100 at 100 %: 4× fits the width, 6× the height → 4×.
    expect(areaZoom({ left: 0, top: 0, width: 250, height: 100 }, view, 1, GAP)).toBeCloseTo(4);
    // A tall area: 100 × 300 → 10× and 2× → 2×; from 50 % that is 100 %.
    expect(areaZoom({ left: 0, top: 0, width: 100, height: 300 }, view, 0.5, GAP)).toBeCloseTo(1);
  });

  it('fits a thin drag along a line by its length only', () => {
    expect(areaZoom({ left: 0, top: 0, width: 500, height: 2 }, view, 1, GAP)).toBeCloseTo(2);
    expect(areaZoom({ left: 0, top: 0, width: 3, height: 300 }, view, 1, GAP)).toBeCloseTo(2);
  });

  it('stays within the zoom range', () => {
    expect(areaZoom({ left: 0, top: 0, width: 10, height: 10 }, view, 32, GAP)).toBe(MAX_ZOOM);
    expect(areaZoom({ left: 0, top: 0, width: 1e6, height: 1e6 }, view, 1, GAP)).toBe(MIN_ZOOM);
    // A larger area than the window zooms out.
    expect(areaZoom({ left: 0, top: 0, width: 2000, height: 600 }, view, 1, GAP)).toBeCloseTo(0.5);
  });

  it('keeps the zoom when nothing can be measured', () => {
    expect(areaZoom({ left: 0, top: 0, width: 2, height: 2 }, view, 1.5, GAP)).toBe(1.5);
    expect(
      areaZoom({ left: 0, top: 0, width: 100, height: 100 }, { width: 10, height: 10 }, 2, GAP),
    ).toBe(2);
  });

  it('finds where a point lies in a page and the nearest page to a point', () => {
    const page = { left: 100, top: 200, width: 400, height: 800 };
    expect(fractionIn({ x: 300, y: 400 }, page)).toEqual({ x: 0.5, y: 0.25 });
    expect(fractionIn({ x: 0, y: 0 }, { left: 0, top: 0, width: 0, height: 0 })).toEqual({
      x: 0.5,
      y: 0.5,
    });
    expect(distanceTo({ x: 300, y: 400 }, page)).toBe(0);
    expect(distanceTo({ x: 90, y: 1010 }, page)).toBe(10 * 10 + 10 * 10);
  });

  it('scrolls the anchored point of the page to where it belongs', () => {
    const page = { left: -500, top: -1000, width: 4000, height: 8000 };
    // The page's middle is at (1500, 3000); the view's middle at (550, 400).
    expect(scrollToPlace(page, { x: 0.5, y: 0.5 }, { x: 550, y: 400 })).toEqual({
      x: 950,
      y: 2600,
    });
    expect(scrollToPlace(page, { x: 0.25, y: 0 }, { x: 500, y: -1000 })).toEqual({ x: 0, y: 0 });
  });

  it('Z held wins over the tool and Space; choosing a tool lets it go', () => {
    const s = createAppStore();
    s.getState().setTool('hand');
    expect(effectiveTool(s.getState())).toBe('hand');
    s.getState().setZoomHold(true);
    expect(effectiveTool(s.getState())).toBe('zoomArea');
    s.getState().setSpaceHand(true);
    expect(effectiveTool(s.getState())).toBe('zoomArea');
    s.getState().setZoomHold(false);
    expect(effectiveTool(s.getState())).toBe('hand');
    s.getState().setZoomHold(true);
    s.getState().setTool('select');
    expect(s.getState().zoomHold).toBe(false);
    expect(effectiveTool(s.getState())).toBe('select');
  });
});
