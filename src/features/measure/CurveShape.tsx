// An Angle, Radius or Diameter drawn in SVG (M14-05, D-73): while it is placed
// (the plugin has no preview for a Stamp) and while it is selected or edited
// (the plugin shows the Stamp's last rendered image, which can lag behind its
// points). The same geometry the Render worker draws (measureCurve.ts), in
// EmbedPDF page points; arcs keep their sense under the y-down flip, so no
// mirroring is needed for the lines and arcs. Pointer-transparent; no PDF work.
import { arcPath, curveDrawing, type CurveShape, type CurveTool } from '../../model/measureCurve';
import type { Pt } from '../../model/scale';

export function CurveShapeSvg({
  tool,
  pts,
  shape,
  color,
  width,
  opacity = 1,
  scale,
  origin = { x: 0, y: 0 },
  'data-testid': testId,
}: {
  tool: CurveTool;
  /** The points so far (EmbedPDF page points). */
  pts: readonly Pt[];
  shape?: CurveShape | undefined;
  color: string;
  width: number;
  opacity?: number;
  scale: number;
  /** The page point at the SVG's top-left (the selected Stamp's rect origin). */
  origin?: Pt;
  'data-testid'?: string;
}) {
  const local = (p: Pt): Pt => ({ x: (p.x - origin.x) * scale, y: (p.y - origin.y) * scale });
  const d = pts.length >= 2 ? curveDrawing(tool, pts, shape ? { width, shape } : { width }) : null;
  // Two points of a three-point pick (or of an Angle): the line between them so far.
  const lines: (readonly [Pt, Pt])[] = d
    ? d.lines
    : pts.length >= 2
      ? pts.slice(1).map((p, i) => [pts[i] ?? p, p] as const)
      : [];
  if (lines.length === 0) return null;
  const sw = Math.max(1, width * scale);
  return (
    <svg className="measure-curve" aria-hidden="true" data-testid={testId} opacity={opacity}>
      <g fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        {lines.map(([p, q], i) => {
          const a = local(p);
          const b = local(q);
          return <line key={`l${String(i)}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
        })}
        {(d?.arcs ?? []).map((arc, i) => (
          <path
            key={`a${String(i)}`}
            d={arcPath({ ...arc, c: { x: arc.c.x - origin.x, y: arc.c.y - origin.y } }, scale)}
          />
        ))}
      </g>
    </svg>
  );
}
