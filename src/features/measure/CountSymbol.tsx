// A Count's symbol in SVG (M14-07, D-75): under the pointer while the Count
// tool is on (the plugin has no preview for a Stamp) and while a count is
// selected (the plugin's image of the Stamp can lag behind a change). The same
// shape the Render worker draws (model/measureCount.ts), in EmbedPDF page
// points. Pointer-transparent; no PDF work.
import { FILL_ALPHA } from '../../model/measureMarkup';
import { countSymbol, type CountShape } from '../../model/measureCount';
import type { Pt } from '../../model/scale';

export function CountSymbolSvg({
  shape,
  at,
  size,
  color,
  opacity = 1,
  scale,
  origin = { x: 0, y: 0 },
  'data-testid': testId,
}: {
  shape: CountShape;
  /** Its centre (EmbedPDF page points). */
  at: Pt;
  size: number;
  color: string;
  opacity?: number;
  scale: number;
  /** The page point at the SVG's top-left (the selected Stamp's rect origin). */
  origin?: Pt;
  'data-testid'?: string;
}) {
  const sym = countSymbol(shape, at, size, -1);
  const xy = (p: Pt): string =>
    `${String((p.x - origin.x) * scale)},${String((p.y - origin.y) * scale)}`;
  const sw = Math.max(1, sym.width * scale);
  return (
    <svg className="measure-curve" aria-hidden="true" data-testid={testId} opacity={opacity}>
      <g
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={color}
        fillOpacity={FILL_ALPHA}
      >
        {sym.circle ? (
          <circle
            cx={(sym.circle.c.x - origin.x) * scale}
            cy={(sym.circle.c.y - origin.y) * scale}
            r={sym.circle.r * scale}
          />
        ) : null}
        {sym.closed.map((pts, i) => (
          <polygon key={`c${String(i)}`} points={pts.map(xy).join(' ')} />
        ))}
        {sym.open.map((pts, i) => (
          <polyline key={`o${String(i)}`} points={pts.map(xy).join(' ')} fill="none" />
        ))}
      </g>
    </svg>
  );
}
