// "From the current view" (M6-11, §7.15): New Bookmark and Set Destination
// remember the current page, the point of it at the view's top-left corner
// and the zoom — Fit Page and Fit Width as such, any other zoom as its
// factor. Destinations are in PDF user space (origin bottom-left), the
// inverse of destination.ts.
import { documentStore } from '../../app/store/documentStore';
import type { DestSpec } from '../../model/outline';
import { pagePointAt, pageSizeOf, viewOf } from '../view/pagePoint';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round = (v: number): number => Math.round(v * 100) / 100;

/** The current page's top: where a destination without a known point goes. */
export function pageTopDest(docId: string, page: number): DestSpec {
  const size = pageSizeOf(docId, page);
  return { page, fit: 'xyz', left: 0, top: size ? size.height : null, zoom: null };
}

export function currentDest(docId: string): DestSpec | null {
  const d = documentStore.getState().docs[docId];
  if (!d) return null;
  const page = d.view.page;
  const size = pageSizeOf(docId, page);
  let left: number | null = 0;
  let top: number | null = size ? size.height : null;
  const view = viewOf(docId);
  const el = view?.querySelector<HTMLElement>(`.page[data-page="${String(page)}"]`);
  if (view && el && size) {
    const v = view.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    // The view's top-left corner, kept on the page (a margin or the gap above it).
    const p = pagePointAt(
      docId,
      clamp(v.left, b.left, b.right - 1),
      clamp(v.top, b.top, b.bottom - 1),
    );
    if (p?.page === page) {
      left = round(p.x);
      top = round(size.height - p.y);
    }
  }
  const zoom = d.view.zoom;
  if (zoom === 'fitPage') return { page, fit: 'fit' };
  if (zoom === 'fitWidth') return { page, fit: 'fitH', top };
  return { page, fit: 'xyz', left, top, zoom: round(d.view.scale) };
}
