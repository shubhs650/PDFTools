// Cutout (M14-06, D-73, plan M14 §6, Q8): select an Area or Volume, choose
// Cutout, click the outline of a hole inside it. The hole becomes a gap in the
// same markup (its `measure` field's holes; ADR-035 Amendment 1 decision 5:
// cut out of the appearance with an even-odd fill, kept in the Triya data),
// and the value is net. Each hole is one undo step; the tool stays on for the
// next hole until Esc or another tool, and the area is selected again after.
// A hole must lie inside the outline and clear of the other holes; otherwise
// nothing is cut and a note says why. Clicked like an Area (points kept
// outside the handler, so view changes keep them, gesture.ts), with snapping,
// Shift and the loupe. No PDF work here (rule 1).
import {
  PdfAnnotationBorderStyle,
  PdfAnnotationSubtype,
  expandRect,
  rectFromPoints,
  type PdfAnnotationObject,
} from '@embedpdf/models';
import type { HandlerFactory } from '@embedpdf/plugin-annotation';
import { createStore } from 'zustand';
import { appStore } from '../../app/store/appStore';
import { documentStore } from '../../app/store/documentStore';
import { msg, t, type MessageKey } from '../../i18n';
import type { Gesture } from '../../model/measureGesture';
import { isAreaTool, type MeasureMeta } from '../../model/measureMarkup';
import { holeProblem, type HoleProblem } from '../../model/measureQuantity';
import { measurePoints } from '../../model/measurement';
import type { Pt } from '../../model/scale';
import { annotationCapability } from '../annotate/selection';
import type { HandlerContext } from '../annotate/tools/drawTools';
import { showStatusToast } from '../snapshot/snapshot';
import {
  attachGesture,
  clickMeasure,
  drawingOn,
  finishMeasure,
  moveMeasure,
  registeringDoc,
  type Drawer,
} from './gesture';
import { metaFor, withFileMeta } from './measurements';
import { setLive } from './measureStore';
import { editTarget } from './pointEdit';

/** The plugin tool (and interaction mode) of Cutout. */
export const CUTOUT_TOOL = 'measureCutout';

/** The Area or Volume the holes go into, while Cutout is on. */
export interface CutoutTarget {
  docId: string;
  id: string;
  page: number;
}

export const cutoutStore = createStore<{ target: CutoutTarget | null }>()(() => ({
  target: null,
}));

/** The plugin's handle around a hole's first corner (CSS px): a click inside it closes the hole. */
const CLOSE_HANDLE_PX = 14;

/** The one selected Area or Volume this person may cut, or null. */
export function cutoutCandidate(docId: string): PdfAnnotationObject | null {
  const sel = annotationCapability()?.forDocument(docId).getSelectedAnnotations() ?? [];
  const one = sel.length === 1 ? sel[0]?.object : undefined;
  if (one?.type !== PdfAnnotationSubtype.POLYGON) return null;
  const a = withFileMeta(docId, one);
  const target = editTarget(docId, a);
  return target && isAreaTool(target.tool) ? a : null;
}

/** Why Cutout can't start now (null: it can). */
export function cutoutBlocked(docId: string | null): MessageKey | null {
  if (appStore.getState().tool === CUTOUT_TOOL) return null;
  return docId && cutoutCandidate(docId) ? null : msg('measure.cutout.noTarget');
}

/** Turns Cutout on for the selected Area or Volume; false when there is none. */
export function startCutout(docId: string): boolean {
  const a = cutoutCandidate(docId);
  if (!a) return false;
  cutoutStore.setState({ target: { docId, id: a.id, page: a.pageIndex } });
  appStore.getState().setTool(CUTOUT_TOOL);
  return true;
}

/** The target as it is now, with its meta; null when it went (removed, another document). */
function targetNow(): { t: CutoutTarget; a: PdfAnnotationObject; meta: MeasureMeta } | null {
  const target = cutoutStore.getState().target;
  if (!target) return null;
  const scope = annotationCapability()?.forDocument(target.docId);
  const a = scope?.getAnnotationById(target.id)?.object;
  const meta = a ? metaFor(target.docId, a, scope) : null;
  return a && meta && isAreaTool(meta.tool) ? { t: target, a, meta } : null;
}

const PROBLEM: Record<HoleProblem, MessageKey> = {
  tooSmall: msg('measure.cutout.tooSmall'),
  outside: msg('measure.cutout.outside'),
  overlap: msg('measure.cutout.overlap'),
};

/** The target went while Cutout was on: the tool stops, and says so. */
function stopGone(docId: string): void {
  showStatusToast(docId, t('measure.cutout.gone'), false);
  cutoutStore.setState({ target: null });
  appStore.getState().setTool('select');
}

/** A hole clicked round: cut into the target (one undo step), or a note why not. */
export function addHole(pts: readonly Pt[]): boolean {
  const now = targetNow();
  const docId = cutoutStore.getState().target?.docId ?? documentStore.getState().activeId;
  if (!now) {
    if (docId) stopGone(docId);
    return false;
  }
  const holes = now.meta.holes ?? [];
  const hole = pts.map((p) => ({ x: p.x, y: p.y }));
  const problem = holeProblem(measurePoints(now.a), holes, hole);
  if (problem) {
    showStatusToast(now.t.docId, t(PROBLEM[problem]), false);
    return false;
  }
  annotationCapability()
    ?.forDocument(now.t.docId)
    .updateAnnotation(now.a.pageIndex, now.a.id, {
      measure: { ...now.meta, holes: [...holes, hole] },
    } as Partial<PdfAnnotationObject>);
  return true;
}

/** How a hole being clicked shows (dashed, in the area's colour) and is cut. */
const drawer: Drawer = {
  show(g: Gesture, context: HandlerContext) {
    const pointer = g.pointer;
    if (g.pts.length === 0 || !pointer) return;
    const now = targetNow();
    const o = now?.a as { strokeColor?: string; strokeWidth?: number } | undefined;
    const width = o?.strokeWidth ?? 1;
    const all = [...g.pts, pointer];
    const bounds = expandRect(rectFromPoints(all), width / 2);
    context.onPreview({
      type: PdfAnnotationSubtype.POLYGON,
      bounds,
      data: {
        rect: bounds,
        vertices: g.pts,
        currentVertex: pointer,
        strokeColor: o?.strokeColor ?? '#E44234',
        strokeWidth: width,
        color: 'transparent',
        opacity: 1,
        strokeStyle: PdfAnnotationBorderStyle.DASHED,
        strokeDashArray: [4, 3],
        flags: ['print'],
      },
    });
    // The hole's own area, in the target's units.
    setLive({
      page: g.page,
      kind: 'area',
      pts: all,
      ...(now ? { q: { areaUnit: now.meta.areaUnit, areaDecimals: now.meta.areaDecimals } } : {}),
    });
  },
  place(g: Gesture) {
    addHole(g.pts);
  },
  hide(context: HandlerContext) {
    context.onPreview(null);
  },
};

/** The pointer handlers of Cutout. */
export function cutoutHandlerFactory(): HandlerFactory<PdfAnnotationObject> {
  return {
    annotationType: PdfAnnotationSubtype.POLYGON,
    create(context) {
      const { pageIndex, pageSize, scale } = context;
      const where = { doc: registeringDoc(), tool: CUTOUT_TOOL, page: pageIndex };
      attachGesture(where, context, drawer);
      const onPage = (p: Pt): Pt => ({
        x: Math.min(Math.max(p.x, 0), pageSize.width),
        y: Math.min(Math.max(p.y, 0), pageSize.height),
      });
      return {
        onClick: (pos: Pt, evt: { ctrlKey?: boolean; metaKey?: boolean } | undefined) => {
          if (evt?.ctrlKey || evt?.metaKey) return;
          const target = cutoutStore.getState().target;
          if (!target || !targetNow()) {
            stopGone(where.doc);
            return;
          }
          if (target.docId !== where.doc || target.page !== pageIndex) {
            showStatusToast(
              where.doc,
              t('measure.cutout.otherPage', { page: String(target.page + 1) }),
              false,
            );
            return;
          }
          const close = CLOSE_HANDLE_PX / 2 / (scale || 1);
          clickMeasure(where, 'area', onPage(pos), context, drawer, close);
        },
        onPointerMove: (pos: Pt) => {
          moveMeasure(where, onPage(pos));
        },
        onDoubleClick: () => {
          if (drawingOn(where)) finishMeasure();
        },
      };
    },
  };
}

// Leaving Cutout (Esc, another tool): the area it cut is selected again.
appStore.subscribe((s, prev) => {
  if (prev.tool !== CUTOUT_TOOL || s.tool === CUTOUT_TOOL) return;
  const target = cutoutStore.getState().target;
  cutoutStore.setState({ target: null });
  if (!target || s.tool !== 'select') return;
  const scope = annotationCapability()?.forDocument(target.docId);
  if (scope?.getAnnotationById(target.id)) {
    // After the plugin has taken the tool change (it clears the selection on it).
    queueMicrotask(() => {
      scope.selectAnnotation(target.page, target.id);
    });
  }
});
