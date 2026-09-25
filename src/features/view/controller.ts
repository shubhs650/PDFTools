// Zoom and page actions on the active document (§5, M1-15), for commands,
// the status bar and the keyboard. Thin: the zoom and scroll plugins do the
// work; fit visible and actual size are computed here (ADR-011 decision 5).
import type { DocumentManagerCapability } from '@embedpdf/plugin-document-manager';
import type { ScrollCapability, ScrollScope } from '@embedpdf/plugin-scroll';
import { ZoomMode, type ZoomCapability, type ZoomScope } from '@embedpdf/plugin-zoom';
import { documentStore, type ZoomSetting } from '../../app/store/documentStore';
import { capability, hostStore, renderEngine } from './host';
import { movePage, type PageMove } from './navigation';
import { PAGE_GAP } from './plugins';
import { clampZoom, fitVisibleZoom, rotateBox, stepZoom, type Box } from './zoom';

interface Active {
  docId: string;
  zoom: ZoomScope;
  scroll: ScrollScope;
  dm: DocumentManagerCapability;
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

export function goToPage(index: number): void {
  const a = active();
  if (!a) return;
  a.scroll.scrollToPage({ pageNumber: index + 1 });
}

export function move(m: PageMove): void {
  const a = active();
  if (!a) return;
  const doc = documentStore.getState().docs[a.docId];
  if (!doc) return;
  goToPage(movePage(doc.view.page, m, doc.meta.pageCount));
}
