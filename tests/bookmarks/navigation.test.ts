import { PdfZoomMode, type PdfDestinationObject } from '@embedpdf/models';
import { describe, expect, it } from 'vitest';
import { destinationView } from '../../src/features/view/destination';

// M2-10: destinations → view (the view history: tests/view/viewHistory.test.ts).

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
