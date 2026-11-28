// A selected measurement's points, editable (M14-04, D-78, Q24): a handle on
// each point and, on a Length, one on its dimension line. A drag moves it
// with the value live in the caption, snapping to the drawing, Shift locking
// to 0°, 45° or 90° (still snapping) and the Measure loupe following; the
// release is one undo step. From the keyboard (rule 12, Q36) each handle is a
// button: the arrow keys move it (Shift: 10 pt), Delete removes a point where
// the measurement keeps enough. New points come from a right-click on an edge
// (pointEdit.ts). No PDF work here (rule 1).
import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PdfAnnotationSubtype, type PdfAnnotationObject } from '@embedpdf/models';
import { useApp } from '../../app/store/appStore';
import { useDocuments } from '../../app/store/documentStore';
import { dimensionGeometry, leaderOf, offsetOf, leaderFor } from '../../model/dimension';
import {
  canRemovePoint,
  handlesOf,
  lockAnchor,
  movePoint,
  removePoint,
  stepPoint,
} from '../../model/measureEdit';
import { FILL_ALPHA, metaOf, type MeasureTool } from '../../model/measureMarkup';
import { measurePoints } from '../../model/measurement';
import type { Pt } from '../../model/scale';
import { useSelectedAnnotations } from '../annotate/selection';
import { pageSizeOf, pointOnPage } from '../view/pagePoint';
import {
  kindOf,
  measurementText,
  scaleForMeasurement,
  sheetText,
  withFileCurve,
} from './measurements';
import {
  commitEdit,
  pointEditStore,
  editPoint,
  editTarget,
  endEdit,
  setPreview,
  trackEditLoupe,
  useEditPreview,
  withHandles,
  withOffsetAt,
} from './pointEdit';
import { SelectedMeasure } from './SelectedMeasure';

const STEP = 1;
const BIG_STEP = 10;

const ARROWS: Record<string, Pt> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/** A drag in progress: which pointer, what it moves, the measurement as it was. */
interface Drag {
  pointer: number;
  /** A point's index, or 'line' for a Length's dimension line. */
  what: number | 'line';
  base: PdfAnnotationObject;
  tool: MeasureTool;
  handles: Pt[];
  /** Takes off the drag's Esc listener. */
  off: () => void;
}

/** The measurement with its value as it would read now (the caption follows the drag). */
function withLiveValue(docId: string, a: PdfAnnotationObject): PdfAnnotationObject {
  const kind = kindOf(docId, a);
  if (!kind) return a;
  const value = measurementText(kind, a, scaleForMeasurement(docId, a));
  return { ...a, contents: sheetText(metaOf(a)?.label, value) };
}

/** Where a Length's dimension line handle sits: its middle, or a quarter along when the caption is in line. */
function lineGrip(a: PdfAnnotationObject): Pt | null {
  const [s, e] = measurePoints(a);
  if (!s || !e) return null;
  const g = dimensionGeometry(s, e, leaderOf(a), true);
  const k = metaOf(a)?.cap === 'inline' ? 0.25 : 0.5;
  return { x: g.start.x + (g.end.x - g.start.x) * k, y: g.start.y + (g.end.y - g.start.y) * k };
}

/** The measurement being dragged, drawn from its points (the plugin's body is hidden meanwhile). */
function Ghost({ a, scale }: { a: PdfAnnotationObject; scale: number }) {
  const o = a as unknown as { strokeColor?: string; strokeWidth?: number; opacity?: number };
  const color = o.strokeColor ?? 'currentColor';
  const width = Math.max(1, (o.strokeWidth ?? 1) * scale);
  const pts = measurePoints(a);
  const xy = (p: Pt): string => `${String(p.x * scale)},${String(p.y * scale)}`;
  let shape: ReactNode = null;
  if (a.type === PdfAnnotationSubtype.STAMP) {
    // An Angle, Radius or Diameter: SelectedMeasure below draws it whole (M14-05).
  } else if (a.type === PdfAnnotationSubtype.LINE && pts[0] && pts[1]) {
    const g = dimensionGeometry(pts[0], pts[1], leaderOf(a), true);
    shape = (
      <>
        <line
          x1={g.start.x * scale}
          y1={g.start.y * scale}
          x2={g.end.x * scale}
          y2={g.end.y * scale}
          stroke={color}
          strokeWidth={width}
        />
        {leaderOf(a)
          ? g.leaders.map(([p, q], i) => (
              <line
                key={i}
                x1={p.x * scale}
                y1={p.y * scale}
                x2={q.x * scale}
                y2={q.y * scale}
                stroke={color}
                strokeWidth={width}
              />
            ))
          : null}
      </>
    );
  } else if (a.type === PdfAnnotationSubtype.POLYGON) {
    const fill = metaOf(a)?.fill;
    shape = (
      <polygon
        points={pts.map(xy).join(' ')}
        stroke={color}
        strokeWidth={width}
        fill={fill ?? 'none'}
        fillOpacity={fill ? FILL_ALPHA : undefined}
      />
    );
  } else {
    shape = (
      <polyline points={pts.map(xy).join(' ')} stroke={color} strokeWidth={width} fill="none" />
    );
  }
  const r = a.rect;
  return (
    <>
      {shape ? (
        <svg className="measure-edit-ghost" aria-hidden="true" opacity={o.opacity ?? 1}>
          {shape}
        </svg>
      ) : null}
      <div
        className="measure-edit-caption"
        aria-hidden="true"
        data-testid="measure-edit-value"
        style={{
          left: r.origin.x * scale,
          top: r.origin.y * scale,
          width: r.size.width * scale,
          height: r.size.height * scale,
        }}
      >
        {/* The caption with the value as it reads now; no fill (drawn above). */}
        <SelectedMeasure
          annotation={
            { ...a, measure: { ...metaOf(a), fill: undefined } } as unknown as PdfAnnotationObject
          }
          scale={scale}
        />
      </div>
    </>
  );
}

export function MeasureEditor({
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
  const tool = useApp((s) => s.tool);
  const sel = useSelectedAnnotations(active ? documentId : null);
  const preview = useEditPreview(active ? documentId : null);
  const drag = useRef<Drag | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  // A curve read from a file: its points from its Triya data (M14-05).
  const a = sel.length === 1 && sel[0] ? withFileCurve(documentId, sel[0]) : undefined;
  const target = a?.pageIndex === pageIndex && tool === 'select' ? editTarget(documentId, a) : null;
  if (!a || !target) return null;
  const shown = preview?.id === a.id ? preview.object : a;
  const handles = handlesOf(target.tool, measurePoints(shown));
  const grip = target.tool === 'length' ? lineGrip(shown) : null;
  const pageSize = pageSizeOf(documentId, pageIndex) ?? { width: 612, height: 792 };

  const moveTo = (d: Drag, e: PointerEvent<HTMLElement>): void => {
    const raw = pointOnPage(documentId, pageIndex, e.clientX, e.clientY);
    if (!raw) return;
    trackEditLoupe(documentId, pageIndex, raw, { x: e.clientX, y: e.clientY });
    let next: PdfAnnotationObject;
    if (d.what === 'line') {
      next = withOffsetAt(d.base, editPoint(documentId, pageIndex, raw, e, null));
    } else {
      const anchor = lockAnchor(d.tool, d.handles, d.what);
      const p = editPoint(documentId, pageIndex, raw, e, anchor);
      next = withHandles(d.base, d.tool, movePoint(d.handles, d.what, p));
    }
    setPreview({ docId: documentId, id: d.base.id, object: withLiveValue(documentId, next) });
  };

  const finish = (e: PointerEvent<HTMLElement>, keep: boolean): void => {
    const d = drag.current;
    if (d?.pointer !== e.pointerId) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    d.off();
    const now = pointEditStore.getState().preview;
    const p = now?.id === d.base.id ? now.object : null;
    endEdit();
    if (keep && p) commitEdit(documentId, d.base, p);
  };

  /** The handle a pointer event is on: a point's index, or 'line' (data-what). */
  const whatOf = (e: PointerEvent<HTMLElement>): number | 'line' => {
    const w = e.currentTarget.dataset['what'];
    return w === 'line' ? 'line' : Number(w);
  };

  const onDown = (e: PointerEvent<HTMLElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    // Esc drops the drag: the measurement stays as it was.
    const onKey = (k: globalThis.KeyboardEvent): void => {
      if (k.key !== 'Escape') return;
      k.preventDefault();
      k.stopPropagation();
      drag.current?.off();
      drag.current = null;
      endEdit();
    };
    window.addEventListener('keydown', onKey, true);
    drag.current = {
      pointer: e.pointerId,
      what: whatOf(e),
      base: a,
      tool: target.tool,
      handles: handlesOf(target.tool, measurePoints(a)),
      off: () => {
        window.removeEventListener('keydown', onKey, true);
      },
    };
  };
  const onMove = (e: PointerEvent<HTMLElement>): void => {
    const d = drag.current;
    if (d?.pointer !== e.pointerId) return;
    e.stopPropagation();
    moveTo(d, e);
  };
  const onUp = (e: PointerEvent<HTMLElement>): void => {
    e.stopPropagation();
    finish(e, true);
  };
  const onCancel = (e: PointerEvent<HTMLElement>): void => {
    finish(e, false);
  };
  const onLost = (e: PointerEvent<HTMLElement>): void => {
    finish(e, true);
  };

  /** Focus a point's handle once the measurement is drawn again (after a removal). */
  const focusPoint = (i: number): void => {
    requestAnimationFrame(() => {
      layer.current
        ?.querySelector<HTMLElement>(`[data-measure-point="${String(i)}"]`)
        ?.focus({ preventScroll: true });
    });
  };

  const onPointKey = (i: number) => (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      const next = removePoint(target.tool, handles, i);
      if (!next) return;
      commitEdit(documentId, a, withHandles(a, target.tool, next));
      focusPoint(Math.min(i, next.length - 1));
      return;
    }
    const dir = ARROWS[e.key];
    if (!dir || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    const n = e.shiftKey ? BIG_STEP : STEP;
    const at = handles[i];
    if (!at) return;
    const p = stepPoint(at, dir.x * n, dir.y * n, pageSize);
    commitEdit(documentId, a, withHandles(a, target.tool, movePoint(handles, i, p)));
  };

  const onLineKey = (e: KeyboardEvent<HTMLElement>) => {
    const dir = ARROWS[e.key];
    if (!dir || e.ctrlKey || e.metaKey || e.altKey || !grip) return;
    const [s, en] = measurePoints(a);
    if (!s || !en) return;
    e.preventDefault();
    e.stopPropagation();
    const n = e.shiftKey ? BIG_STEP : STEP;
    // The dimension line moves across the measured line, the way the arrow points.
    const now = leaderOf(a)?.ll ?? 0;
    const across = offsetOf(s, en, { x: s.x + dir.x, y: s.y + dir.y }, true);
    if (Math.abs(across) < 0.3) return;
    const ll = now + Math.sign(across) * n;
    commitEdit(documentId, a, { ...a, leader: leaderFor(ll) } as unknown as PdfAnnotationObject);
  };

  const removable = canRemovePoint(target.tool, handles.length);
  return (
    // The page's pointer handlers (marquee, tools) leave presses on handles alone.
    <div className="measure-edit-layer" ref={layer} data-testid="measure-edit" data-no-interaction>
      {preview?.id === a.id ? <Ghost a={preview.object} scale={scale} /> : null}
      {grip ? (
        <button
          type="button"
          className="measure-line-grip ui-focusable"
          data-testid="measure-line-grip"
          aria-label={t('measure.edit.line')}
          title={t('measure.edit.line')}
          style={{ left: grip.x * scale, top: grip.y * scale }}
          onKeyDown={onLineKey}
          data-what="line"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onCancel}
          onLostPointerCapture={onLost}
        />
      ) : null}
      {handles.map((p, i) => (
        <button
          key={i}
          type="button"
          className="measure-point ui-focusable"
          data-testid="measure-point"
          data-measure-point={i}
          aria-label={
            removable
              ? t('measure.edit.pointRemovable', { n: i + 1, count: handles.length })
              : t('measure.edit.point', { n: i + 1, count: handles.length })
          }
          style={{ left: p.x * scale, top: p.y * scale }}
          onKeyDown={onPointKey(i)}
          data-what={i}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onCancel}
          onLostPointerCapture={onLost}
        />
      ))}
    </div>
  );
}
