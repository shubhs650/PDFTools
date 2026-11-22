import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type WheelEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../../i18n';
import { IDENTITY } from '../../../model/compare/material';
import { presetOf, type Rgb } from '../../../model/compare/overlay';
import { fitZoom, stepZoom } from '../../../model/compare/overlayView';
import { renderEngine } from '../../view/host';
import { pairingSession } from '../pairingFlow';
import { FloatingBar } from './FloatingBar';
import { OverlayPainter, type PainterStats, type TileContent } from './painter';
import {
  drawnStyle,
  overlayView,
  placeOf,
  setZoom,
  updateView,
  useOverlayView,
  type Sheet,
} from './overlayState';

/** Blink flips sides this often while X (or the Blink button) is held. */
const BLINK_MS = 450;

const COLOUR_NAME: Record<string, MessageKey> = {
  '255,0,0': msg('compare.overlay.colourName_red'),
  '0,255,0': msg('compare.overlay.colourName_green'),
  '0,0,255': msg('compare.overlay.colourName_blue'),
  '255,0,255': msg('compare.overlay.colourName_magenta'),
};
const colourName = (c: Rgb): MessageKey =>
  COLOUR_NAME[c.join(',')] ?? msg('compare.overlay.colourName_custom');

interface Size {
  width: number;
  height: number;
}
const frames = new Map<string, Promise<Size>>();

/** A page's displayed size (points), from the Render worker, cached per edit count. */
function useFrame(p: Sheet['a'], version: number): Size | null {
  const [size, setSize] = useState<Size | null>(null);
  const key = p ? `${p.docId}\n${String(p.page)}\n${String(version)}` : null;
  useEffect(() => {
    if (!p || key === null) return;
    let live = true;
    let job = frames.get(key);
    if (!job) {
      job = renderEngine().rpc.call('overlayFrame', { docId: p.docId, pageIndex: p.page }).promise;
      frames.set(key, job);
      job.catch(() => frames.delete(key));
    }
    job.then(
      (s) => {
        if (live) setSize(s);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
    // The key holds the page and its version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return size;
}

/**
 * The overlay window (M12-11, D-59): one sheet, both revisions tinted and
 * multiplied at the current zoom by the Render worker, tile by tile, with the
 * floating bar over it. Scroll or drag to pan, Ctrl+wheel or Ctrl+= / Ctrl+-
 * to zoom, Ctrl+0 to fit; hold X to blink between old and new.
 */
export function OverlayWindow({ id, sheet, index }: { id: string; sheet: Sheet; index: number }) {
  const { t } = useTranslation();
  const view = useOverlayView(id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const painter = useRef<OverlayPainter | null>(null);
  const anchor = useRef<{ fx: number; fy: number; vx: number; vy: number } | null>(null);
  const [stats, setStats] = useState<PainterStats | null>(null);
  const [viewSize, setViewSize] = useState<Size>({ width: 0, height: 0 });
  const versionA = useDocuments((s) => (sheet.a ? (s.docs[sheet.a.docId]?.edits ?? 0) : 0));
  const versionB = useDocuments((s) => (sheet.b ? (s.docs[sheet.b.docId]?.edits ?? 0) : 0));
  const nameA = useDocuments((s) => (sheet.a ? (s.docs[sheet.a.docId]?.meta.name ?? '') : ''));
  const nameB = useDocuments((s) => (sheet.b ? (s.docs[sheet.b.docId]?.meta.name ?? '') : ''));
  // The sheet is drawn in Document B's frame; a sheet removed from B in A's own.
  const frame = useFrame(sheet.b ?? sheet.a, sheet.b ? versionB : versionA);

  // The worker works on the sheet in view first (D-66).
  useEffect(() => {
    pairingSession(id)?.focus(sheet.pair);
  }, [id, sheet.pair]);

  useEffect(() => {
    const el = scrollRef.current;
    const sh = sheetRef.current;
    if (!el || !sh) return;
    const p = new OverlayPainter(
      el,
      sh,
      (req) => renderEngine().rpc.call('overlayTile', req),
      setStats,
    );
    painter.current = p;
    const ro = new ResizeObserver(() => {
      setViewSize({ width: el.clientWidth, height: el.clientHeight });
      p.viewChanged();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      p.dispose();
      painter.current = null;
    };
  }, []);

  const content: TileContent | null = useMemo(() => {
    if (!frame) return null;
    return {
      a: sheet.a
        ? {
            docId: sheet.a.docId,
            pageIndex: sheet.a.page,
            place: sheet.b ? placeOf(view, sheet) : IDENTITY,
            version: versionA,
          }
        : null,
      b: sheet.b
        ? { docId: sheet.b.docId, pageIndex: sheet.b.page, place: IDENTITY, version: versionB }
        : null,
      style: drawnStyle(view),
      thicken: view.thicken,
      comments: view.comments,
    };
  }, [frame, sheet, view, versionA, versionB]);
  const contentKey = content && frame ? JSON.stringify([frame, content]) : null;

  // The zoom: fitted to the window, or as set.
  const zoom =
    view.fit && frame && viewSize.width > 0
      ? fitZoom(view.fit, frame.width, frame.height, viewSize.width, viewSize.height)
      : view.zoom;

  useEffect(() => {
    if (content && frame) painter.current?.setContent(frame, content);
    // contentKey stands for frame and content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey]);

  useEffect(() => {
    const p = painter.current;
    const el = scrollRef.current;
    const sh = sheetRef.current;
    if (!p || !el || !sh) return;
    p.setZoom(zoom);
    // Keep the point under the pointer (or the centre) where it was.
    const a = anchor.current;
    anchor.current = null;
    if (a) {
      const css = p.cssSize();
      el.scrollLeft = sh.offsetLeft + a.fx * css.width - a.vx;
      el.scrollTop = sh.offsetTop + a.fy * css.height - a.vy;
    }
    p.viewChanged();
  }, [zoom]);

  // Another sheet starts at the top left.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollLeft = 0;
      el.scrollTop = 0;
    }
  }, [index]);

  /** Zooms keeping the sheet point under (clientX, clientY) in place; the centre by default. */
  const zoomTo = (z: number, at?: { clientX: number; clientY: number }): void => {
    const el = scrollRef.current;
    const sh = sheetRef.current;
    if (!el || !sh) return;
    const v = el.getBoundingClientRect();
    const s = sh.getBoundingClientRect();
    const cx = at?.clientX ?? v.left + v.width / 2;
    const cy = at?.clientY ?? v.top + v.height / 2;
    anchor.current = {
      fx: s.width > 0 ? (cx - s.left) / s.width : 0.5,
      fy: s.height > 0 ? (cy - s.top) / s.height : 0.5,
      vx: cx - v.left,
      vy: cy - v.top,
    };
    updateView(id, (cur) => setZoom(cur, z));
  };

  // Blink: while held, show old and new alone in turn.
  const blinkTimer = useRef<number | null>(null);
  const startBlink = (): void => {
    if (blinkTimer.current !== null) return;
    updateView(id, (v) => ({ ...v, blink: 'a' }));
    blinkTimer.current = window.setInterval(() => {
      updateView(id, (v) => ({ ...v, blink: v.blink === 'a' ? 'b' : 'a' }));
    }, BLINK_MS);
  };
  const stopBlink = (): void => {
    if (blinkTimer.current !== null) window.clearInterval(blinkTimer.current);
    blinkTimer.current = null;
    updateView(id, (v) => (v.blink === null ? v : { ...v, blink: null }));
  };
  useEffect(() => stopBlink, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl && !e.altKey && (e.key === 'x' || e.key === 'X')) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) startBlink();
      return;
    }
    if (!ctrl) return;
    if (e.key === '=' || e.key === '+') zoomTo(stepZoom(zoom, 1));
    else if (e.key === '-') zoomTo(stepZoom(zoom, -1));
    else if (e.key === '0') updateView(id, (v) => ({ ...v, fit: 'page' }));
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const onKeyUp = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'x' || e.key === 'X') stopBlink();
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>): void => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoomTo(overlayView(id).zoom * Math.exp(-e.deltaY / 400), e);
  };
  // Ctrl+wheel must not zoom the page: React's wheel listener is passive.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const stop = (e: globalThis.WheelEvent): void => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    el.addEventListener('wheel', stop, { passive: false });
    return () => {
      el.removeEventListener('wheel', stop);
    };
  }, []);

  // Drag to pan (left or middle button).
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  const label = t('compare.overlay.window', {
    sheet: format.number(index + 1),
    a: nameA || t('compare.side.a'),
    b: nameB || t('compare.side.b'),
    colA: t(colourName(view.style.colA)),
    colB: t(colourName(view.style.colB)),
  });
  const preset = presetOf(view.style.colA, view.style.colB);
  // Drawn: every visible tile of exactly this state is on screen (tests and the spinner).
  const done = !!stats?.complete && stats.zoom === zoom && stats.contentKey === contentKey;

  return (
    <div className="overlay-window" data-testid="overlay-window">
      {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- a scrollable region takes focus for keyboard scrolling, zoom and Blink (X) */}
      <div
        ref={scrollRef}
        className="overlay-scroll"
        role="region"
        aria-label={label}
        tabIndex={0}
        data-testid="overlay-view"
        data-zoom={zoom}
        data-complete={done ? 'true' : 'false'}
        data-tiles={stats?.drawn ?? 0}
        data-preset={preset ?? 'custom'}
        data-blink={view.blink ?? ''}
        onScroll={() => painter.current?.viewChanged()}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={stopBlink}
        onWheel={onWheel}
        onPointerDown={(e) => {
          if (e.button !== 0 && e.button !== 1) return;
          const el = scrollRef.current;
          if (!el) return;
          drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
          el.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          const el = scrollRef.current;
          if (!d || !el) return;
          el.scrollLeft = d.left - (e.clientX - d.x);
          el.scrollTop = d.top - (e.clientY - d.y);
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div className="overlay-canvas">
          <div
            ref={sheetRef}
            className="overlay-sheet-paper"
            style={frame ? undefined : { width: 0, height: 0 }}
          />
        </div>
      </div>
      {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      {stats && !done ? (
        <span
          className="overlay-drawing ui-spinner"
          role="status"
          aria-label={t('compare.overlay.drawing')}
        />
      ) : null}
      <FloatingBar
        id={id}
        sheet={sheet}
        zoomText={format.zoom(zoom)}
        onZoom={(dir) => {
          zoomTo(stepZoom(zoom, dir));
        }}
        onBlink={(on) => {
          if (on) startBlink();
          else stopBlink();
        }}
      />
    </div>
  );
}
