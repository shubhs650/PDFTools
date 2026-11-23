import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Box } from '../../../model/compare/detect/textDiff';
import type { PageFrameInfo } from '../../view/DocumentView';
import { addZone, entryId, updateDiff, useDiffPart } from './diffState';

/** Smallest zone drawn by hand (pt): a click without a drag makes none. */
const MIN_ZONE = 4;

/**
 * The differences' thin outlines on the overlay (M12-14, D-61, Q17): drawn by
 * the view over the sheet as displayed, never comments, never in the pointer's
 * way; the entry in use stands out. The sheet's ignore zones are shown
 * hatched. Kinds and types switched off in the list are not outlined.
 */
export function DiffOutlines({ id, pair, scale }: { id: string; pair: number; scale: number }) {
  const result = useDiffPart(id, (v) => v.results[pair]);
  const outlines = useDiffPart(id, (v) => v.outlines);
  const kinds = useDiffPart(id, (v) => v.filter.kinds);
  const types = useDiffPart(id, (v) => v.filter.types);
  const selected = useDiffPart(id, (v) => v.selected);
  const zones = useDiffPart(id, (v) => v.zones);
  const mine = zones.filter((z) => z.pair === null || z.pair === pair);
  const entries = outlines && result ? result.entries : [];
  if (!entries.length && !mine.length) return null;
  const rect = (b: Box, pad: number) => ({
    x: b[0] * scale - pad,
    y: b[1] * scale - pad,
    width: Math.max(1, (b[2] - b[0]) * scale + 2 * pad),
    height: Math.max(1, (b[3] - b[1]) * scale + 2 * pad),
  });
  return (
    <svg className="diff-marks" aria-hidden="true" data-testid="diff-marks">
      <defs>
        <pattern id={`diff-zone-${id}`} width="8" height="8" patternUnits="userSpaceOnUse">
          <path d="M0 8 L8 0" className="diff-zone-hatch" />
        </pattern>
      </defs>
      {mine.map((z) => (
        <rect
          key={z.id}
          {...rect(z.box, 0)}
          className="diff-zone"
          fill={`url(#diff-zone-${id})`}
          data-zone={z.id}
        />
      ))}
      {entries.map((e) => {
        if (!kinds[e.kind] || !types[e.type]) return null;
        const sel = entryId(pair, e.key) === selected;
        return (
          <rect
            key={e.key}
            {...rect(e.box, sel ? 4 : 2)}
            className="diff-outline"
            data-kind={e.kind}
            data-selected={sel || undefined}
          />
        );
      })}
    </svg>
  );
}

/**
 * Drawing an ignore zone on the overlay (M12-14, D-61, Q22): while on, the
 * page takes the pointer and a drag draws the rectangle; Escape stops. The
 * overlay's page has no turn of its own (the notes page is laid out as the
 * sheet is displayed), so the laid-out space is the sheet's.
 */
export function ZoneDrawLayer({
  id,
  pair,
  frame,
}: {
  id: string;
  pair: number;
  frame: PageFrameInfo;
}) {
  const { t } = useTranslation();
  const drawing = useDiffPart(id, (v) => v.drawing);
  const root = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Box | null>(null);
  const { scale } = frame;

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
      const box: Box = [start[0], start[1], p[0], p[1]];
      start = null;
      setDrag(null);
      if (Math.abs(box[2] - box[0]) < MIN_ZONE || Math.abs(box[3] - box[1]) < MIN_ZONE) return;
      updateDiff(id, (v) => ({ ...addZone(v, pair, box), drawing: false }));
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      start = null;
      setDrag(null);
      updateDiff(id, (v) => ({ ...v, drawing: false }));
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
  }, [drawing, id, pair, scale]);

  if (!drawing) return null;
  return (
    <div
      ref={root}
      className="align-pick-layer diff-zone-layer"
      data-testid="diff-zone-layer"
      title={t('compare.diff.zoneDrawHint')}
    >
      {drag ? (
        <div
          className="diff-zone-drag"
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
