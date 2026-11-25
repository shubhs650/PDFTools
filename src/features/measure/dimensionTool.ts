// Distance by clicks, drawn as a dimension (M13-10, ADR-034 Amendment 3): click
// the first point, click the second, move the pointer sideways to set where the
// dimension line goes, and click to place it. Enter or a double-click places it
// where it is, Esc drops it. A press-and-drag from one point to the other still
// works: the release is the second point, then the offset as usual. The points
// live outside the handler (gesture.ts), so a zoom, pan or scroll between the
// clicks keeps them (M14-02, D-78). The plugin previews and commits; wrapFactory (drawTools.ts) snaps every point, follows
// the pointer with the loupe and constrains with Shift. The leader lines are
// stored as the standard /LL and /LLE (model/dimension.ts); the Render worker
// draws them (workers/render/dimensionAppearance.ts). Points are EmbedPDF page
// points (top-left origin).
import {
  PdfAnnotationBorderStyle,
  PdfAnnotationLineEnding,
  PdfAnnotationSubtype,
  uuidV4,
  type LineEndings,
  type PdfAnnotationObject,
} from '@embedpdf/models';
import { patching, type HandlerFactory } from '@embedpdf/plugin-annotation';
import type { Gesture } from '../../model/measureGesture';
import type { HandlerContext } from '../annotate/tools/drawTools';
import {
  boundsOf,
  dimensionGeometry,
  leaderFor,
  leaderOf,
  unionRect,
  type Leader,
  type Pt,
} from '../../model/dimension';
import {
  attachGesture,
  clickMeasure,
  currentPoints,
  drawingOn,
  finishMeasure,
  moveMeasure,
  registeringDoc,
  type Drawer,
} from './gesture';
import { setLive } from './measureStore';

interface Rect {
  origin: Pt;
  size: { width: number; height: number };
}

/** The rect that holds a dimension: its line with its endings, and its leader lines. */
export function dimensionRect(
  a: Pt,
  b: Pt,
  leader: Leader | null,
  strokeWidth: number,
  endings: LineEndings | undefined,
): Rect {
  const g = dimensionGeometry(a, b, leader, true);
  const line = patching.lineRectWithEndings([g.start, g.end], strokeWidth, endings);
  if (!leader) return line;
  return unionRect(line, boundsOf([a, b, ...g.leaders[0], ...g.leaders[1]], strokeWidth));
}

export type Patch = (
  orig: PdfAnnotationObject,
  ctx: patching.TransformContext,
) => Partial<PdfAnnotationObject>;

/**
 * A line tool's transform that keeps the leader lines inside the rect when a
 * point is dragged or a style changes (a move carries the whole rect along).
 */
export function withLeaderRect(base: Patch | undefined): Patch {
  return (orig, ctx) => {
    const changes = base ? base(orig, ctx) : ctx.changes;
    if (ctx.type === 'move') return changes;
    const merged = { ...orig, ...changes } as unknown as {
      type: PdfAnnotationSubtype;
      rotation?: number;
      linePoints?: { start: Pt; end: Pt };
      strokeWidth?: number;
      lineEndings?: LineEndings;
    };
    const leader = leaderOf(merged);
    if (merged.type !== PdfAnnotationSubtype.LINE || !leader || !merged.linePoints) return changes;
    if (merged.rotation) return changes;
    const { start, end } = merged.linePoints;
    return {
      ...changes,
      rect: dimensionRect(start, end, leader, merged.strokeWidth ?? 1, merged.lineEndings),
    };
  };
}

/** A press this far (page points) from where it went down is a drag. */
const DRAG = 4;

function defaultsOf(context: HandlerContext) {
  const d = (context.getTool()?.defaults ?? {}) as Record<string, unknown>;
  return {
    ...d,
    strokeWidth: typeof d['strokeWidth'] === 'number' ? d['strokeWidth'] : 1,
    strokeColor: typeof d['strokeColor'] === 'string' ? d['strokeColor'] : '#E44234',
    color: typeof d['color'] === 'string' ? d['color'] : 'transparent',
    opacity: typeof d['opacity'] === 'number' ? d['opacity'] : 1,
    strokeStyle:
      (d['strokeStyle'] as PdfAnnotationBorderStyle | undefined) ?? PdfAnnotationBorderStyle.SOLID,
    strokeDashArray: Array.isArray(d['strokeDashArray']) ? (d['strokeDashArray'] as number[]) : [],
    lineEndings: (d['lineEndings'] as LineEndings | undefined) ?? {
      start: PdfAnnotationLineEnding.OpenArrow,
      end: PdfAnnotationLineEnding.OpenArrow,
    },
  };
}

/** A Distance's preview, live value and annotation, from its gesture. */
export const dimensionDrawer: Drawer = {
  show(g: Gesture, context: HandlerContext) {
    const [a, b] = g.pts;
    const pointer = g.pointer;
    if (!a || !pointer) return;
    const d = defaultsOf(context);
    if (!b) {
      const rect = patching.lineRectWithEndings([a, pointer], d.strokeWidth, d.lineEndings);
      context.onPreview({
        type: PdfAnnotationSubtype.LINE,
        bounds: rect,
        data: { ...d, rect, linePoints: { start: a, end: pointer } },
      });
      setLive({ page: g.page, kind: 'distance', pts: [a, pointer] });
      return;
    }
    const leader = leaderFor(g.offset);
    const geo = dimensionGeometry(a, b, leader, true);
    const rect = dimensionRect(a, b, leader, d.strokeWidth, d.lineEndings);
    context.onPreview({
      type: PdfAnnotationSubtype.LINE,
      bounds: rect,
      data: { ...d, rect, linePoints: { start: geo.start, end: geo.end } },
    });
    setLive({
      page: g.page,
      kind: 'distance',
      pts: [a, b],
      at: pointer,
      ...(leader ? { leaders: geo.leaders, color: d.strokeColor, width: d.strokeWidth } : {}),
    });
  },
  place(g: Gesture, context: HandlerContext) {
    const [a, b] = g.pts;
    if (!a || !b) return;
    const d = defaultsOf(context);
    const leader = leaderFor(g.offset);
    const annotation = {
      ...d,
      type: PdfAnnotationSubtype.LINE,
      id: uuidV4(),
      pageIndex: context.pageIndex,
      flags: ['print'],
      created: new Date(),
      linePoints: { start: a, end: b },
      rect: dimensionRect(a, b, leader, d.strokeWidth, d.lineEndings),
      ...(leader ? { leader } : {}),
    } as unknown as PdfAnnotationObject;
    context.onCommit(annotation);
  },
  hide(context: HandlerContext) {
    context.onPreview(null);
  },
};

/** The Distance tool's pointer handlers. */
export const dimensionHandlerFactory: HandlerFactory<PdfAnnotationObject> = {
  annotationType: PdfAnnotationSubtype.LINE,
  create(context) {
    const { pageIndex, pageSize } = context;
    const where = { doc: registeringDoc(), tool: 'measureLength', page: pageIndex };
    // A zoom or a scroll made this handler: the Distance in progress carries on here.
    attachGesture(where, context, dimensionDrawer);
    // A press-and-drag from the first point to the second (the earlier gesture).
    let down: Pt | null = null;
    let dragging = false;
    let skipClick = false;

    const onPage = (p: Pt): Pt => ({
      x: Math.min(Math.max(p.x, 0), pageSize.width),
      y: Math.min(Math.max(p.y, 0), pageSize.height),
    });
    const placed = (): number => currentPoints(where);
    const clickAt = (p: Pt): void => {
      clickMeasure(where, 'distance', p, context, dimensionDrawer);
    };
    return {
      onPointerDown: (pos: Pt) => {
        down = onPage(pos);
        dragging = false;
      },
      onPointerMove: (pos: Pt) => {
        const p = onPage(pos);
        if (down && placed() === 0 && Math.hypot(p.x - down.x, p.y - down.y) > DRAG) {
          // A drag from the first point: it is placed where the press went down.
          clickAt(down);
          dragging = true;
        }
        moveMeasure(where, p);
      },
      onPointerUp: (pos: Pt) => {
        const p = onPage(pos);
        if (dragging && placed() === 1) {
          // The release is the second point; the click that follows is not a new one.
          const before = placed();
          clickAt(p);
          if (placed() > before) skipClick = true;
        }
        down = null;
        dragging = false;
      },
      onClick: (pos: Pt, evt: { ctrlKey?: boolean; metaKey?: boolean } | undefined) => {
        if (skipClick) {
          skipClick = false;
          return;
        }
        if (evt?.ctrlKey || evt?.metaKey) return;
        clickAt(onPage(pos));
      },
      // A double-click: place it where it is (Enter reaches it through gesture.ts).
      onDoubleClick: () => {
        if (drawingOn(where)) finishMeasure();
      },
    };
  },
};
