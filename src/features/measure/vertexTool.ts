// Polylength, Perimeter and Area by clicks (M3-16, M13-10, M14-03), with their points kept outside
// the handler (M14-02, D-78, ADR-035): EmbedPDF's own polyline and polygon
// handlers keep their vertices inside, and the plugin makes new handlers on
// every zoom and whenever a page is laid out again, so a zoom between two
// clicks lost them. These handlers draw the same previews and commit the same
// annotations as the plugin's (a POLYLINE or POLYGON with the tool's
// defaults); the points live in gesture.ts. A Perimeter always closes: its
// PolyLine repeats its first vertex (ADR-035 Amendment 1), and its preview
// shows the closing side. An Area or Volume starts with the remembered units
// and a Volume with the remembered Depth (M14-06, quantitySettings.ts); its
// live value is the volume. Points are EmbedPDF page points.
import {
  expandRect,
  PdfAnnotationBorderStyle,
  PdfAnnotationLineEnding,
  PdfAnnotationSubtype,
  rectFromPoints,
  uuidV4,
  type LineEndings,
  type PdfAnnotationObject,
} from '@embedpdf/models';
import { patching, type HandlerFactory } from '@embedpdf/plugin-annotation';
import type { Gesture } from '../../model/measureGesture';
import type { Pt } from '../../model/scale';
import type { HandlerContext } from '../annotate/tools/drawTools';
import {
  attachGesture,
  clickMeasure,
  drawingOn,
  finishMeasure,
  moveMeasure,
  registeringDoc,
  type Drawer,
} from './gesture';
import { metaOf, type MeasureMeta } from '../../model/measureMarkup';
import { setLive } from './measureStore';
import { rememberedMeta } from './quantitySettings';

/** The plugin's handle around an area's first corner (CSS px): a click inside it closes the area. */
const CLOSE_HANDLE_PX = 14;

type VertexKind = 'polylength' | 'perimeter' | 'area';

function defaultsOf(context: HandlerContext) {
  const d = (context.getTool()?.defaults ?? {}) as Record<string, unknown>;
  return {
    ...d,
    strokeWidth: typeof d['strokeWidth'] === 'number' ? d['strokeWidth'] : 1,
    lineEndings: (d['lineEndings'] as LineEndings | undefined) ?? {
      start: PdfAnnotationLineEnding.None,
      end: PdfAnnotationLineEnding.None,
    },
    color: typeof d['color'] === 'string' ? d['color'] : '#000000',
    opacity: typeof d['opacity'] === 'number' ? d['opacity'] : 1,
    strokeColor: typeof d['strokeColor'] === 'string' ? d['strokeColor'] : '#000000',
    strokeStyle:
      (d['strokeStyle'] as PdfAnnotationBorderStyle | undefined) ?? PdfAnnotationBorderStyle.SOLID,
    strokeDashArray: Array.isArray(d['strokeDashArray']) ? (d['strokeDashArray'] as number[]) : [],
    flags: Array.isArray(d['flags']) ? (d['flags'] as string[]) : ['print'],
  };
}

function boundsFor(kind: VertexKind, pts: Pt[], d: ReturnType<typeof defaultsOf>) {
  return kind === 'area'
    ? expandRect(rectFromPoints(pts), d.strokeWidth / 2)
    : patching.lineRectWithEndings(pts, d.strokeWidth, d.lineEndings);
}

/** A Perimeter's points with its closing side: the first point again. */
const closed = (pts: Pt[]): Pt[] => {
  const first = pts[0];
  return first ? [...pts, first] : pts;
};

/** The tool's `measure` default with what an Area or Volume remembers (M14-06). */
function measureOf(d: Record<string, unknown>): MeasureMeta | null {
  const m = metaOf(d);
  return m ? (metaOf({ measure: { ...m, ...rememberedMeta(m.tool) } }) ?? m) : null;
}

/** The live value's kind (a Polylength is valued as a path, like a Perimeter). */
const liveKind = (kind: VertexKind): 'perimeter' | 'area' =>
  kind === 'area' ? 'area' : 'perimeter';

/** How a Polylength or Perimeter (a polyline) or an Area (a polygon) is shown and placed. */
export function vertexDrawer(kind: VertexKind): Drawer {
  const type = kind === 'area' ? PdfAnnotationSubtype.POLYGON : PdfAnnotationSubtype.POLYLINE;
  return {
    show(g: Gesture, context: HandlerContext) {
      const pointer = g.pointer;
      if (g.pts.length === 0 || !pointer) return;
      const d = defaultsOf(context);
      const all = [...g.pts, pointer];
      const path = kind === 'perimeter' ? closed(all) : all;
      const bounds = boundsFor(kind, path, d);
      // The plugin's preview data: a polygon's placed vertices and the moving one apart.
      context.onPreview({
        type,
        bounds,
        data: {
          ...d,
          rect: bounds,
          vertices: kind === 'area' ? g.pts : path,
          currentVertex: pointer,
        },
      });
      const m = measureOf(d);
      setLive({ page: g.page, kind: liveKind(kind), pts: path, ...(m ? { q: m } : {}) });
    },
    place(g: Gesture, context: HandlerContext) {
      const d = defaultsOf(context);
      const vertices = kind === 'perimeter' ? closed(g.pts) : g.pts;
      const measure = measureOf(d);
      const annotation = {
        ...d,
        ...(measure ? { measure } : {}),
        vertices,
        rect: boundsFor(kind, vertices, d),
        type,
        pageIndex: context.pageIndex,
        id: uuidV4(),
        created: new Date(),
      } as unknown as PdfAnnotationObject;
      context.onCommit(annotation);
    },
    hide(context: HandlerContext) {
      context.onPreview(null);
    },
  };
}

/** The pointer handlers of Polylength, Perimeter or Area. */
export function vertexHandlerFactory(
  kind: VertexKind,
  tool: string,
): HandlerFactory<PdfAnnotationObject> {
  const drawer = vertexDrawer(kind);
  return {
    annotationType: kind === 'area' ? PdfAnnotationSubtype.POLYGON : PdfAnnotationSubtype.POLYLINE,
    create(context) {
      const { pageIndex, pageSize, scale } = context;
      const where = { doc: registeringDoc(), tool, page: pageIndex };
      // A zoom or a scroll made this handler: the measurement in progress carries on here.
      attachGesture(where, context, drawer);
      const onPage = (p: Pt): Pt => ({
        x: Math.min(Math.max(p.x, 0), pageSize.width),
        y: Math.min(Math.max(p.y, 0), pageSize.height),
      });
      return {
        onClick: (pos: Pt, evt: { ctrlKey?: boolean; metaKey?: boolean } | undefined) => {
          if (evt?.ctrlKey || evt?.metaKey) return;
          const close = CLOSE_HANDLE_PX / 2 / (scale || 1);
          clickMeasure(where, kind, onPage(pos), context, drawer, close);
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
