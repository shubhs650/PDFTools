import { useDocumentState } from '@embedpdf/core/react';
import type { DocumentManagerCapability } from '@embedpdf/plugin-document-manager';
import type { InteractionManagerCapability } from '@embedpdf/plugin-interaction-manager';
import { PagePointerProvider } from '@embedpdf/plugin-interaction-manager/react';
import { Rotate } from '@embedpdf/plugin-rotate/react';
import { Scroller, type PageLayout } from '@embedpdf/plugin-scroll/react';
import type { ScrollCapability } from '@embedpdf/plugin-scroll';
import { TextSelection } from '@embedpdf/plugin-selection/react';
import { TilingLayer } from '@embedpdf/plugin-tiling/react';
import { Viewport } from '@embedpdf/plugin-viewport/react';
import { ZoomMode, type ZoomCapability, type ZoomDocumentState } from '@embedpdf/plugin-zoom';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { appStore, useApp } from '../../app/store/appStore';
import { isEditable } from '../../app/keys/useShortcuts';
import { documentStore, useDocuments, type ZoomSetting } from '../../app/store/documentStore';
import { HighlightLayer } from '../search/HighlightLayer';
import { reportActivity } from '../search/indexing';
import { fitVisibleLevels, move, zoomTo } from './controller';
import { FormLayer } from '../forms/FormLayer';
import { LockModeType } from '@embedpdf/plugin-annotation';
import { AnnotationLayer } from '../annotate/AnnotationLayer';
import { AnnotationTileLayer } from '../annotate/AnnotationTileLayer';
import { SelectionAnnouncer } from '../annotate/SelectionAnnouncer';
import { annotationCapability } from '../annotate/selection';
import { isDrawTool } from '../annotate/tools/drawModel';
import { NumberOverlay } from '../annotate/comments/NumberOverlay';
import { isMarkupTool } from '../annotate/tools/markupModel';
import { LinkLayer } from './LinkLayer';
import { capability, useHost } from './host';
import { HAND_MODE, PAGE_GAP, POINTER_MODE } from './plugins';
import { PreviewLayer } from './PreviewLayer';
import { setViewFocus } from './tileScheduler';
import {
  clampToRange,
  isFacing,
  isPaged,
  pagedScrollRange,
  spreadIndexOf,
  spreadsFor,
  unionSpan,
  type Span,
} from './viewModes';
import { wheelZoom } from './zoom';

/** Wheel page turns in the paged modes: at most one per this interval. */
const PAGE_TURN_COOLDOWN_MS = 350;

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
/** Selected text: a token, drawn with multiply over the page (rules 11–12: no literal colors). */
const SELECTION_COLOR = 'var(--color-text-selection)';
const REGION = 'region';

/**
 * One page: its layers in unrotated page space, turned by the rotate plugin
 * into the rotated box the scroller laid out. In the paged modes, pages
 * outside the current page or spread keep their place but draw nothing.
 */
function Page({
  documentId,
  layout,
  hidden,
}: {
  documentId: string;
  layout: PageLayout;
  hidden: boolean;
}) {
  const doc = useDocumentState(documentId);
  const size = doc?.document?.pages[layout.pageIndex]?.size;
  const scale = doc?.scale ?? 1;
  return (
    <div
      className="page"
      data-page={layout.pageIndex}
      data-hidden={hidden || undefined}
      style={{ width: layout.rotatedWidth, height: layout.rotatedHeight }}
    >
      {hidden || !size ? null : (
        <Rotate documentId={documentId} pageIndex={layout.pageIndex}>
          <PagePointerProvider documentId={documentId} pageIndex={layout.pageIndex}>
            <div
              className="page-content"
              style={{ width: size.width * scale, height: size.height * scale }}
            >
              <PreviewLayer documentId={documentId} pageIndex={layout.pageIndex} />
              <TilingLayer
                documentId={documentId}
                pageIndex={layout.pageIndex}
                className="page-tiles"
                // Sharp copies of the preview (whose <img> has alt=""): EmbedPDF's
                // tiles have no alt, so the whole layer is hidden from assistive tech.
                aria-hidden
              />
              {/* Markups (M3-05, ADR-014): our annotation tiles over the content tiles. */}
              <AnnotationTileLayer
                documentId={documentId}
                pageIndex={layout.pageIndex}
                scale={scale}
              />
              <HighlightLayer documentId={documentId} pageIndex={layout.pageIndex} scale={scale} />
              {/* Text selection (M2-04): geometry loads for pages laid out here only. */}
              <TextSelection
                documentId={documentId}
                pageIndex={layout.pageIndex}
                background={SELECTION_COLOR}
              />
              {/* Annotation hit areas, selection and handles (M3-05) above the text layer. */}
              <AnnotationLayer documentId={documentId} pageIndex={layout.pageIndex} scale={scale} />
              {/* Comment numbers (M3-11), when switched on. */}
              <NumberOverlay documentId={documentId} pageIndex={layout.pageIndex} scale={scale} />
              {/* Links (M2-10) sit above the text layer, so a click follows them. */}
              <LinkLayer documentId={documentId} pageIndex={layout.pageIndex} scale={scale} />
              {/* Form fields (M2-14) on top: a field under a link is still filled. */}
              <FormLayer documentId={documentId} pageIndex={layout.pageIndex} scale={scale} />
            </div>
          </PagePointerProvider>
        </Rotate>
      )}
    </div>
  );
}

/** Where the current page or spread sits in the scroll content (paged modes). */
function currentSpan(vp: HTMLElement, pages: readonly number[]): Span | null {
  const base = vp.getBoundingClientRect().top - vp.scrollTop;
  const spans: Span[] = [];
  for (const i of pages) {
    const el = vp.querySelector<HTMLElement>(`[data-page="${String(i)}"]`);
    if (!el) return null; // not laid out yet (virtualized)
    const r = el.getBoundingClientRect();
    spans.push({ top: r.top - base, bottom: r.bottom - base });
  }
  return unionSpan(spans);
}

/** The pages of the spread holding the store's current page, for a document. */
function currentPages(documentId: string): number[] {
  const d = documentStore.getState().docs[documentId];
  if (!d) return [];
  const spreads = spreadsFor(d.meta.pageCount, isFacing(d.view.mode));
  return spreads[spreadIndexOf(spreads, d.view.page)] ?? [];
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
  const mode = useDocuments((s) => s.docs[documentId]?.view.mode ?? 'continuous');
  const page = useDocuments((s) => s.docs[documentId]?.view.page ?? 0);
  const pageCount = useDocuments((s) => s.docs[documentId]?.meta.pageCount ?? 0);
  const paged = isPaged(mode);
  const shown = useMemo(() => {
    const spreads = spreadsFor(pageCount, isFacing(mode));
    return new Set(spreads[spreadIndexOf(spreads, page)] ?? []);
  }, [pageCount, mode, page]);
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
      zoom.onStateChange((state) => {
        reportActivity();
        syncZoom(state);
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [registry, documentId]);

  // Scrolling, zooming and other input pause background indexing (M2-06, ADR-006).
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onScroll = (): void => {
      reportActivity();
    };
    el.addEventListener('scroll', onScroll, { capture: true, passive: true });
    // Any input on the document counts too (clicks, keys, wheel before it scrolls).
    for (const type of ['pointerdown', 'keydown', 'wheel'] as const)
      el.addEventListener(type, onScroll, { capture: true, passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll, { capture: true });
      for (const type of ['pointerdown', 'keydown', 'wheel'] as const)
        el.removeEventListener(type, onScroll, { capture: true });
    };
  }, [documentId]);

  // The pointer tool → EmbedPDF's interaction mode: Select selects text, Hand pans (M2-04).
  useEffect(() => {
    if (!registry) return;
    const dm = capability<DocumentManagerCapability>(registry, 'document-manager');
    if (!dm.isDocumentOpen(documentId)) return;
    const im = capability<InteractionManagerCapability>(registry, 'interaction-manager');
    // A text markup tool is the annotation plugin's interaction mode of the same id (M3-08).
    im.forDocument(documentId).activate(
      tool === 'hand' ? HAND_MODE : isMarkupTool(tool) || isDrawTool(tool) ? tool : POINTER_MODE,
    );
    // Select Text and Hand never pick up annotations (M3-05); Select and Select Objects do.
    try {
      annotationCapability()
        ?.forDocument(documentId)
        .setLocked(
          tool === 'select' || tool === 'selectObjects'
            ? { type: LockModeType.None }
            : { type: LockModeType.All },
        );
    } catch {
      // The plugin's document state comes with the document's load.
    }
  }, [registry, documentId, tool]);

  // Ctrl+wheel (and trackpad pinch) zooms at the pointer instead of the browser page.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let lastTurn = 0;
    const onWheel = (e: WheelEvent): void => {
      const vp = el.querySelector<HTMLElement>('.viewport');
      if (!vp) return;
      if (!e.ctrlKey && !e.metaKey) {
        pagedWheel(e, vp);
        return;
      }
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      const scale = documentStore.getState().docs[documentId]?.view.scale ?? 1;
      const delta = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 40 : e.deltaY;
      zoomTo(wheelZoom(scale, delta), { vx: e.clientX - r.left, vy: e.clientY - r.top });
    };
    // Paged modes: scroll within the page or spread; past its edge, turn the page.
    const pagedWheel = (e: WheelEvent, vp: HTMLElement): void => {
      const d = documentStore.getState().docs[documentId];
      if (!d || !isPaged(d.view.mode)) return;
      const span = currentSpan(vp, currentPages(documentId));
      if (!span) return;
      e.preventDefault();
      const range = pagedScrollRange(span, vp.clientHeight, PAGE_GAP);
      const delta = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 40 : e.deltaY;
      const atEnd = delta > 0 ? vp.scrollTop >= range.bottom - 1 : vp.scrollTop <= range.top + 1;
      if (atEnd && delta !== 0) {
        if (performance.now() - lastTurn < PAGE_TURN_COOLDOWN_MS) return;
        lastTurn = performance.now();
        move(delta > 0 ? 'next' : 'prev');
        return;
      }
      vp.scrollTop = clampToRange(vp.scrollTop + delta, range);
      vp.scrollLeft += e.deltaX;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
    };
  }, [documentId]);

  // Paged modes: hold scrolling (scrollbar, arrows, Hand) within the page or spread.
  useEffect(() => {
    if (!paged) return;
    const vp = host.current?.querySelector<HTMLElement>('.viewport');
    if (!vp) return;
    const clamp = (): void => {
      const span = currentSpan(vp, currentPages(documentId));
      if (!span) return;
      const range = pagedScrollRange(span, vp.clientHeight, PAGE_GAP);
      const top = clampToRange(vp.scrollTop, range);
      if (Math.abs(top - vp.scrollTop) > 0.5) vp.scrollTop = top;
    };
    vp.addEventListener('scroll', clamp, { passive: true });
    clamp();
    return () => {
      vp.removeEventListener('scroll', clamp);
    };
  }, [paged, page, documentId]);

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
    } else if (paged && (e.key === 'PageDown' || e.key === 'PageUp')) {
      e.preventDefault(); // paged modes turn the page (or spread)
      move(e.key === 'PageDown' ? 'next' : 'prev');
    } else if (e.key === ' ' && !(e.target as Element).closest('button, input')) {
      // Not on a control over the page (a link, a checkbox or radio field): Space presses it.
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
    <div
      ref={host}
      className="document-host"
      data-tool={tool}
      data-panning={panning || undefined}
      data-mode={mode}
    >
      <SelectionAnnouncer documentId={documentId} />
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
          renderPage={(layout) => (
            <Page
              documentId={documentId}
              layout={layout}
              hidden={paged && !shown.has(layout.pageIndex)}
            />
          )}
        />
      </Viewport>
    </div>
  );
}
