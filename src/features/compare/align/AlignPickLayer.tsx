import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../../app/store/documentStore';
import { format } from '../../../i18n';
import { displayedToLaid, laidToDisplayed, type Pt } from '../../../model/compare/align/manual';
import { IDENTITY } from '../../../model/compare/material';
import { clearSnapMarker, snapPointIn } from '../../measure/snapping';
import type { PageFrameInfo } from '../../view/DocumentView';
import { renderEngine } from '../../view/host';
import { updateView, useOverlayView } from '../overlay/overlayState';
import type { TileJob } from '../overlay/painter';
import { nextSide, pickPoint, setPicking } from './manualAlign';

/** The magnifier's side (CSS px) and how much larger it shows the drawing than the window. */
const MAG_SIZE = 128;
const MAG_FACTOR = 4;
/** Device pixels per point the magnifier never goes past (a zoomed-in window needs no more). */
const MAG_MAX_SCALE = 48;

/**
 * Picking alignment points in Document A's or Document B's window (M12-13,
 * D-60, Q8): while picking, the page takes the pointer (like the Attach File
 * layer); the pointer snaps to the drawing — line ends, crossings, middles,
 * the nearest line; Alt held: no snapping — with the snap marker and a
 * magnifier beside it; a click picks the spot. The points picked are marked
 * and numbered in both windows whether picking or not. Escape stops picking.
 * The wheel still scrolls and zooms the window.
 */
export function AlignPickLayer({
  id,
  side,
  pair,
  docId,
  pageIndex,
  frame,
}: {
  id: string;
  side: 'a' | 'b';
  pair: number;
  docId: string;
  pageIndex: number;
  frame: PageFrameInfo;
}) {
  const { t } = useTranslation();
  const view = useOverlayView(id);
  const manual = view.manual?.pair === pair ? view.manual : null;
  const picking = !!manual?.picking && nextSide(manual) !== null;
  const root = useRef<HTMLDivElement>(null);
  const [lens, setLens] = useState<{ client: Pt; at: Pt } | null>(null);
  const { width, height, rotation, scale } = frame;

  // Native listeners: they run before the page's own pointer handling further up.
  useEffect(() => {
    const el = root.current;
    if (!el || !picking) return;
    const laid = (e: MouseEvent): Pt => {
      const raw = { x: e.offsetX / scale, y: e.offsetY / scale };
      return snapPointIn(docId, pageIndex, raw, e, { force: true, zoom: scale });
    };
    // The press's own position (pointer events have fractions of a pixel, a click may not),
    // read before the window takes the focus: a new document in use clears the snap.
    let pressed: Pt | null = null;
    const early = (e: PointerEvent): void => {
      if (e.button === 0 && e.target === el) pressed = laid(e);
    };
    const down = (e: PointerEvent): void => {
      if (e.button !== 0 || e.target !== el) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const move = (e: PointerEvent): void => {
      if (e.target !== el) return;
      const p = laid(e);
      setLens({ client: { x: e.clientX, y: e.clientY }, at: p });
    };
    const leave = (): void => {
      setLens(null);
      clearSnapMarker();
    };
    const click = (e: MouseEvent): void => {
      if (e.button !== 0 || e.target !== el) return;
      e.stopPropagation();
      const p = laidToDisplayed(rotation, width, height, pressed ?? laid(e));
      pressed = null;
      updateView(id, (v) => pickPoint(v, side, p));
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      updateView(id, (v) => setPicking(v, false));
    };
    window.addEventListener('pointerdown', early, { capture: true });
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('click', click);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', early, { capture: true });
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('click', click);
      window.removeEventListener('keydown', key);
      setLens(null);
      clearSnapMarker();
    };
  }, [picking, id, side, docId, pageIndex, scale, rotation, width, height]);

  if (!manual) return null;
  return (
    <>
      {picking ? (
        <div
          ref={root}
          className="align-pick-layer"
          data-testid={`align-pick-${side}`}
          data-scale={scale}
          title={t(side === 'a' ? 'compare.manual.pickA' : 'compare.manual.pickB')}
        />
      ) : null}
      {manual.points.map((p, i) => {
        const at = p[side];
        if (!at) return null;
        const q = displayedToLaid(rotation, width, height, at);
        return (
          <span
            key={i}
            className="align-point"
            data-testid={`align-point-${side}-${String(i + 1)}`}
            data-x={at.x}
            data-y={at.y}
            aria-hidden="true"
            style={{ left: q.x * scale, top: q.y * scale }}
          >
            {/* The number stays upright on a turned page. */}
            <span
              className="align-point-label"
              style={{ transform: `rotate(${String(-90 * rotation)}deg)` }}
            >
              {format.number(i + 1)}
            </span>
          </span>
        );
      })}
      {picking && lens
        ? createPortal(
            <Magnifier
              id={id}
              side={side}
              docId={docId}
              pageIndex={pageIndex}
              client={lens.client}
              at={laidToDisplayed(rotation, width, height, lens.at)}
              windowScale={scale}
            />,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * The magnifier beside the pointer: the spot under it drawn larger by the
 * Render worker (one request at a time, the latest spot wins; no pixel work
 * here), in the side's overlay colour, with a cross at the spot picked.
 */
function Magnifier({
  id,
  side,
  docId,
  pageIndex,
  client,
  at,
  windowScale,
}: {
  id: string;
  side: 'a' | 'b';
  docId: string;
  pageIndex: number;
  client: Pt;
  at: Pt;
  windowScale: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useOverlayView(id);
  const version = useDocuments((s) => s.docs[docId]?.edits ?? 0);
  const job = useRef<TileJob | null>(null);
  const wanted = useRef<(() => void) | null>(null);
  const dpr = window.devicePixelRatio || 1;
  const px = Math.round(MAG_SIZE * dpr);
  const scale = Math.min(MAG_MAX_SCALE, windowScale * MAG_FACTOR) * dpr;
  const x = Math.round(at.x * scale - px / 2);
  const y = Math.round(at.y * scale - px / 2);
  const { style, thicken } = view;

  useEffect(() => {
    const go = (): void => {
      const s = { docId, pageIndex, place: IDENTITY, version };
      const j = renderEngine().rpc.call('overlayTile', {
        a: side === 'a' ? s : null,
        b: side === 'b' ? s : null,
        scale,
        x,
        y,
        width: px,
        height: px,
        style: { ...style, showA: true, showB: true, balance: 0, fade: 0 },
        thicken,
        comments: { a: false, b: false, hideChecks: false },
        cache: false,
      });
      job.current = j;
      j.promise
        .then(
          (r) => {
            const ctx = canvas.current?.getContext('bitmaprenderer');
            if (ctx) ctx.transferFromImageBitmap(r.bitmap);
            else r.bitmap.close();
          },
          () => undefined,
        )
        .finally(() => {
          if (job.current === j) job.current = null;
          const next = wanted.current;
          wanted.current = null;
          next?.();
        });
    };
    if (job.current) wanted.current = go;
    else go();
  }, [docId, pageIndex, side, version, scale, x, y, px, style, thicken]);

  useEffect(
    () => () => {
      wanted.current = null;
      job.current?.cancel();
    },
    [],
  );

  // Above and to the right of the pointer, kept inside the window.
  const gap = 24;
  const left = Math.min(window.innerWidth - MAG_SIZE - 4, client.x + gap);
  const top = client.y - gap - MAG_SIZE < 4 ? client.y + gap : client.y - gap - MAG_SIZE;
  return (
    <div
      className="align-magnifier"
      data-testid="align-magnifier"
      aria-hidden="true"
      style={{ left, top, width: MAG_SIZE, height: MAG_SIZE }}
    >
      <canvas ref={canvas} width={px} height={px} />
    </div>
  );
}
