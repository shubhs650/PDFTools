// Zoom and page actions on the active document (§5, M1-15), for commands,
// the status bar and the keyboard. Thin: the zoom and scroll plugins do the
// work; fit visible and actual size are computed here (ADR-011 decision 5).
import type { DocumentManagerCapability } from '@embedpdf/plugin-document-manager';
import type { RotateCapability } from '@embedpdf/plugin-rotate';
import type { ScrollCapability, ScrollScope } from '@embedpdf/plugin-scroll';
import { SpreadMode, type SpreadCapability } from '@embedpdf/plugin-spread';
import { ZoomMode, type ZoomCapability, type ZoomScope } from '@embedpdf/plugin-zoom';
import {
  documentStore,
  type Rotation,
  type ViewMode,
  type ZoomSetting,
} from '../../app/store/documentStore';
import { capability, hostStore, renderEngine } from './host';
import type { ViewTarget } from './destination';
import type { ViewEntry } from './history';
import { movePage, type PageMove } from './navigation';
import { PAGE_GAP } from './plugins';
import { isFacing, rotateView, spreadIndexOf, spreadsFor, toQuarterTurns } from './viewModes';
import { clampZoom, fitVisibleZoom, rotateBox, stepZoom, type Box } from './zoom';
import {
  areaZoom,
  distanceTo,
  fractionIn,
  scrollToPlace,
  type Area,
  type Point,
} from './zoomAreaModel';

interface Active {
  docId: string;
  zoom: ZoomScope;
  scroll: ScrollScope;
  dm: DocumentManagerCapability;
  spread: SpreadCapability;
  rotate: RotateCapability;
}

/** The active document, or `docId` (a window acting on its own document, S27 change 4). */
function active(only?: string): Active | null {
  const registry = hostStore.getState().registry;
  const docId = only ?? documentStore.getState().activeId;
  if (!registry || !docId) return null;
  const dm = capability<DocumentManagerCapability>(registry, 'document-manager');
  if (!dm.isDocumentOpen(docId)) return null;
  return {
    docId,
    dm,
    zoom: capability<ZoomCapability>(registry, 'zoom').forDocument(docId),
    scroll: capability<ScrollCapability>(registry, 'scroll').forDocument(docId),
    spread: capability<SpreadCapability>(registry, 'spread'),
    rotate: capability<RotateCapability>(registry, 'rotate'),
  };
}

/** Fit-visible factor last requested per document, so the state sync keeps the label. */
export const fitVisibleLevels = new Map<string, number>();

export type ZoomTarget = ZoomSetting | 'actualSize';

export function currentScale(): number {
  const a = active();
  return a ? a.zoom.getState().currentZoomLevel : 1;
}

/**
 * Zoom by factor, at a viewport point if given (Ctrl+wheel keeps it under the cursor);
 * `docId`: that document's window instead of the active document's.
 */
export function zoomTo(factor: number, center?: { vx: number; vy: number }, docId?: string): void {
  const a = active(docId);
  if (!a) return;
  fitVisibleLevels.delete(a.docId);
  a.zoom.requestZoom(clampZoom(factor), center);
}

export function zoomStep(dir: 1 | -1): void {
  zoomTo(stepZoom(currentScale(), dir));
}

/** Zoom In / Zoom Out by one stop at a point of the view (a click with Zoom to Area). */
export function zoomStepAt(dir: 1 | -1, at: { vx: number; vy: number }): void {
  const vp = viewportElement();
  if (!vp) return;
  const view = viewBox(vp);
  zoomAnchored(stepZoom(currentScale(), dir), at, { x: view.left + at.vx, y: view.top + at.vy });
}

/** The visible part of the scroller, in client pixels. */
function viewBox(vp: HTMLElement): { left: number; top: number; width: number; height: number } {
  const r = vp.getBoundingClientRect();
  return {
    left: r.left + vp.clientLeft,
    top: r.top + vp.clientTop,
    width: vp.clientWidth,
    height: vp.clientHeight,
  };
}

/** The page nearest a client point and where the point lies in it. */
function pageAnchor(vp: HTMLElement, p: Point): { page: string; f: Point; width: number } | null {
  let best: { page: string; f: Point; width: number } | null = null;
  let bestD = Infinity;
  for (const el of vp.querySelectorAll<HTMLElement>('.page[data-page]:not([data-hidden])')) {
    const r = el.getBoundingClientRect();
    const d = distanceTo(p, r);
    if (d < bestD && el.dataset['page'] !== undefined) {
      bestD = d;
      best = { page: el.dataset['page'], f: fractionIn(p, r), width: r.width };
    }
  }
  return best;
}

/** Frames to wait for the pages to take their new size after a zoom. */
const SETTLE_FRAMES = 30;

/**
 * Zooms to `to` around the view point `at`, then, once the pages have their
 * new size, scrolls the same point of the same page to `target` (client
 * pixels). The zoom plugin keeps `at` only roughly (its gaps and centring
 * drift by a few pixels), and Zoom to Area moves it to the middle anyway.
 */
function zoomAnchored(to: number, at: { vx: number; vy: number }, target: Point): void {
  const a = active();
  const vp = viewportElement();
  if (!a || !vp) return;
  const from = a.zoom.getState().currentZoomLevel;
  const view = viewBox(vp);
  const anchor = pageAnchor(vp, { x: view.left + at.vx, y: view.top + at.vy });
  fitVisibleLevels.delete(a.docId);
  a.zoom.requestZoom(clampZoom(to), at);
  if (!anchor) return;
  const docId = a.docId;
  const expected = (anchor.width * a.zoom.getState().currentZoomLevel) / from;
  let frames = 0;
  const place = (): void => {
    if (documentStore.getState().activeId !== docId) return;
    const el = vp.querySelector<HTMLElement>(`.page[data-page="${anchor.page}"]`);
    const r = el?.getBoundingClientRect();
    if (!r || Math.abs(r.width - expected) > 2) {
      if (++frames < SETTLE_FRAMES) requestAnimationFrame(place);
      return;
    }
    const d = scrollToPlace(r, anchor.f, target);
    vp.scrollLeft += d.x;
    vp.scrollTop += d.y;
  };
  requestAnimationFrame(place);
}

/**
 * Zoom to Area (M11-08·O4): the area (viewport pixels) fills the window, its
 * middle in the middle of the view.
 */
export function zoomToArea(area: Area): void {
  const vp = viewportElement();
  if (!vp) return;
  const view = viewBox(vp);
  const to = areaZoom(area, { width: view.width, height: view.height }, currentScale(), PAGE_GAP);
  const mid = { vx: area.left + area.width / 2, vy: area.top + area.height / 2 };
  zoomAnchored(to, mid, { x: view.left + view.width / 2, y: view.top + view.height / 2 });
}

export async function setZoom(target: ZoomTarget): Promise<void> {
  const a = active();
  if (!a) return;
  if (target === 'fitVisible') {
    await fitVisible(a);
    return;
  }
  fitVisibleLevels.delete(a.docId);
  if (target === 'fitPage') a.zoom.requestZoom(ZoomMode.FitPage);
  else if (target === 'fitWidth') a.zoom.requestZoom(ZoomMode.FitWidth);
  else a.zoom.requestZoom(target === 'actualSize' ? 1 : clampZoom(target));
}

function viewportElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#document-panel .viewport');
}

/** Fit visible (§5): the current page's content fills the width, margins scroll off. */
async function fitVisible(a: Active): Promise<void> {
  const pageIndex = documentStore.getState().docs[a.docId]?.view.page ?? 0;
  const page = a.dm.getDocument(a.docId)?.pages[pageIndex];
  const vp = viewportElement();
  if (!page || !vp) return;
  const raw = await renderEngine().rpc.call('contentBox', { docId: a.docId, pageIndex }).promise;
  const rotation =
    (((page.rotation + (a.dm.getDocumentState(a.docId)?.rotation ?? 0)) % 4) + 4) % 4;
  const box: Box | null = raw ? rotateBox(raw, page.size, rotation * 90) : null;
  const factor = box ? fitVisibleZoom(box, vp.clientWidth, PAGE_GAP) : null;
  if (factor === null || !box) {
    await setZoom('fitWidth');
    return;
  }
  fitVisibleLevels.set(a.docId, factor);
  const off = a.zoom.onZoomChange(() => {
    off();
    // After the zoom has been applied, bring the content's left edge into view.
    requestAnimationFrame(() => {
      const el = vp.querySelector<HTMLElement>(`[data-page="${String(pageIndex)}"]`);
      if (!el) return;
      const pageLeft = el.getBoundingClientRect().left - vp.getBoundingClientRect().left;
      vp.scrollLeft += pageLeft + box.left * factor - PAGE_GAP;
    });
  });
  a.zoom.requestZoom(factor);
}

/** Jumps (no smooth scrolling: the page box and keys must land at once). */
export function goToPage(index: number): void {
  const a = active();
  if (!a) return;
  stopKeepingPlace(); // a jump wins over a pane's kept place
  // The store first: paged modes hold scrolling to the store's page.
  documentStore.getState().setView(a.docId, { page: index });
  a.scroll.scrollToPage({ pageNumber: index + 1, behavior: 'instant' });
}

/**
 * Brings a point of a page (points from the unrotated page's top-left) into
 * view, about a third down the window (a search hit, a link target, M2-07/10).
 */
export function goToPoint(index: number, x: number, y: number, alignY = 30): void {
  const a = active();
  if (!a) return;
  stopKeepingPlace();
  documentStore.getState().setView(a.docId, { page: index });
  a.scroll.scrollToPage({
    pageNumber: index + 1,
    pageCoordinates: { x, y },
    behavior: 'instant',
    alignX: alignY === 0 ? 0 : 50,
    alignY,
  });
}

/** Runs `fn` once the scroller has laid out again (after a zoom), or soon if nothing changes. */
function afterLayout(a: Active, fn: () => void): void {
  let done = false;
  const go = (): void => {
    if (done) return;
    done = true;
    off();
    fn();
  };
  const off = a.scroll.onLayoutChange(() => {
    requestAnimationFrame(go);
  });
  setTimeout(go, 150);
}

/** A destination (bookmark, link, M2-10): its zoom first, then its point at the top. */
export function goToTarget(t: ViewTarget): void {
  const a = active();
  if (!a) return;
  const go = (): void => {
    if (t.point) goToPoint(t.page, t.point.x, t.point.y, 0);
    else goToPage(t.page);
  };
  if (t.zoom === 'keep') {
    go();
    return;
  }
  fitVisibleLevels.delete(a.docId);
  if (t.zoom === 'fitPage') a.zoom.requestZoom(ZoomMode.FitPage);
  else if (t.zoom === 'fitWidth') a.zoom.requestZoom(ZoomMode.FitWidth);
  else a.zoom.requestZoom(clampZoom(t.zoom));
  afterLayout(a, go);
}

/** The active document's view as a history entry (M2-10). */
export function currentView(): { docId: string; entry: ViewEntry } | null {
  const a = active();
  const vp = viewportElement();
  const page = a ? documentStore.getState().docs[a.docId]?.view.page : undefined;
  if (!a || !vp || page === undefined) return null;
  return {
    docId: a.docId,
    entry: {
      page,
      scale: a.zoom.getState().currentZoomLevel,
      scrollLeft: vp.scrollLeft,
      scrollTop: vp.scrollTop,
    },
  };
}

/** Previous / Next View: the zoom, then the exact scroll position. */
export function restoreView(e: ViewEntry): void {
  const a = active();
  if (!a) return;
  const place = (): void => {
    const vp = viewportElement();
    if (!vp) return;
    vp.scrollLeft = e.scrollLeft;
    vp.scrollTop = e.scrollTop;
  };
  documentStore.getState().setView(a.docId, { page: e.page });
  if (Math.abs(a.zoom.getState().currentZoomLevel - e.scale) < 1e-6) {
    place();
    return;
  }
  fitVisibleLevels.delete(a.docId);
  a.zoom.requestZoom(e.scale);
  afterLayout(a, place);
}

/** First/previous/next/last page; in the facing modes previous/next move by spread. */
export function move(m: PageMove): void {
  const a = active();
  if (!a) return;
  const doc = documentStore.getState().docs[a.docId];
  if (!doc) return;
  const { page, mode } = doc.view;
  if ((m === 'prev' || m === 'next') && isFacing(mode)) {
    const spreads = spreadsFor(doc.meta.pageCount, true);
    const i = spreadIndexOf(spreads, page) + (m === 'next' ? 1 : -1);
    const target = spreads[Math.max(0, Math.min(spreads.length - 1, i))]?.[0];
    if (target !== undefined) goToPage(target);
    return;
  }
  goToPage(movePage(page, m, doc.meta.pageCount));
}

/** After a layout change (mode, rotation), bring `page` back into view. */
function keepPage(a: Active, page: number): void {
  let done = false;
  const go = (): void => {
    if (done) return;
    done = true;
    off();
    a.scroll.scrollToPage({ pageNumber: page + 1, behavior: 'instant' });
  };
  const off = a.scroll.onLayoutChange(() => {
    requestAnimationFrame(go);
  });
  // The layout may already be current (nothing to wait for).
  setTimeout(go, 100);
}

/** §5 view modes; the current page stays in view (M1-16). */
export function setViewMode(mode: ViewMode): void {
  const a = active();
  if (!a) return;
  const view = documentStore.getState().docs[a.docId]?.view;
  if (!view || view.mode === mode) return;
  documentStore.getState().setView(a.docId, { mode });
  a.spread.forDocument(a.docId).setSpreadMode(isFacing(mode) ? SpreadMode.Odd : SpreadMode.None);
  keepPage(a, view.page);
}

/** Rotate view (not the page): view state only, never a document change or dirty flag. */
export function rotate(dir: 1 | -1): void {
  const a = active();
  const view = a ? documentStore.getState().docs[a.docId]?.view : undefined;
  if (view) setViewRotation(rotateView(view.rotation, dir));
}

/** The view rotation itself (a file's last view, D-53); the current page stays in view. */
export function setViewRotation(rotation: Rotation): void {
  const a = active();
  if (!a) return;
  const view = documentStore.getState().docs[a.docId]?.view;
  if (!view || view.rotation === rotation) return;
  documentStore.getState().setView(a.docId, { rotation });
  a.rotate.forDocument(a.docId).setRotation(toQuarterTurns(rotation));
  keepPage(a, view.page);
}

/** A reading place: the point of a page at the top left of the view. */
interface Place {
  docId: string;
  page: number;
  x: number;
  y: number;
}

/** Ends a kept place at once: a jump (a page, a search hit, a link) goes where it was sent. */
function stopKeepingPlace(): void {
  if (!keeping) return;
  window.clearTimeout(keeping.timer);
  keeping.off();
  keeping = null;
}

/** How long a width change may take to reach the layout (the pane's re-render, the fit zoom). */
const KEEP_PLACE_MS = 400;
let keeping: { place: Place; until: number; off: () => void; timer: number } | null = null;

/**
 * Keeps the reading place while the view changes width: a side pane shown, hidden or
 * resized (M11-10, D-56). Call it before the change. A fit-width view re-zooms when its
 * width changes and its pages change height, so without this the same scroll offset lands
 * on another page. During a drag, the place from the start of the drag is kept.
 */
export function keepPlace(): void {
  const now = performance.now();
  if (keeping && now < keeping.until) {
    keeping.until = now + KEEP_PLACE_MS;
    return;
  }
  const a = active();
  if (!a) return;
  const top = [...a.scroll.getMetrics().pageVisibilityMetrics].sort(
    (p, q) => p.viewportY - q.viewportY,
  )[0];
  if (!top) return;
  const place: Place = {
    docId: a.docId,
    page: top.pageNumber,
    x: top.original.pageX,
    y: top.original.pageY,
  };
  const restore = (): void => {
    const b = active();
    if (b?.docId !== place.docId) return;
    // scrollToPage puts the point a viewport gap below the top; take it off again.
    const gap = PAGE_GAP / b.zoom.getState().currentZoomLevel;
    b.scroll.scrollToPage({
      pageNumber: place.page,
      pageCoordinates: { x: place.x, y: place.y - gap },
      behavior: 'instant',
    });
  };
  const off = a.scroll.onLayoutChange(() => {
    requestAnimationFrame(restore);
  });
  const end = (): void => {
    if (!keeping) return;
    if (performance.now() < keeping.until) {
      keeping.timer = window.setTimeout(end, KEEP_PLACE_MS);
      return;
    }
    keeping.off();
    keeping = null;
  };
  keeping = {
    place,
    until: now + KEEP_PLACE_MS,
    off,
    timer: window.setTimeout(end, KEEP_PLACE_MS),
  };
}
