import type { DocumentManagerCapability } from '@embedpdf/plugin-document-manager';
import { Scroller, type PageLayout } from '@embedpdf/plugin-scroll/react';
import type { ScrollCapability } from '@embedpdf/plugin-scroll';
import { TilingLayer } from '@embedpdf/plugin-tiling/react';
import { Viewport } from '@embedpdf/plugin-viewport/react';
import { ZoomMode, type ZoomCapability, type ZoomDocumentState } from '@embedpdf/plugin-zoom';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { appStore, useApp } from '../../app/store/appStore';
import { isEditable } from '../../app/keys/useShortcuts';
import { documentStore, useDocuments, type ZoomSetting } from '../../app/store/documentStore';
import { fitVisibleLevels, move, zoomTo } from './controller';
import { capability, useHost } from './host';
import { PreviewLayer } from './PreviewLayer';
import { setViewFocus } from './tileScheduler';
import { wheelZoom } from './zoom';

/** The user's zoom choice as the store names it (fit visible is ours, numeric in the plugin). */
function zoomSetting(docId: string, state: ZoomDocumentState): ZoomSetting {
  const level = state.zoomLevel;
  if (level === ZoomMode.FitPage) return 'fitPage';
  if (level === ZoomMode.FitWidth || level === ZoomMode.Automatic) return 'fitWidth';
  // The plugin floors levels to 0.001.
  const fit = fitVisibleLevels.get(docId);
  return fit !== undefined && Math.abs(fit - level) < 0.002 ? 'fitVisible' : level;
}

const VIEW_TEST_ID = 'document-view';
const REGION = 'region';

function Page({ documentId, layout }: { documentId: string; layout: PageLayout }) {
  return (
    <div
      className="page"
      data-page={layout.pageIndex}
      style={{ width: layout.width, height: layout.height }}
    >
      <PreviewLayer documentId={documentId} pageIndex={layout.pageIndex} />
      <TilingLayer documentId={documentId} pageIndex={layout.pageIndex} className="page-tiles" />
    </div>
  );
}

/**
 * The active document (§5, D-09): EmbedPDF's virtual scroller; each page is a
 * bounded preview under 256 px tiles (ADR-011). The scroll container is
 * focusable and named, so the keyboard reaches it (rule 12).
 */
export function DocumentView({ documentId }: { documentId: string }) {
  const name = useDocuments((s) => s.docs[documentId]?.meta.name ?? '');
  const registry = useHost((s) => s.registry);
  const ready = useDocuments((s) => s.docs[documentId] !== undefined);

  const tool = useApp((s) => (s.spaceHand ? 'hand' : s.tool));
  const host = useRef<HTMLDivElement>(null);
  const [panning, setPanning] = useState(false);
  const pan = useRef<{ x: number; y: number; id: number } | null>(null);

  // Page and zoom state → the document store (status bar, commands, recovery).
  useEffect(() => {
    if (!registry) return;
    const dm = capability<DocumentManagerCapability>(registry, 'document-manager');
    if (!dm.isDocumentOpen(documentId)) return;
    const scroll = capability<ScrollCapability>(registry, 'scroll').forDocument(documentId);
    const zoom = capability<ZoomCapability>(registry, 'zoom').forDocument(documentId);
    const store = documentStore.getState();
    setViewFocus(documentId, store.docs[documentId]?.view.page ?? 0);
    const syncZoom = (state: ZoomDocumentState): void => {
      documentStore.getState().setView(documentId, {
        zoom: zoomSetting(documentId, state),
        scale: state.currentZoomLevel,
      });
    };
    syncZoom(zoom.getState());
    const offs = [
      scroll.onPageChange((e) => {
        const page = e.pageNumber - 1;
        setViewFocus(documentId, page);
        documentStore.getState().setView(documentId, { page });
      }),
      zoom.onStateChange(syncZoom),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [registry, documentId]);

  // Ctrl+wheel (and trackpad pinch) zooms at the pointer instead of the browser page.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const vp = el.querySelector<HTMLElement>('.viewport');
      if (!vp) return;
      const r = vp.getBoundingClientRect();
      const scale = documentStore.getState().docs[documentId]?.view.scale ?? 1;
      const delta = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 40 : e.deltaY;
      zoomTo(wheelZoom(scale, delta), { vx: e.clientX - r.left, vy: e.clientY - r.top });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
    };
  }, [documentId]);

  // Space held = Hand until released (§8.1); released anywhere.
  useEffect(() => {
    const up = (e: globalThis.KeyboardEvent): void => {
      if (e.key === ' ') appStore.getState().setSpaceHand(false);
    };
    const blur = (): void => {
      appStore.getState().setSpaceHand(false);
    };
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.altKey || e.metaKey || isEditable(e.target as Element)) return;
    if (e.key === 'Home' || e.key === 'End') {
      // First / last page (§5), not the scroll container's own jump.
      e.preventDefault();
      move(e.key === 'Home' ? 'first' : 'last');
    } else if (e.key === ' ') {
      e.preventDefault(); // no page-down scroll while Space means Hand
      if (!e.repeat) appStore.getState().setSpaceHand(true);
    }
  };

  const scroller = (): HTMLElement | null =>
    host.current?.querySelector<HTMLElement>('.viewport') ?? null;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (tool !== 'hand' || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pan.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    setPanning(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const p = pan.current;
    const vp = scroller();
    if (p?.id !== e.pointerId || !vp) return;
    vp.scrollLeft -= e.clientX - p.x;
    vp.scrollTop -= e.clientY - p.y;
    pan.current = { ...p, x: e.clientX, y: e.clientY };
  };
  const endPan = (e: PointerEvent<HTMLDivElement>): void => {
    if (pan.current?.id !== e.pointerId) return;
    pan.current = null;
    setPanning(false);
  };

  if (!ready) return null;
  return (
    <div ref={host} className="document-host" data-tool={tool} data-panning={panning || undefined}>
      <Viewport
        documentId={documentId}
        className="viewport ui-focusable"
        data-testid={VIEW_TEST_ID}
        data-doc-id={documentId}
        role={REGION}
        aria-label={name}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        <Scroller
          documentId={documentId}
          renderPage={(layout) => <Page documentId={documentId} layout={layout} />}
        />
      </Viewport>
    </div>
  );
}
