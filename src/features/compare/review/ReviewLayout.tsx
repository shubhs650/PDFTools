import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import { documentStore, useDocuments } from '../../../app/store/documentStore';
import { format } from '../../../i18n';
import { toReference, type WindowRole } from '../../../model/compare/link';
import { DocumentView, type PageFrameInfo } from '../../view/DocumentView';
import { AlignPickLayer } from '../align/AlignPickLayer';
import { tileCache } from '../../view/host';
import { setViewFocus, setVisibleWindows } from '../../view/tileScheduler';
import type { Comparison } from '../model';
import { OverlayWindow } from '../overlay/OverlayWindow';
import {
  placeOf,
  setSplits,
  updateView,
  useOverlayView,
  type Sheet,
} from '../overlay/overlayState';
import { Splitter } from './Splitter';
import { useWindowPlace } from './windowPlace';
import { WindowLink, centreOnBox, fitWindow, showPage, type LinkedWindow } from './windowLink';
import { focusers, pendingFocus, type Box } from './overlayFocus';

const SPLIT_TEST_ID = { x: 'review-split-x', y: 'review-split-y' } as const;

/** The links of the comparisons on screen. */
const links = new Map<string, WindowLink>();

/**
 * The windows of an overlay result (M12-12, D-62, Q14): **Overlay only**, or
 * **Review** with the overlay large on the left, Document A top right and
 * Document B bottom right, with draggable splitters; one sheet at a time. All
 * three are live document windows (S27 route 1): every comment tool, the
 * Properties pane and every context menu act on the window in use, which is
 * the document commands act on. With the lock on (the default) the windows
 * show the same spot of the drawing through the sheet's alignment, at
 * matching zoom; a crosshair marks the pointer's spot in the other windows.
 */
export function ReviewLayout({
  comparison: c,
  sheet,
  index,
  notesId,
}: {
  comparison: Comparison;
  sheet: Sheet;
  index: number;
  notesId: string;
}) {
  const { t } = useTranslation();
  const view = useOverlayView(c.id);
  const review = view.layout === 'review';
  const link = useMemo(() => {
    const l = links.get(c.id) ?? new WindowLink();
    links.set(c.id, l);
    return l;
  }, [c.id]);
  useEffect(
    () => () => {
      link.detach();
      links.delete(c.id);
    },
    [c.id, link],
  );

  const body = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const hosts: Record<WindowRole, RefObject<HTMLDivElement | null>> = {
    overlay: useRef<HTMLDivElement>(null),
    a: useRef<HTMLDivElement>(null),
    b: useRef<HTMLDivElement>(null),
  };
  const place = placeOf(view, sheet);
  const paired = !!sheet.a && !!sheet.b;

  // A and B mount one after the other, after the overlay, each as a transition:
  // three document windows in one commit would be a main-thread task over 100 ms (rule 1).
  const [sides, setSides] = useState(0);
  useEffect(() => {
    if (!review || sides >= 2) return;
    const timer = setTimeout(() => {
      startTransition(() => {
        setSides((n) => n + 1);
      });
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [review, sides]);

  // The windows on screen: their documents, pages and maps into the overlay's frame. A new
  // placement (an alignment found, or set by hand: M12-13) moves the others; it does not refit.
  const sheetKey = JSON.stringify([review, notesId, index, sheet.a, sheet.b]);
  const windowsKey = JSON.stringify([sheetKey, place, sides]);
  /** The sheet the overlay was last fitted to (a side window mounting later does not refit it). */
  const fitted = useRef<string | null>(null);
  const windows = (): LinkedWindow[] => {
    const out: LinkedWindow[] = [];
    const add = (role: WindowRole, docId: string, page: number): void => {
      const host = hosts[role].current;
      if (host) out.push({ role, docId, page, toRef: toReference(role, place, paired), host });
    };
    add('overlay', notesId, index);
    if (review) {
      if (sheet.a) add('a', sheet.a.docId, sheet.a.page);
      if (sheet.b) add('b', sheet.b.docId, sheet.b.page);
    }
    return out;
  };

  // A new sheet, layout or alignment: each window shows its page, the overlay is
  // fitted, and the others follow it (or fit themselves without the lock). A side
  // window that mounts later only shows its page and follows.
  useEffect(() => {
    const list = windows();
    link.setWindows(list);
    const run = { stopped: false };
    const stopped = (): boolean => run.stopped;
    const refit = fitted.current !== sheetKey;
    void (async () => {
      const shown = await Promise.all(list.map((w) => showPage(w)));
      if (stopped() || shown.some((ok) => !ok)) return;
      const overlay = list.find((w) => w.role === 'overlay');
      if (!overlay) return;
      if (refit) {
        if (!(await fitWindow(overlay, 'page')) || stopped()) return;
        fitted.current = sheetKey;
        link.lead('overlay');
      }
      if (view.lock) link.drive(link.leaderRole ?? 'overlay');
      else for (const w of list) if (w.role !== 'overlay') void fitWindow(w, 'page');
      // A difference picked on another sheet is shown once its sheet is (M12-14).
      const box = pendingFocus.get(c.id);
      if (box) {
        pendingFocus.delete(c.id);
        focusers.get(c.id)?.(box);
      }
    })();
    return () => {
      run.stopped = true;
    };
    // windowsKey stands for the windows; the lock's later changes do not refit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowsKey, link]);

  // The differences list brings a box of the overlay into view (M12-14).
  useEffect(() => {
    const focus = (box: Box): void => {
      const w = link.window('overlay');
      if (!w) return;
      void centreOnBox(w, box).then((ok) => {
        if (!ok) return;
        link.lead('overlay');
        if (link.enabled) link.drive('overlay');
      });
    };
    focusers.set(c.id, focus);
    return () => {
      if (focusers.get(c.id) === focus) focusers.delete(c.id);
    };
  }, [c.id, link]);

  // Turning the lock on brings the others to the window last used.
  useEffect(() => {
    link.setEnabled(view.lock);
    if (view.lock) link.drive(link.leaderRole ?? 'overlay');
  }, [view.lock, link]);

  // The windows on screen render first, the focused one before the others (S27 change 5).
  useEffect(() => {
    const shown = new Map<string, number>([[notesId, index]]);
    if (review && sheet.a) shown.set(sheet.a.docId, sheet.a.page);
    if (review && sheet.b) shown.set(sheet.b.docId, sheet.b.page);
    setVisibleWindows(shown);
    tileCache.setVisible([...shown.keys()]);
    return () => {
      setVisibleWindows(new Map());
      tileCache.setVisible([]);
    };
  }, [notesId, index, review, sheet.a, sheet.b]);

  // The overlay window is the one in use when the result opens.
  useEffect(() => {
    const s = documentStore.getState();
    const mine = [notesId, sheet.a?.docId, sheet.b?.docId];
    if (s.activeTab === c.id && !mine.includes(s.activeId ?? undefined)) s.focusDocument(notesId);
  }, [c.id, notesId, sheet.a?.docId, sheet.b?.docId]);

  /** The window the user works in: commands act on its document; it leads the others. */
  const enter = (role: WindowRole, docId: string, page: number): void => {
    if (documentStore.getState().activeId !== docId) documentStore.getState().focusDocument(docId);
    setViewFocus(docId, page);
    link.lead(role);
  };

  const windowProps = (role: WindowRole, docId: string, page: number) => ({
    ref: hosts[role],
    'data-role': role,
    onPointerDownCapture: () => {
      enter(role, docId, page);
    },
    onWheelCapture: () => {
      enter(role, docId, page);
    },
    onFocusCapture: () => {
      enter(role, docId, page);
    },
    onPointerMove: (e: { clientX: number; clientY: number }) => {
      link.pointer(role, e.clientX, e.clientY);
    },
    onPointerLeave: () => {
      link.hidePointer();
    },
  });

  const resized = (): void => {
    requestAnimationFrame(() => {
      if (view.lock) link.drive(link.leaderRole ?? 'overlay');
    });
  };

  const fit = (mode: 'page' | 'width'): void => {
    const overlay = windows().find((w) => w.role === 'overlay');
    if (!overlay) return;
    void fitWindow(overlay, mode).then((ok) => {
      if (ok && view.lock) {
        link.lead('overlay');
        link.drive('overlay');
      }
    });
  };

  const overlay = (
    <div
      className="review-window review-overlay"
      data-testid="review-window-overlay"
      {...windowProps('overlay', notesId, index)}
    >
      <OverlayWindow id={c.id} sheet={sheet} index={index} notesId={notesId} onFit={fit} />
      <Crosshair link={link} of="overlay" />
    </div>
  );

  // The overlay keeps its place in the tree in both layouts (it is never remounted).
  return (
    <div ref={body} className="review-layout" data-layout={view.layout}>
      <div
        className="review-pane"
        style={{ flexBasis: review ? `${String(view.splits.x * 100)}%` : '100%' }}
      >
        {overlay}
      </div>
      {review ? (
        <>
          <Splitter
            orientation="vertical"
            label={t('compare.review.splitX')}
            value={view.splits.x}
            container={body}
            testId={SPLIT_TEST_ID.x}
            onChange={(x) => {
              updateView(c.id, (v) => setSplits(v, { x }));
              resized();
            }}
          />
          <div ref={column} className="review-column">
            <div className="review-pane" style={{ flexBasis: `${String(view.splits.y * 100)}%` }}>
              {sides >= 1 ? (
                <SideWindow id={c.id} side="a" sheet={sheet} props={windowProps}>
                  <Crosshair link={link} of="a" />
                </SideWindow>
              ) : (
                <div className="review-window" />
              )}
            </div>
            <Splitter
              orientation="horizontal"
              label={t('compare.review.splitY')}
              value={view.splits.y}
              container={column}
              testId={SPLIT_TEST_ID.y}
              onChange={(y) => {
                updateView(c.id, (v) => setSplits(v, { y }));
                resized();
              }}
            />
            <div className="review-pane review-pane-rest">
              {sides >= 2 ? (
                <SideWindow id={c.id} side="b" sheet={sheet} props={windowProps}>
                  <Crosshair link={link} of="b" />
                </SideWindow>
              ) : (
                <div className="review-window" />
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

type WindowProps = (
  role: WindowRole,
  docId: string,
  page: number,
) => Record<string, unknown> & { ref: RefObject<HTMLDivElement | null> };

/** Document A or B as a live window on the sheet's page, or a note that the sheet has none. */
function SideWindow({
  id,
  side,
  sheet,
  props,
  children,
}: {
  id: string;
  side: 'a' | 'b';
  sheet: Sheet;
  props: WindowProps;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const p = sheet[side];
  const name = useDocuments((s) => (p ? (s.docs[p.docId]?.meta.name ?? '') : ''));
  useWindowPlace(p?.docId ?? null);
  const sideName = t(side === 'a' ? 'compare.side.a' : 'compare.side.b');
  if (!p)
    return (
      <div className="review-window review-empty" data-testid={`review-window-${side}`}>
        <p className="review-window-title">{sideName}</p>
        <p className="review-empty-text">
          {side === 'a' ? t('compare.review.noPage_a') : t('compare.review.noPage_b')}
        </p>
      </div>
    );
  const title = t('compare.review.windowTitle', {
    side: sideName,
    name,
    page: format.number(p.page + 1),
  });
  const { ref, ...rest } = props(side, p.docId, p.page);
  const pair = sheet.pair;
  // Picking alignment points and their marks (M12-13), on the sheet's page.
  const layer =
    pair === null
      ? undefined
      : (pageIndex: number, frame: PageFrameInfo) =>
          pageIndex === p.page ? (
            <AlignPickLayer
              id={id}
              side={side}
              pair={pair}
              docId={p.docId}
              pageIndex={pageIndex}
              frame={frame}
            />
          ) : null;
  return (
    <div
      ref={ref}
      className="review-window"
      data-testid={`review-window-${side}`}
      data-doc-id={p.docId}
      {...rest}
    >
      <p className="review-window-title" data-side={side}>
        {title}
      </p>
      <div className="review-window-view">
        <DocumentView
          key={p.docId}
          documentId={p.docId}
          sheet={{
            page: p.page,
            label: title,
            testId: `review-view-${side}`,
            ...(layer ? { layer } : {}),
          }}
        />
      </div>
      {children}
    </div>
  );
}

/** The linked pointer's mark in one window (placed by the link, never by React). */
function Crosshair({ link, of: role }: { link: WindowLink; of: WindowRole }) {
  return (
    <div
      className="review-crosshair"
      hidden
      aria-hidden="true"
      data-testid={`review-crosshair-${role}`}
      ref={(el) => {
        link.setCrosshair(role, el);
      }}
    />
  );
}
