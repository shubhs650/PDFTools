// A selected measurement while the annotation plugin draws it (M14-03): the
// plugin draws the line or shape from its points, not the appearance, so its
// caption (and an area's see-through fill) is added here, placed as the
// Render worker places it (measureMarkup.ts), so the value stays in view while
// the measurement is selected or edited. An Angle, Radius or Diameter (a
// Stamp, M14-05) is drawn here whole while selected: the plugin's image of it
// is hidden then (it is redrawn only once the Render worker has the new
// appearance). An Area's or Volume's cutouts are left out of its fill and
// outlined dashed (M14-06). Pointer-transparent; no PDF work.
import { PdfAnnotationSubtype, type PdfAnnotationObject } from '@embedpdf/models';
import { isCurveTool } from '../../model/measureCurve';
import {
  CAPTION_SIZE,
  FILL_ALPHA,
  captionPlace,
  captionSize,
  estimateWidth,
  isAreaTool,
  metaOf,
  mirror,
  mirroredHoles,
} from '../../model/measureMarkup';
import { leaderOf } from '../../model/dimension';
import { measurePoints } from '../../model/measurement';
import { CurveShapeSvg } from './CurveShape';

/** Its test id (not shown). */
const SELECTED_ID = 'selected-measure-curve';

export function SelectedMeasure({
  annotation,
  scale,
}: {
  annotation: PdfAnnotationObject;
  scale: number;
}) {
  const meta = metaOf(annotation);
  if (!meta) return null;
  const o = annotation as unknown as {
    strokeColor?: string;
    strokeWidth?: number;
    opacity?: number;
  };
  const color = o.strokeColor ?? 'currentColor';
  const pts = measurePoints(annotation);
  const text = annotation.contents ?? '';
  const { origin } = annotation.rect;
  const local = (p: { x: number; y: number }) => ({
    x: (p.x - origin.x) * scale,
    y: (p.y - origin.y) * scale,
  });
  const holes = isAreaTool(meta.tool) ? (meta.holes ?? []) : [];
  const xy = (q: { x: number; y: number }[]): string =>
    q.map((p) => `${String(local(p).x)},${String(local(p).y)}`).join(' ');
  const fill =
    isAreaTool(meta.tool) && (meta.fill || holes.length) && pts.length > 2 ? (
      <svg className="selected-measure-fill" aria-hidden="true">
        {meta.fill ? (
          <path
            d={[pts, ...holes].map((q) => `M${xy(q).replace(/ /gu, ' L')} Z`).join(' ')}
            fillRule="evenodd"
            fill={meta.fill}
            fillOpacity={FILL_ALPHA * (o.opacity ?? 1)}
          />
        ) : null}
        {holes.map((h, i) => (
          <polygon
            key={i}
            data-testid="selected-measure-hole"
            points={xy(h)}
            fill="none"
            stroke={color}
            strokeOpacity={o.opacity ?? 1}
            strokeWidth={Math.max(1, (o.strokeWidth ?? 1) * scale)}
            strokeDasharray={`${String(4 * scale)} ${String(3 * scale)}`}
          />
        ))}
      </svg>
    ) : null;
  const curve =
    annotation.type === PdfAnnotationSubtype.STAMP && isCurveTool(meta.tool) ? (
      <CurveShapeSvg
        tool={meta.tool}
        pts={pts}
        shape={meta.shape}
        color={color}
        width={o.strokeWidth ?? 1}
        opacity={o.opacity ?? 1}
        scale={scale}
        origin={origin}
        data-testid={SELECTED_ID}
      />
    ) : null;
  if (!text.trim()) return fill ?? curve;
  const { width, height } = captionSize(estimateWidth(text), 1);
  const box = captionPlace(
    meta,
    pts.map(mirror),
    leaderOf(annotation),
    width,
    height,
    mirroredHoles(meta),
  );
  const at = local(mirror(box.at));
  return (
    <>
      {fill}
      {curve}
      <span
        className="selected-measure-caption"
        aria-hidden="true"
        style={{
          left: at.x,
          top: at.y,
          color,
          opacity: o.opacity ?? 1,
          fontSize: CAPTION_SIZE * scale,
          transform: `translate(-50%, -50%) rotate(${String(-box.angle)}rad)`,
        }}
      >
        {text}
      </span>
    </>
  );
}
