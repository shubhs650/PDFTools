// A selected measurement's caption, draggable (M14-03, Q40): a handle over the
// caption drawn in the markup's own appearance. A drag (or the arrow keys,
// Shift for 10 pt) stores the caption's offset in its `measure` field as one
// undo step; the worker draws the caption there. Put the caption back is in
// the Properties pane. No PDF work here (rule 1): the box is estimated.
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { securityOf, useDocuments } from '../../app/store/documentStore';
import { useApp } from '../../app/store/appStore';
import { leaderOf } from '../../model/dimension';
import { captionBoundsEP, dragOffset, metaOf } from '../../model/measureMarkup';
import { measurePoints } from '../../model/measurement';
import type { Pt } from '../../model/scale';
import { allows } from '../../model/permissions';
import { isFixed } from '../annotate/properties/model';
import { useSelectedAnnotations } from '../annotate/selection';
import { setMeasureMeta } from './measurements';
import { useEditPreview } from './pointEdit';

const STEP = 1;
const BIG_STEP = 10;

export function CaptionHandle({
  documentId,
  pageIndex,
  scale,
}: {
  documentId: string;
  pageIndex: number;
  scale: number;
}) {
  const { t } = useTranslation();
  const active = useDocuments((s) => s.activeId === documentId);
  const canEdit = useDocuments((s) => {
    const meta = s.docs[documentId]?.meta;
    return meta ? allows(securityOf(meta), 'annotate') : false;
  });
  const tool = useApp((s) => s.tool);
  const sel = useSelectedAnnotations(active ? documentId : null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const [moved, setMoved] = useState<Pt | null>(null);
  // A point being dragged (M14-04): the preview has its own caption.
  const dragging = useEditPreview(active ? documentId : null) !== null;
  const a = sel.length === 1 ? sel[0] : undefined;
  const meta = a ? metaOf(a) : null;
  if (
    !a ||
    !meta ||
    dragging ||
    a.pageIndex !== pageIndex ||
    !canEdit ||
    isFixed(a) ||
    tool !== 'select'
  )
    return null;
  const pts = measurePoints(a);
  const leader = leaderOf(a);
  const box = captionBoundsEP(meta, pts, leader, a.contents ?? '');
  if (!box) return null;
  const move = (d: Pt) => {
    if (d.x === 0 && d.y === 0) return;
    setMeasureMeta(documentId, a.id, { capOffset: dragOffset(meta, pts, leader, d) });
  };
  const end = (e: PointerEvent<HTMLButtonElement>, keep: boolean) => {
    const d = drag.current;
    if (d?.id !== e.pointerId) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const delta = {
      x: (e.nativeEvent.offsetX - d.x) / scale,
      y: (e.nativeEvent.offsetY - d.y) / scale,
    };
    setMoved(null);
    if (keep) move(delta);
  };
  const style = {
    left: box[0] * scale,
    top: box[1] * scale,
    width: (box[2] - box[0]) * scale,
    height: (box[3] - box[1]) * scale,
  };
  return (
    <div className="caption-handle-layer" data-no-interaction>
      {moved ? (
        <div
          className="caption-handle-ghost"
          aria-hidden="true"
          style={{ ...style, transform: `translate(${String(moved.x)}px, ${String(moved.y)}px)` }}
        />
      ) : null}
      <button
        type="button"
        className="caption-handle ui-focusable"
        data-testid="caption-handle"
        aria-label={t('measure.captionDrag.handle')}
        title={t('measure.captionDrag.handle')}
        style={style}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { id: e.pointerId, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
          setMoved({ x: 0, y: 0 });
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d?.id !== e.pointerId) return;
          e.stopPropagation();
          setMoved({ x: e.nativeEvent.offsetX - d.x, y: e.nativeEvent.offsetY - d.y });
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          end(e, true);
        }}
        onPointerCancel={(e) => {
          end(e, false);
        }}
        onKeyDown={(e: KeyboardEvent) => {
          const n = e.shiftKey ? BIG_STEP : STEP;
          const d: Record<string, Pt> = {
            ArrowLeft: { x: -n, y: 0 },
            ArrowRight: { x: n, y: 0 },
            ArrowUp: { x: 0, y: -n },
            ArrowDown: { x: 0, y: n },
          };
          const step = d[e.key];
          if (!step) return;
          e.preventDefault();
          e.stopPropagation();
          move(step);
        }}
      />
    </div>
  );
}
