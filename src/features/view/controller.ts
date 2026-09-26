// Zoom and page actions on the active document (§5, M1-15), for commands,
// the status bar and the keyboard. Thin: the zoom and scroll plugins do the
// work; fit visible and actual size are computed here (ADR-011 decision 5).
import type { DocumentManagerCapability } from '@embedpdf/plugin-document-manager';
import type { RotateCapability } from '@embedpdf/plugin-rotate';
import type { ScrollCapability, ScrollScope } from '@embedpdf/plugin-scroll';
import { SpreadMode, type SpreadCapability } from '@embedpdf/plugin-spread';
import { ZoomMode, type ZoomCapability, type ZoomScope } from '@embedpdf/plugin-zoom';
import { documentStore, type ViewMode, type ZoomSetting } from '../../app/store/documentStore';
import { capability, hostStore, renderEngine } from './host';
import { movePage, type PageMove } from './navigation';
import { PAGE_GAP } from './plugins';
import { isFacing, rotateView, spreadIndexOf, spreadsFor, toQuarterTurns } from './viewModes';
import { clampZoom, fitVisibleZoom, rotateBox, stepZoom, type Box } from './zoom';

interface Active {
  docId: string;
  zoom: ZoomScope;
  scroll: ScrollScope;
  dm: DocumentManagerCapability;
  spread: SpreadCapability;
  rotate: RotateCapability;
}

function active(): Active | null {
  const registry = hostStore.getState().registry;
  const docId = documentStore.getState().activeId;
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

/** Zoom by factor, at a viewport point if given (Ctrl+wheel keeps it under the cursor). */
export function zoomTo(factor: number, center?: { vx: number; vy: number }): void {
  const a = active();
  if (!a) return;
  fitVisibleLevels.delete(a.docId);
  a.zoom.requestZoom(clampZoom(factor), center);
}

export function zoomStep(dir: 1 | -1): void {
  zoomTo(stepZoom(currentScale(), dir));
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
  // The store first: paged modes hold scrolling to the store's page.
  documentStore.getState().setView(a.docId, { page: index });
  a.scroll.scrollToPage({ pageNumber: index + 1, behavior: 'instant' });
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
  if (!a) return;
  const view = documentStore.getState().docs[a.docId]?.view;
  if (!view) return;
  const rotation = rotateView(view.rotation, dir);
  documentStore.getState().setView(a.docId, { rotation });
  a.rotate.forDocument(a.docId).setRotation(toQuarterTurns(rotation));
  keepPage(a, view.page);
}
