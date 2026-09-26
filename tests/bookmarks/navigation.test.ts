import { PdfZoomMode, type PdfDestinationObject } from '@embedpdf/models';
import { describe, expect, it } from 'vitest';
import { destinationView } from '../../src/features/view/destination';
import { ViewHistory, type ViewEntry } from '../../src/features/view/history';

// M2-10: destinations → view, and the view history.

const dest = (
  zoom: PdfDestinationObject['zoom'],
  view: number[] = [],
  pageIndex = 4,
): PdfDestinationObject => ({ pageIndex, zoom, view });

describe('destinationView', () => {
  it('XYZ: the point (flipped to top-left space) and its zoom; zoom 0 keeps the current one', () => {
    expect(
      destinationView(dest({ mode: PdfZoomMode.XYZ, params: { x: 72, y: 700, zoom: 1.5 } }), 842),
    ).toEqual({ page: 4, zoom: 1.5, point: { x: 72, y: 142 } });
    expect(
      destinationView(dest({ mode: PdfZoomMode.XYZ, params: { x: 0, y: 0, zoom: 0 } }), 842),
    ).toEqual({ page: 4, zoom: 'keep', point: { x: 0, y: 0 } });
  });

  it('Fit, FitH, FitV, FitR and unknown', () => {
    expect(destinationView(dest({ mode: PdfZoomMode.FitPage }), 842)).toEqual({
      page: 4,
      zoom: 'fitPage',
      point: null,
    });
    expect(destinationView(dest({ mode: PdfZoomMode.FitHorizontal }, [600]), 842)).toEqual({
      page: 4,
      zoom: 'fitWidth',
      point: { x: 0, y: 242 },
    });
    expect(destinationView(dest({ mode: PdfZoomMode.FitVertical }, [100]), 842)).toMatchObject({
      zoom: 'fitPage',
      point: { x: 100, y: 0 },
    });
    expect(
      destinationView(dest({ mode: PdfZoomMode.FitRectangle }, [50, 100, 300, 800]), 842),
    ).toEqual({ page: 4, zoom: 'keep', point: { x: 50, y: 42 } });
    expect(destinationView(dest({ mode: PdfZoomMode.Unknown }), 842)).toEqual({
      page: 4,
      zoom: 'keep',
      point: null,
    });
  });
});

const at = (page: number, scrollTop = page * 1000): ViewEntry => ({
  page,
  scale: 1,
  scrollLeft: 0,
  scrollTop,
});

describe('ViewHistory', () => {
  it('goes back and forward like a browser', () => {
    const h = new ViewHistory();
    expect(h.canBack).toBe(false);
    h.jump(at(0)); // 0 → 10
    h.jump(at(10)); // 10 → 20
    expect(h.goBack(at(20))).toEqual(at(10));
    expect(h.goBack(at(10))).toEqual(at(0));
    expect(h.goBack(at(0))).toBeNull();
    expect(h.goForward(at(0))).toEqual(at(10));
    expect(h.goForward(at(10))).toEqual(at(20));
    expect(h.canForward).toBe(false);
  });

  it('a jump after going back drops the forward entries (branching)', () => {
    const h = new ViewHistory();
    h.jump(at(0));
    h.jump(at(10));
    h.goBack(at(20)); // at 10, forward: 20
    h.jump(at(10)); // 10 → 30
    expect(h.canForward).toBe(false);
    expect(h.goBack(at(30))).toEqual(at(10));
  });

  it('ignores a repeated jump from the same view and keeps at most `cap` entries', () => {
    const h = new ViewHistory(3);
    h.jump(at(1));
    h.jump(at(1));
    for (let i = 2; i <= 6; i++) h.jump(at(i));
    const back: number[] = [];
    for (let e = h.goBack(at(7)); e; e = h.goBack(at(0))) back.push(e.page);
    expect(back).toEqual([6, 5, 4]);
  });
});
