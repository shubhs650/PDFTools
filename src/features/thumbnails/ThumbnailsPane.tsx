import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { format } from '../../i18n';
import { movePages } from '../pages/commands';
import { dropIndex, moveByOne, moveTo } from '../pages/move';
import { usePages as usePageOps } from '../pages/pageOps';
import { clickPage, setSelection, usePageSelection } from '../pages/selection';
import { PageMenu } from './PageMenu';
import { goToPage } from '../view/controller';
import { useHost } from '../view/host';
import { thumbLayout, visibleRange } from './layout';
import { thumbnails } from './loader';

/** Thumbnail image width in CSS px. */
const THUMB_WIDTH = 120;
const LABEL_HEIGHT = 20;
const GAP = 12;

interface PageInfo {
  width: number;
  height: number;
  /** Quarter turns of the page's own /Rotate (EmbedPDF normalizes page space). */
  rotation: number;
}

function usePages(documentId: string | null): PageInfo[] {
  const registry = useHost((s) => s.registry);
  // Page operations replace the page list (M4-09).
  const version = usePageOps((s) => (documentId ? (s.version[documentId] ?? 0) : 0));
  return useMemo(() => {
    if (!registry || !documentId) return [];
    const doc = registry.getStore().getState().core.documents[documentId]?.document;
    return (doc?.pages ?? []).map((p) => ({
      width: p.size.width,
      height: p.size.height,
      rotation: p.rotation,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version: the page list changed in place
  }, [registry, documentId, version]);
}

/**
 * Thumbnails pane (§5, M2-08): a virtualized list of every page. Only the
 * items in view are rendered and ask for images (loader.ts: one at a time,
 * nearest the page in view first, paused while the document scrolls). The
 * current page is marked; click or Enter jumps; arrows, Home and End move.
 * Multi-selection (M4-09) for the Organize commands: Ctrl/Cmd+click and
 * Ctrl+Space toggle, Shift+click and Shift+arrows extend; the context menu
 * (right click, Shift+F10 or the Menu key) offers the page commands.
 * Reorder (M4-10): drag thumbnails (an insertion marker shows where they go;
 * the list scrolls near its edges; Esc cancels) or Alt+↑ / Alt+↓; the new
 * position is announced.
 */
export function ThumbnailsPane() {
  const { t } = useTranslation();
  const documentId = useDocuments((s) => s.activeId);
  const current = useDocuments((s) => (s.activeId ? (s.docs[s.activeId]?.view.page ?? 0) : 0));
  const pages = usePages(documentId);
  const version = usePageOps((s) => (documentId ? (s.version[documentId] ?? 0) : 0));
  const selection = usePageSelection(documentId);
  // One selected page is the current page (the selection follows navigation).
  const multi = selection.selected.length > 1;
  const [menu, setMenu] = useState<{ x: number; y: number; page: number } | null>(null);
  const announcement = usePageOps((s) => s.announcement);
  /** A drag in progress: the pages and where they would drop (an insertion index). */
  const [drag, setDrag] = useState<{ pages: number[]; drop: number } | null>(null);
  const press = useRef<{ x: number; y: number; page: number; id: number } | null>(null);
  const dragging = useRef<{ pages: number[]; drop: number; clientY: number } | null>(null);
  const suppressClick = useRef(false);
  const shown = useMemo(
    () =>
      pages.map((p) =>
        p.rotation % 2
          ? { width: p.height, height: p.width }
          : { width: p.width, height: p.height },
      ),
    [pages],
  );
  const layout = useMemo(
    () => thumbLayout(shown, { width: THUMB_WIDTH, labelHeight: LABEL_HEIGHT, gap: GAP }),
    [shown],
  );
  const list = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(600);
  const [focused, setFocused] = useState(current);
  // The roving tab stop follows the page in view (adjusted while rendering),
  // but never while focus is in the list: keyboard focus is the user's.
  const [followed, setFollowed] = useState(current);
  const [inList, setInList] = useState(false);
  if (followed !== current) {
    setFollowed(current);
    if (!inList) setFocused(current);
  }
  const focusAfterMove = useRef(false);

  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setViewHeight(el.clientHeight);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  // Keep the current page in view as the document moves (and reprioritize loads).
  useEffect(() => {
    thumbnails.reprioritize((r) => Math.abs(r.pageIndex - current));
    const el = list.current;
    const top = layout.tops[current];
    const bottom = layout.tops[current + 1];
    if (!el || top === undefined || bottom === undefined) return;
    if (top < el.scrollTop || bottom > el.scrollTop + el.clientHeight)
      el.scrollTop = Math.max(0, top - GAP);
  }, [current, layout]);

  // Keyboard moves: focus the item once it is rendered (move() scrolled it into view).
  useEffect(() => {
    if (!focusAfterMove.current) return;
    const item = list.current?.querySelector<HTMLElement>(`[data-thumb="${String(focused)}"]`);
    if (!item) return;
    focusAfterMove.current = false;
    item.focus();
  }, [focused, scrollTop]);

  if (!documentId || pages.length === 0) {
    return <p className="pane-empty">{t('thumbnails.empty')}</p>;
  }

  const [first, last] = visibleRange(layout, scrollTop, viewHeight, 3);
  const move = (to: number): void => {
    const i = Math.max(0, Math.min(pages.length - 1, to));
    const el = list.current;
    if (el) {
      const top = layout.tops[i] ?? 0;
      const bottom = layout.tops[i + 1] ?? top;
      if (top < el.scrollTop) el.scrollTop = Math.max(0, top - GAP);
      else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
      setScrollTop(el.scrollTop); // render the items there now, not on the scroll event
    }
    focusAfterMove.current = true;
    setFocused(i);
  };
  const extend = (to: number): void => {
    const i = Math.max(0, Math.min(pages.length - 1, to));
    if (documentId) clickPage(documentId, i, { shift: true, toggle: false });
    move(i);
  };
  /** While dragging near the list's top or bottom edge, scroll it (one frame at a time). */
  const startAutoScroll = (): void => {
    const step = (): void => {
      const d = dragging.current;
      const el = list.current;
      if (!d || !el) return;
      const r = el.getBoundingClientRect();
      const edge = 40;
      const dy = d.clientY < r.top + edge ? -16 : d.clientY > r.bottom - edge ? 16 : 0;
      if (dy) {
        el.scrollTop += dy;
        const drop = dropIndex(layout.tops, d.clientY - r.top + el.scrollTop);
        dragging.current = { ...d, drop };
        setDrag({ pages: d.pages, drop });
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const endDrag = (pointerId: number | null): void => {
    dragging.current = null;
    setDrag(null);
    const el = list.current;
    if (el && pointerId !== null && el.hasPointerCapture(pointerId))
      el.releasePointerCapture(pointerId);
  };
  const openMenuAt = (i: number): void => {
    const item = list.current?.querySelector<HTMLElement>(`[data-thumb="${String(i)}"]`);
    const r = item?.getBoundingClientRect();
    setMenu({ x: r ? r.left + r.width / 2 : 0, y: r ? r.top + r.height / 2 : 0, page: i });
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && dragging.current) {
      e.preventDefault();
      endDrag(null);
      press.current = null;
      return;
    }
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      if (documentId && !selection.selected.includes(focused))
        clickPage(documentId, focused, { shift: false, toggle: false });
      openMenuAt(focused);
      return;
    }
    if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const moving = multi && selection.selected.includes(focused) ? selection.selected : [focused];
      const to = moveByOne(moving, e.key === 'ArrowDown' ? 1 : -1, pages.length);
      if (to === null || !documentId) return;
      const offset = [...moving].sort((a, b) => a - b).indexOf(focused);
      void movePages(documentId, moving, to).then((ok) => {
        if (ok) move(to + Math.max(0, offset));
      });
      return;
    }
    if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      extend(focused + (e.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === ' ') {
      e.preventDefault();
      if (documentId) clickPage(documentId, focused, { shift: false, toggle: true });
      return;
    }
    if (e.key === 'Escape' && documentId && selection.selected.length) {
      e.preventDefault();
      setSelection(documentId, { selected: [], anchor: focused });
      return;
    }
    const perView = Math.max(1, last - first - 6);
    const keys: Record<string, () => void> = {
      ArrowDown: () => {
        move(focused + 1);
      },
      ArrowUp: () => {
        move(focused - 1);
      },
      PageDown: () => {
        move(focused + perView);
      },
      PageUp: () => {
        move(focused - perView);
      },
      Home: () => {
        move(0);
      },
      End: () => {
        move(pages.length - 1);
      },
      Enter: () => {
        if (documentId) clickPage(documentId, focused, { shift: false, toggle: false });
        goToPage(focused);
      },
      ' ': () => {
        if (documentId) clickPage(documentId, focused, { shift: false, toggle: false });
        goToPage(focused);
      },
    };
    const action = keys[e.key];
    if (!action) return;
    e.preventDefault();
    action();
  };

  // The focused item stays rendered (and focused) when the list scrolls elsewhere.
  const indexes = [];
  for (let i = first; i <= last; i++) indexes.push(i);
  if (focused < first || focused > last) indexes.push(focused);
  const items = [];
  for (const i of indexes) {
    const s = shown[i];
    const p = pages[i];
    if (!s || !p) continue;
    items.push(
      <div
        key={i}
        role="option"
        aria-selected={multi ? selection.selected.includes(i) : i === current}
        aria-current={i === current ? 'page' : undefined}
        tabIndex={i === focused ? 0 : -1}
        data-pane-focus={i === focused || undefined}
        data-thumb={i}
        className={[
          'thumb',
          i === current ? 'thumb--current' : '',
          multi && selection.selected.includes(i) ? 'thumb--selected' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ top: layout.tops[i] }}
        onFocus={() => {
          setFocused(i);
        }}
      >
        <div className="thumb-image" style={{ width: THUMB_WIDTH, height: layout.imageHeights[i] }}>
          {documentId ? (
            <ThumbImage
              key={version}
              documentId={documentId}
              pageIndex={i}
              page={p}
              width={THUMB_WIDTH}
              priority={Math.abs(i - current)}
            />
          ) : null}
        </div>
        <span className="thumb-label">{format.number(i + 1, 0)}</span>
      </div>,
    );
  }

  return (
    <>
      <div
        ref={list}
        className="thumb-list"
        role="listbox"
        aria-label={t('thumbnails.list')}
        aria-multiselectable="true"
        tabIndex={-1}
        onFocus={() => {
          setInList(true);
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setInList(false);
        }}
        onPointerDown={(e) => {
          const item = (e.target as HTMLElement).closest<HTMLElement>('[data-thumb]');
          if (!item || e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey) return;
          press.current = {
            x: e.clientX,
            y: e.clientY,
            page: Number(item.dataset['thumb']),
            id: e.pointerId,
          };
        }}
        onPointerMove={(e) => {
          const p = press.current;
          const el = list.current;
          if (!p || !el || p.id !== e.pointerId) return;
          if (!dragging.current) {
            if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return;
            const moving =
              multi && selection.selected.includes(p.page) ? [...selection.selected] : [p.page];
            dragging.current = { pages: moving, drop: p.page, clientY: e.clientY };
            el.setPointerCapture(e.pointerId);
            startAutoScroll();
          }
          const rect = el.getBoundingClientRect();
          const drop = dropIndex(layout.tops, e.clientY - rect.top + el.scrollTop);
          dragging.current = { ...dragging.current, drop, clientY: e.clientY };
          setDrag({ pages: dragging.current.pages, drop });
        }}
        onPointerUp={(e) => {
          const d = dragging.current;
          press.current = null;
          if (!d) return;
          endDrag(e.pointerId);
          suppressClick.current = true;
          const to = moveTo(d.pages, d.drop, pages.length);
          if (to !== null && documentId) void movePages(documentId, d.pages, to);
        }}
        onPointerCancel={(e) => {
          press.current = null;
          if (dragging.current) endDrag(e.pointerId);
        }}
        onClick={(e: MouseEvent) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          const item = (e.target as HTMLElement).closest<HTMLElement>('[data-thumb]');
          if (!item) return;
          const i = Number(item.dataset['thumb']);
          setFocused(i);
          const mods = { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey };
          if (documentId) clickPage(documentId, i, mods);
          if (!mods.shift && !mods.toggle) goToPage(i);
        }}
        onContextMenu={(e: MouseEvent) => {
          const item = (e.target as HTMLElement).closest<HTMLElement>('[data-thumb]');
          if (!item || !documentId) return;
          e.preventDefault();
          const i = Number(item.dataset['thumb']);
          setFocused(i);
          if (!selection.selected.includes(i))
            clickPage(documentId, i, { shift: false, toggle: false });
          setMenu({ x: e.clientX, y: e.clientY, page: i });
        }}
        onScroll={(e) => {
          setScrollTop(e.currentTarget.scrollTop);
        }}
        onKeyDown={onKeyDown}
      >
        <div className="thumb-content" style={{ height: layout.tops[pages.length] }}>
          {items}
          {drag && moveTo(drag.pages, drag.drop, pages.length) !== null ? (
            <div
              className="thumb-drop-marker"
              aria-hidden="true"
              style={{ top: Math.max(0, (layout.tops[drag.drop] ?? 0) - GAP / 2) }}
            />
          ) : null}
        </div>
        {menu && documentId ? (
          <PageMenu
            docId={documentId}
            x={menu.x}
            y={menu.y}
            page={menu.page}
            onClose={() => {
              setMenu(null);
            }}
          />
        ) : null}
      </div>
      <div className="ui-visually-hidden" role="status" aria-live="polite">
        {announcement}
      </div>
    </>
  );
}

function ThumbImage({
  documentId,
  pageIndex,
  page,
  width,
  priority,
}: {
  documentId: string;
  pageIndex: number;
  page: PageInfo;
  width: number;
  priority: number;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const turned = page.rotation % 2 === 1;
  // Rendered unrotated (both render paths), turned by CSS like the viewer's pages.
  const renderWidth = turned ? (width * page.width) / page.height : width;
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio;
  const scale = (renderWidth * dpr) / page.width;

  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;
    const job = thumbnails.request({ docId: documentId, pageIndex, scale, priority });
    job.promise.then(
      (blob) => {
        if (!live) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      },
      () => undefined,
    );
    return () => {
      live = false;
      job.cancel();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- priority changes go through reprioritize(), not a new request
  }, [documentId, pageIndex, scale]);

  if (!url) return null;
  const h = (renderWidth * page.height) / page.width;
  return (
    <img
      className="thumb-img"
      src={url}
      alt=""
      draggable={false}
      style={{
        width: renderWidth,
        height: h,
        transform: page.rotation ? `rotate(${String(page.rotation * 90)}deg)` : undefined,
      }}
    />
  );
}
