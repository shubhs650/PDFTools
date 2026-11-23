import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { laidToDisplayed } from '../../../model/compare/align/manual';
import { clampBox, normBox, type AreaBox } from '../../../model/compare/area';
import type { PageFrameInfo } from '../../view/DocumentView';
import type { SideId } from '../model';
import { DRAW_HINT, setArea, stopDrawing, updatePick, useAreaPick } from './areaPick';

/** A page's displayed size from its laid-out frame (a quarter turn swaps the sides). */
const displayedSize = (f: PageFrameInfo): { width: number; height: number } =>
  f.rotation & 1 ? { width: f.height, height: f.width } : { width: f.width, height: f.height };

/**
 * Drawing an area's rectangle in Document A's or Document B's window (O1):
 * while that side is being drawn, the page takes the pointer and a drag draws
 * the rectangle; Escape stops. The rectangle is kept in the page's displayed
 * space, so a page with /Rotate is drawn as it shows.
 */
export function AreaDrawLayer({
  id,
  side,
  docId,
  pageIndex,
  frame,
}: {
  id: string;
  side: SideId;
  docId: string;
  pageIndex: number;
  frame: PageFrameInfo;
}) {
  const { t } = useTranslation();
  const drawing = useAreaPick(id).drawing === side;
  const root = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<AreaBox | null>(null);
  const { scale, rotation, width, height } = frame;

  useEffect(() => {
    const el = root.current;
    if (!el || !drawing) return;
    let start: [number, number] | null = null;
    const at = (e: PointerEvent): [number, number] => {
      const r = el.getBoundingClientRect();
      return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
    };
    const down = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      start = at(e);
      setDrag([start[0], start[1], start[0], start[1]]);
    };
    const move = (e: PointerEvent): void => {
      if (!start) return;
      const p = at(e);
      setDrag([start[0], start[1], p[0], p[1]]);
    };
    const up = (e: PointerEvent): void => {
      if (!start) return;
      const p = at(e);
      const from = laidToDisplayed(rotation, width, height, { x: start[0], y: start[1] });
      const to = laidToDisplayed(rotation, width, height, { x: p[0], y: p[1] });
      start = null;
      setDrag(null);
      const size = displayedSize({ width, height, rotation, scale });
      const box = clampBox(normBox([from.x, from.y, to.x, to.y]), size.width, size.height);
      if (!box) return;
      updatePick(id, (v) => setArea(v, side, { docId, page: pageIndex, box }));
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      start = null;
      setDrag(null);
      updatePick(id, stopDrawing);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
    };
  }, [drawing, id, side, docId, pageIndex, scale, rotation, width, height]);

  if (!drawing) return null;
  return (
    <div
      ref={root}
      className="align-pick-layer area-draw-layer"
      data-testid={`area-draw-${side}`}
      title={t(DRAW_HINT[side])}
    >
      {drag ? (
        <div
          className="area-drag"
          style={{
            left: Math.min(drag[0], drag[2]) * scale,
            top: Math.min(drag[1], drag[3]) * scale,
            width: Math.abs(drag[2] - drag[0]) * scale,
            height: Math.abs(drag[3] - drag[1]) * scale,
          }}
        />
      ) : null}
    </div>
  );
}

/** An area's rectangle on its page as displayed (O1): view-only, never a comment. */
export function AreaMark({ box, scale, side }: { box: AreaBox; scale: number; side: SideId }) {
  return (
    <svg className="area-marks" aria-hidden="true" data-testid={`area-mark-${side}`}>
      <rect
        className="area-mark"
        x={box[0] * scale}
        y={box[1] * scale}
        width={(box[2] - box[0]) * scale}
        height={(box[3] - box[1]) * scale}
      />
    </svg>
  );
}

/**
 * An area comparison's overlay (O1): only the region compared — B's rectangle
 * and A's as placed — shows; the rest of the sheet is veiled, and the region
 * is outlined. Drawn by the view over the sheet, never in the pointer's way.
 */
export function AreaVeil({
  region,
  width,
  height,
  scale,
}: {
  /** The region (B's page, pt): a convex polygon, x, y pairs; empty when the rectangles miss. */
  region: readonly number[];
  width: number;
  height: number;
  scale: number;
}) {
  const pts: string[] = [];
  for (let i = 0; i + 1 < region.length; i += 2)
    pts.push(`${String((region[i] ?? 0) * scale)} ${String((region[i + 1] ?? 0) * scale)}`);
  const hole = pts.length >= 3 ? `M${pts.join(' L')} Z` : '';
  const page = `M0 0 H${String(width * scale)} V${String(height * scale)} H0 Z`;
  return (
    <svg className="area-marks area-veil-layer" aria-hidden="true" data-testid="area-veil">
      <path className="area-veil" d={`${page} ${hole}`} fillRule="evenodd" />
      {hole ? <path className="area-region" d={hole} data-testid="area-region" /> : null}
    </svg>
  );
}
