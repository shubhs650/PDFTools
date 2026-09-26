import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { format } from '../../i18n';
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
  return useMemo(() => {
    if (!registry || !documentId) return [];
    const doc = registry.getStore().getState().core.documents[documentId]?.document;
    return (doc?.pages ?? []).map((p) => ({
      width: p.size.width,
      height: p.size.height,
      rotation: p.rotation,
    }));
  }, [registry, documentId]);
}

/**
 * Thumbnails pane (§5, M2-08): a virtualized list of every page. Only the
 * items in view are rendered and ask for images (loader.ts: one at a time,
 * nearest the page in view first, paused while the document scrolls). The
 * current page is marked; click or Enter jumps; arrows, Home and End move.
 */
export function ThumbnailsPane() {
  const { t } = useTranslation();
  const documentId = useDocuments((s) => s.activeId);
  const current = useDocuments((s) => (s.activeId ? (s.docs[s.activeId]?.view.page ?? 0) : 0));
  const pages = usePages(documentId);
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
  const onKeyDown = (e: KeyboardEvent): void => {
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
        goToPage(focused);
      },
      ' ': () => {
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
        aria-selected={i === current}
        tabIndex={i === focused ? 0 : -1}
        data-pane-focus={i === focused || undefined}
        data-thumb={i}
        className={i === current ? 'thumb thumb--current' : 'thumb'}
        style={{ top: layout.tops[i] }}
        onFocus={() => {
          setFocused(i);
        }}
      >
        <div className="thumb-image" style={{ width: THUMB_WIDTH, height: layout.imageHeights[i] }}>
          {documentId ? (
            <ThumbImage
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
    <div
      ref={list}
      className="thumb-list"
      role="listbox"
      aria-label={t('thumbnails.list')}
      tabIndex={-1}
      onFocus={() => {
        setInList(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setInList(false);
      }}
      onClick={(e) => {
        const item = (e.target as HTMLElement).closest<HTMLElement>('[data-thumb]');
        if (!item) return;
        const i = Number(item.dataset['thumb']);
        setFocused(i);
        goToPage(i);
      }}
      onScroll={(e) => {
        setScrollTop(e.currentTarget.scrollTop);
      }}
      onKeyDown={onKeyDown}
    >
      <div className="thumb-content" style={{ height: layout.tops[pages.length] }}>
        {items}
      </div>
    </div>
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
