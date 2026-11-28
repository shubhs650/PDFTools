// Angle, Radius and Diameter by clicks (M14-05, D-73, plan §5; ADR-035
// Amendment 1: each is one Stamp whose appearance is entirely ours). Angle:
// three clicks (an arm's end, the corner, the other arm's end). Radius and
// Diameter: the centre then a point on the edge, or three points on the curve
// (the method chosen in the Properties pane, curveMethod.ts). The points live
// outside the handler (gesture.ts, M14-02), so any view change keeps them;
// snapping, Shift (0°, 45°, 90°, still snapping) and the loupe work as for the
// other measuring tools. The preview and the live value are drawn by
// MeasureOverlay (measureStore); the placed Stamp carries the points in its
// `measure` field, and its value, caption and appearance follow
// (measurements.ts, workers/render/measureAppearance.ts).
import {
  PdfAnnotationSubtype,
  uuidV4,
  type PdfAnnotationObject,
  type PdfStampAnnoObject,
} from '@embedpdf/models';
import type { HandlerFactory } from '@embedpdf/plugin-annotation';
import { t } from '../../i18n';
import {
  BLANK_STAMP_PDF,
  curveDrawing,
  pointsNeeded,
  type CurveMethod,
  type CurveTool,
} from '../../model/measureCurve';
import { bounds } from '../../model/measureGeometry';
import type { GestureKind, Gesture } from '../../model/measureGesture';
import { mirror, type MeasureMeta } from '../../model/measureMarkup';
import type { Pt } from '../../model/scale';
import type { HandlerContext } from '../annotate/tools/drawTools';
import { showStatusToast } from '../snapshot/snapshot';
import { curveMethodStore } from './curveMethod';
import {
  attachGesture,
  clickMeasure,
  drawingOn,
  finishMeasure,
  moveMeasure,
  registeringDoc,
  type Drawer,
} from './gesture';
import { setLive } from './measureStore';

/** The method a curve tool is picked with now. */
export function methodFor(tool: CurveTool): CurveMethod {
  return tool === 'angle' ? 'centre' : curveMethodStore.getState()[tool];
}

/** The gesture a curve tool makes with its method (measureGesture.ts). */
export function gestureKindOf(tool: CurveTool, method: CurveMethod = methodFor(tool)): GestureKind {
  if (tool === 'angle') return 'angle';
  return pointsNeeded(tool, method) === 3 ? 'circle3' : 'circle2';
}

function defaultsOf(context: HandlerContext) {
  const d = (context.getTool()?.defaults ?? {}) as Record<string, unknown>;
  return {
    strokeWidth: typeof d['strokeWidth'] === 'number' ? d['strokeWidth'] : 1,
    strokeColor: typeof d['strokeColor'] === 'string' ? d['strokeColor'] : '#E44234',
    opacity: typeof d['opacity'] === 'number' ? d['opacity'] : 1,
    flags: Array.isArray(d['flags']) ? (d['flags'] as string[]) : ['print'],
  };
}

/** A curve measurement's rect from its drawing (the caption is added on commit, measurements.ts). */
function rectOf(tool: CurveTool, pts: readonly Pt[], width: number) {
  const d = curveDrawing(tool, pts.map(mirror), { width });
  const ext = d ? d.extent.map(mirror) : pts;
  const [x0, y0, x1, y1] = bounds(ext, width / 2 + 1);
  return { origin: { x: x0, y: y0 }, size: { width: x1 - x0, height: y1 - y0 } };
}

/** How an Angle, Radius or Diameter is shown while it is placed, and placed. */
export function curveDrawer(tool: CurveTool): Drawer {
  return {
    show(g: Gesture, context: HandlerContext) {
      const pointer = g.pointer;
      if (g.pts.length === 0 || !pointer) return;
      const d = defaultsOf(context);
      setLive({
        page: g.page,
        kind: tool,
        pts: [...g.pts, pointer],
        at: pointer,
        method: g.kind === 'circle3' ? 'three' : 'centre',
        color: d.strokeColor,
        width: d.strokeWidth,
      });
    },
    place(g: Gesture, context: HandlerContext) {
      // Three points in a line make no circle (and no curve to draw): nothing is placed.
      if (!curveDrawing(tool, g.pts.map(mirror))) {
        showStatusToast(g.doc, t('measure.curve.noCircle'), false);
        return;
      }
      const d = defaultsOf(context);
      const measure: MeasureMeta = { tool, pts: g.pts.map((p) => ({ x: p.x, y: p.y })) };
      const annotation = {
        ...d,
        type: PdfAnnotationSubtype.STAMP,
        id: uuidV4(),
        pageIndex: context.pageIndex,
        rect: rectOf(tool, g.pts, d.strokeWidth),
        measure,
        created: new Date(),
      } as unknown as PdfStampAnnoObject;
      context.onCommit(annotation, {
        data: BLANK_STAMP_PDF.slice().buffer,
        mimeType: 'application/pdf',
      } as never);
    },
    hide(context: HandlerContext) {
      context.onPreview(null);
    },
  };
}

/** The pointer handlers of Angle, Radius or Diameter. */
export function curveHandlerFactory(
  tool: CurveTool,
  pluginTool: string,
): HandlerFactory<PdfAnnotationObject> {
  const drawer = curveDrawer(tool);
  return {
    annotationType: PdfAnnotationSubtype.STAMP,
    create(context) {
      const { pageIndex, pageSize } = context;
      const where = { doc: registeringDoc(), tool: pluginTool, page: pageIndex };
      // A zoom or a scroll made this handler: the measurement in progress carries on here.
      attachGesture(where, context, drawer);
      const onPage = (p: Pt): Pt => ({
        x: Math.min(Math.max(p.x, 0), pageSize.width),
        y: Math.min(Math.max(p.y, 0), pageSize.height),
      });
      return {
        onClick: (pos: Pt, evt: { ctrlKey?: boolean; metaKey?: boolean } | undefined) => {
          if (evt?.ctrlKey || evt?.metaKey) return;
          clickMeasure(where, gestureKindOf(tool), onPage(pos), context, drawer);
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
