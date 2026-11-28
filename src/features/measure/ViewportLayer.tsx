// Scale viewports on the page (M3-17; edited on the page in M14-09, D-77,
// Q22, Q36). Their labelled outlines show while the Measure tab is shown or
// the viewport tool is on, and the one picked in the Scales section on any tab.
// On the Measure tab with Select, a viewport is an object on the page: a click
// on its border (or its label) selects it, a drag moves it, its eight handles
// resize it, Delete removes it, a double-click or Enter opens its name and
// scale. The selected viewport's label and handles are buttons, so the arrow
// keys move it or a handle (Shift: 10 pt); the Scales section reaches every
// viewport from the keyboard (rule 12). On other tabs the borders take no
// clicks. Every change goes through changeScales: one undo step, and the
// measurements using the viewport follow with a note (M14-04's rule).
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { PointerEvent } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store/appStore';
import { securityOf, useDocuments } from '../../app/store/documentStore';
import { format } from '../../i18n';
import { allows } from '../../model/permissions';
import { ratioLabel } from '../../model/scale';
import {
  BOX_HANDLES,
  handlePoint,
  moveRect,
  resizeRect,
  stepHandle,
  type BoxHandle,
  type Rect,
} from '../../model/viewportEdit';
import { deselectAnnotations } from '../annotate/commands';
import { pointOnPage } from '../view/pagePoint';
import { clearPickedViewport, measurePaneStore, useMeasurePane } from './pane/measureEntries';
import { layoutFor, useScales } from './scaleStore';
import {
  deleteViewport,
  editViewport,
  frameOf,
  nudgeViewport,
  rectOfBox,
  setViewportRect,
  useViewports,
} from './viewports';

const STEP = 1;
const BIG_STEP = 10;
/** A press that moves less than this (CSS px) is a click, not a drag. */
const DRAG_SLOP = 3;

const ARROWS: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

const EDGES = ['n', 'e', 's', 'w'] as const;

/** Each handle's accessible name (literal keys, rule 11). */
function handleName(t: TFunction, h: BoxHandle, name: string): string {
  const names: Record<BoxHandle, string> = {
    nw: t('viewport.onPage.resize.nw', { name }),
    n: t('viewport.onPage.resize.n', { name }),
    ne: t('viewport.onPage.resize.ne', { name }),
    e: t('viewport.onPage.resize.e', { name }),
    se: t('viewport.onPage.resize.se', { name }),
    s: t('viewport.onPage.resize.s', { name }),
    sw: t('viewport.onPage.resize.sw', { name }),
    w: t('viewport.onPage.resize.w', { name }),
  };
  return names[h];
}

/** A drag in progress: which pointer, which viewport, a move or a handle. */
interface Drag {
  pointer: number;
  index: number;
  what: 'move' | BoxHandle;
  from: { x: number; y: number };
  base: Rect;
  started: boolean;
  /** Takes off the drag's Esc listener. */
  off: () => void;
}

interface Item {
  index: number;
  name: string;
  label: string;
  rect: Rect;
}

export function ViewportLayer({
  documentId,
  pageIndex,
  scale,
}: {
  documentId: string;
  pageIndex: number;
  scale: number;
}) {
  const { t } = useTranslation();
  const hintId = useId();
  const tab = useApp((s) => s.ribbonTab);
  const tool = useApp((s) => s.tool);
  const onMeasure = tab === 'measure' || tool === 'scaleViewport';
  const active = useDocuments((s) => s.activeId === documentId);
  const canEdit = useDocuments((s) => {
    const meta = s.docs[documentId]?.meta;
    return meta ? allows(securityOf(meta), 'annotate') : false;
  });
  // Borders take clicks on the Measure tab with Select only (Q22).
  const editable = active && canEdit && tab === 'measure' && tool === 'select';
  const picked = useMeasurePane((s) =>
    s.viewport?.docId === documentId && s.viewport.page === pageIndex ? s.viewport.index : null,
  );
  const shown = onMeasure || picked !== null;
  const entry = useScales((s) => s.docs[documentId]);
  const draft = useViewports((s) => (s.draft?.page === pageIndex ? s.draft : null));
  const [live, setLive] = useState<{ index: number; rect: Rect } | null>(null);
  const drag = useRef<Drag | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  const items = useMemo((): Item[] => {
    if (!shown || !entry) return [];
    return layoutFor({ docs: { [documentId]: entry } }, documentId, pageIndex)
      .details.filter((d) => onMeasure || d.index === picked)
      .map((d) => ({
        index: d.index,
        name: d.name,
        label: `${d.name} ${ratioLabel(d.scale, format)}`,
        rect: rectOfBox(documentId, pageIndex, d.bbox),
      }));
  }, [shown, onMeasure, picked, entry, documentId, pageIndex]);

  // A drag ends if the layer goes (tab or tool changed mid-drag).
  useEffect(
    () => () => {
      drag.current?.off();
    },
    [],
  );

  if (items.length === 0 && !draft) return null;

  const focusLabel = (): void => {
    requestAnimationFrame(() => {
      layer.current
        ?.querySelector<HTMLElement>('[data-viewport-frame]')
        ?.focus({ preventScroll: true });
    });
  };

  const select = (index: number): void => {
    deselectAnnotations();
    measurePaneStore.setState({ viewport: { docId: documentId, page: pageIndex, index } });
  };

  const startDrag = (e: PointerEvent<HTMLElement>, index: number, what: Drag['what']): void => {
    if (e.button !== 0 || !editable) return;
    const item = items.find((i) => i.index === index);
    const from = pointOnPage(documentId, pageIndex, e.clientX, e.clientY);
    if (!item || !from) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    select(index);
    // Esc drops the drag: the viewport stays as it was.
    const onKey = (k: globalThis.KeyboardEvent): void => {
      if (k.key !== 'Escape') return;
      k.preventDefault();
      k.stopPropagation();
      drag.current?.off();
      drag.current = null;
      setLive(null);
    };
    window.addEventListener('keydown', onKey, true);
    drag.current = {
      pointer: e.pointerId,
      index,
      what,
      from,
      base: item.rect,
      // A handle resizes at once; a border moves after a few pixels.
      started: what !== 'move',
      off: () => {
        window.removeEventListener('keydown', onKey, true);
      },
    };
  };

  const onMove = (e: PointerEvent<HTMLElement>): void => {
    const d = drag.current;
    if (d?.pointer !== e.pointerId) return;
    e.stopPropagation();
    const p = pointOnPage(documentId, pageIndex, e.clientX, e.clientY);
    if (!p) return;
    const dx = p.x - d.from.x;
    const dy = p.y - d.from.y;
    if (!d.started && Math.hypot(dx, dy) * scale < DRAG_SLOP) return;
    d.started = true;
    const size = frameOf(documentId, pageIndex);
    const rect =
      d.what === 'move' ? moveRect(d.base, dx, dy, size) : resizeRect(d.base, d.what, p, size);
    setLive({ index: d.index, rect });
  };

  const finish = (e: PointerEvent<HTMLElement>, keep: boolean): void => {
    const d = drag.current;
    if (d?.pointer !== e.pointerId) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    d.off();
    const now = live?.index === d.index ? live.rect : null;
    setLive(null);
    if (keep && d.started && now) setViewportRect(documentId, pageIndex, d.index, now);
    focusLabel();
  };

  const pointerProps = (index: number, what: Drag['what']) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      startDrag(e, index, what);
    },
    onPointerMove: onMove,
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      e.stopPropagation();
      finish(e, true);
    },
    onPointerCancel: (e: PointerEvent<HTMLElement>) => {
      finish(e, false);
    },
    onLostPointerCapture: (e: PointerEvent<HTMLElement>) => {
      finish(e, true);
    },
  });

  const onFrameKey = (item: Item) => (e: KeyboardEvent<HTMLElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      deleteViewport(documentId, pageIndex, item.index);
      clearPickedViewport();
    } else if (e.key === 'Enter') {
      editViewport(documentId, pageIndex, item.index);
    } else if (e.key === 'Escape') {
      clearPickedViewport();
    } else {
      const dir = ARROWS[e.key];
      if (!dir) return;
      const n = e.shiftKey ? BIG_STEP : STEP;
      nudgeViewport(documentId, pageIndex, item.index, dir.x * n, dir.y * n);
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const onHandleKey = (item: Item, h: BoxHandle) => (e: KeyboardEvent<HTMLElement>) => {
    const dir = ARROWS[e.key];
    if (!dir || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    const n = e.shiftKey ? BIG_STEP : STEP;
    const size = frameOf(documentId, pageIndex);
    setViewportRect(
      documentId,
      pageIndex,
      item.index,
      stepHandle(item.rect, h, dir.x * n, dir.y * n, size),
    );
  };

  const px = (r: Rect) => ({
    left: r.left * scale,
    top: r.top * scale,
    width: r.width * scale,
    height: r.height * scale,
  });

  return (
    <div
      className={editable ? 'viewport-layer viewport-layer--editable' : 'viewport-layer'}
      ref={layer}
      // The page's pointer handlers (marquee, tools) leave presses on viewports alone.
      data-no-interaction={editable || undefined}
      data-viewport-ui=""
    >
      {editable ? (
        <span id={hintId} hidden>
          {t('viewport.onPage.hint')}
        </span>
      ) : null}
      {items.map((item) => {
        const isPicked = item.index === picked;
        const rect = live?.index === item.index ? live.rect : item.rect;
        const selected = editable && isPicked;
        return (
          <div
            key={item.index}
            className={isPicked ? 'viewport-outline viewport-outline--picked' : 'viewport-outline'}
            data-testid="viewport-outline"
            data-viewport-index={item.index}
            data-dragging={live?.index === item.index || undefined}
            style={px(rect)}
          >
            {editable ? (
              // One element whether selected or not, so a press that selects
              // it keeps its pointer capture for the drag that follows.
              <button
                type="button"
                className="viewport-label viewport-label--button ui-focusable"
                data-viewport-frame={selected ? '' : undefined}
                data-testid={selected ? 'viewport-frame' : undefined}
                tabIndex={selected ? 0 : -1}
                aria-hidden={selected ? undefined : true}
                aria-label={
                  selected ? t('viewport.onPage.frame', { label: item.label }) : undefined
                }
                aria-describedby={selected ? hintId : undefined}
                onKeyDown={onFrameKey(item)}
                onDoubleClick={() => {
                  editViewport(documentId, pageIndex, item.index);
                }}
                {...pointerProps(item.index, 'move')}
              >
                {item.label}
              </button>
            ) : (
              <span className="viewport-label" aria-hidden="true">
                {item.label}
              </span>
            )}
            {editable
              ? EDGES.map((edge) => (
                  // The border itself, for the pointer: the keyboard has the label (above).
                  <div
                    key={edge}
                    className={`viewport-edge viewport-edge--${edge}`}
                    data-testid="viewport-edge"
                    aria-hidden="true"
                    onDoubleClick={() => {
                      editViewport(documentId, pageIndex, item.index);
                    }}
                    {...pointerProps(item.index, 'move')}
                  />
                ))
              : null}
            {selected
              ? BOX_HANDLES.map((h) => {
                  const p = handlePoint(
                    { left: 0, top: 0, width: rect.width, height: rect.height },
                    h,
                  );
                  return (
                    <button
                      key={h}
                      type="button"
                      className={`viewport-handle viewport-handle--${h} ui-focusable`}
                      data-testid="viewport-handle"
                      data-handle={h}
                      aria-label={handleName(t, h, item.name)}
                      title={handleName(t, h, item.name)}
                      style={{ left: p.x * scale, top: p.y * scale }}
                      onKeyDown={onHandleKey(item, h)}
                      {...pointerProps(item.index, h)}
                    />
                  );
                })
              : null}
          </div>
        );
      })}
      {draft ? (
        <div
          className="viewport-outline viewport-outline--draft"
          style={{
            left: Math.min(draft.a.x, draft.b.x) * scale,
            top: Math.min(draft.a.y, draft.b.y) * scale,
            width: Math.abs(draft.b.x - draft.a.x) * scale,
            height: Math.abs(draft.b.y - draft.a.y) * scale,
          }}
        />
      ) : null}
    </div>
  );
}
