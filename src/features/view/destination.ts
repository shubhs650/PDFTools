// PDF destinations → where the view goes (M2-10, ADR-012 "Consequences":
// zoom modes map to fit page, fit width and XYZ, zoom 0 keeping the current
// zoom). Destination coordinates are PDF user space (origin bottom-left);
// the viewer's page space has its origin top-left. Pure.
import { PdfZoomMode, type PdfDestinationObject } from '@embedpdf/models';

export type TargetZoom = 'keep' | 'fitPage' | 'fitWidth' | number;

export interface ViewTarget {
  page: number;
  zoom: TargetZoom;
  /** A point to bring into view (top-left page space, points); null: the page top. */
  point: { x: number; y: number } | null;
}

const finite = (n: number | undefined): n is number => typeof n === 'number' && Number.isFinite(n);

export function destinationView(dest: PdfDestinationObject, pageHeight: number): ViewTarget {
  const page = dest.pageIndex;
  const v = dest.view;
  const top = (y: number | undefined) => (finite(y) ? Math.max(0, pageHeight - y) : 0);
  switch (dest.zoom.mode) {
    case PdfZoomMode.XYZ: {
      const { x, y, zoom } = dest.zoom.params;
      // A missing coordinate comes back as 0: x keeps the left edge, y the page top.
      return {
        page,
        zoom: zoom > 0 ? zoom : 'keep',
        point: { x: Math.max(0, x), y: y > 0 ? top(y) : 0 },
      };
    }
    case PdfZoomMode.FitPage:
    case PdfZoomMode.FitBoundingBox:
      return { page, zoom: 'fitPage', point: null };
    case PdfZoomMode.FitHorizontal:
    case PdfZoomMode.FitBoundingBoxHorizontal:
      return { page, zoom: 'fitWidth', point: { x: 0, y: top(v[0]) } };
    case PdfZoomMode.FitVertical:
    case PdfZoomMode.FitBoundingBoxVertical:
      return { page, zoom: 'fitPage', point: { x: Math.max(0, v[0] ?? 0), y: 0 } };
    case PdfZoomMode.FitRectangle:
      // [left bottom right top]: its top-left corner, at the current zoom.
      return { page, zoom: 'keep', point: { x: Math.max(0, v[0] ?? 0), y: top(v[3]) } };
    default:
      return { page, zoom: 'keep', point: null };
  }
}
