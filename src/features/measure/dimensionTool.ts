// Distance by clicks, drawn as a dimension (M13-10, ADR-034 Amendment 3): click
// the first point, click the second, move the pointer sideways to set where the
// dimension line goes, and click to place it. Enter or a double-click places it
// where it is, Esc drops it. A press-and-drag from one point to the other still
// works: the release is the second point, then the offset as usual. The plugin
// previews and commits; wrapFactory (drawTools.ts) snaps every point, follows
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
import {
  boundsOf,
  dimensionGeometry,
  leaderFor,
  leaderOf,
  offsetOf,
  unionRect,
  type Leader,
  type Pt,
} from '../../model/dimension';
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

/** The Distance tool's pointer handlers. */
export const dimensionHandlerFactory: HandlerFactory<PdfAnnotationObject> = {
  annotationType: PdfAnnotationSubtype.LINE,
  create(context) {
    const { pageIndex, pageSize, getTool, onPreview, onCommit } = context;
    let a: Pt | null = null;
    let b: Pt | null = null;
    let pointer: Pt | null = null;
    let offset = 0;
    // A press-and-drag from the first point to the second (the earlier gesture).
    let down: Pt | null = null;
    let dragging = false;
    let skipClick = false;

    const onPage = (p: Pt): Pt => ({
      x: Math.min(Math.max(p.x, 0), pageSize.width),
      y: Math.min(Math.max(p.y, 0), pageSize.height),
    });
    const defaults = () => {
      const d = (getTool()?.defaults ?? {}) as Record<string, unknown>;
      return {
        ...d,
        strokeWidth: typeof d['strokeWidth'] === 'number' ? d['strokeWidth'] : 1,
        strokeColor: typeof d['strokeColor'] === 'string' ? d['strokeColor'] : '#E44234',
        color: typeof d['color'] === 'string' ? d['color'] : 'transparent',
        opacity: typeof d['opacity'] === 'number' ? d['opacity'] : 1,
        strokeStyle:
          (d['strokeStyle'] as PdfAnnotationBorderStyle | undefined) ??
          PdfAnnotationBorderStyle.SOLID,
        strokeDashArray: Array.isArray(d['strokeDashArray'])
          ? (d['strokeDashArray'] as number[])
          : [],
        lineEndings: (d['lineEndings'] as LineEndings | undefined) ?? {
          start: PdfAnnotationLineEnding.OpenArrow,
          end: PdfAnnotationLineEnding.OpenArrow,
        },
      };
    };
    const reset = (): void => {
      a = null;
      b = null;
      pointer = null;
      offset = 0;
      down = null;
      dragging = false;
      onPreview(null);
      setLive(null);
    };
    const preview = (): void => {
      if (!a || !pointer) return;
      const d = defaults();
      if (!b) {
        const rect = patching.lineRectWithEndings([a, pointer], d.strokeWidth, d.lineEndings);
        onPreview({
          type: PdfAnnotationSubtype.LINE,
          bounds: rect,
          data: { ...d, rect, linePoints: { start: a, end: pointer } },
        });
        setLive({ page: pageIndex, kind: 'distance', pts: [a, pointer] });
        return;
      }
      const leader = leaderFor(offset);
      const g = dimensionGeometry(a, b, leader, true);
      const rect = dimensionRect(a, b, leader, d.strokeWidth, d.lineEndings);
      onPreview({
        type: PdfAnnotationSubtype.LINE,
        bounds: rect,
        data: { ...d, rect, linePoints: { start: g.start, end: g.end } },
      });
      setLive({
        page: pageIndex,
        kind: 'distance',
        pts: [a, b],
        at: pointer,
        ...(leader ? { leaders: g.leaders, color: d.strokeColor, width: d.strokeWidth } : {}),
      });
    };
    const commit = (): void => {
      if (!a || !b) {
        reset();
        return;
      }
      const d = defaults();
      const leader = leaderFor(offset);
      const annotation = {
        ...d,
        type: PdfAnnotationSubtype.LINE,
        id: uuidV4(),
        pageIndex,
        flags: ['print'],
        created: new Date(),
        linePoints: { start: a, end: b },
        rect: dimensionRect(a, b, leader, d.strokeWidth, d.lineEndings),
        ...(leader ? { leader } : {}),
      } as unknown as PdfAnnotationObject;
      reset();
      onCommit(annotation);
    };
    // `drawing` tells wrapFactory when nothing is half placed any more.
    const handlers = {
      drawing: () => a !== null,
      onPointerDown: (pos: Pt) => {
        down = onPage(pos);
        dragging = false;
      },
      onPointerMove: (pos: Pt) => {
        const p = onPage(pos);
        pointer = p;
        if (down && !a && Math.hypot(p.x - down.x, p.y - down.y) > DRAG) {
          // A drag from the first point: it is placed where the press went down.
          a = down;
          dragging = true;
        }
        if (a && b) offset = offsetOf(a, b, p, true);
        preview();
      },
      onPointerUp: (pos: Pt) => {
        const p = onPage(pos);
        if (dragging && a && !b && Math.hypot(p.x - a.x, p.y - a.y) > DRAG) {
          // The release is the second point; the click that follows is not a new one.
          b = p;
          offset = 0;
          skipClick = true;
          preview();
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
        const p = onPage(pos);
        pointer = p;
        if (!a) {
          a = p;
          preview();
        } else if (!b) {
          if (Math.hypot(p.x - a.x, p.y - a.y) < 1) return;
          b = p;
          offset = 0;
          preview();
        } else {
          offset = offsetOf(a, b, p, true);
          commit();
        }
      },
      // Enter (finishDrawing) and a double-click: place it where it is.
      onDoubleClick: () => {
        if (a && b) commit();
        else reset();
      },
      onPointerCancel: () => {
        reset();
      },
    };
    return handlers;
  },
};
