// A style's preview in the palette and the Comment Styles Palette dialog
// (M6-07): drawn by us from the style's properties (colour, width, fill,
// cloudy border) in the shape of the tool's comment. No artwork (rule 15).
import { KIND } from '../tools/stylePalette';
import type { StyleProps, StyleTool } from '../tools/toolDefaults';

const SIZE = 24;

/** A cloudy outline (scallops) along a rectangle inset by `m`. */
function cloudPath(m: number): string {
  const lo = m;
  const hi = SIZE - m;
  const n = 4;
  const step = (hi - lo) / n;
  const r = step / 2;
  const arc = (x: number, y: number) =>
    `A${String(r)} ${String(r)} 0 0 1 ${String(x)} ${String(y)}`;
  let d = `M${String(lo)} ${String(lo)}`;
  for (let i = 1; i <= n; i++) d += arc(lo + i * step, lo);
  for (let i = 1; i <= n; i++) d += arc(hi, lo + i * step);
  for (let i = 1; i <= n; i++) d += arc(hi - i * step, hi);
  for (let i = 1; i <= n; i++) d += arc(lo, hi - i * step);
  return `${d}Z`;
}

const visible = (c: string | undefined): c is string => !!c && c !== 'transparent';

export function StyleSwatch({ tool, props }: { tool: StyleTool; props: StyleProps }) {
  const kind = KIND[tool];
  const stroke = props.strokeColor ?? props.color ?? props.fontColor ?? 'currentColor';
  const width = Math.min(4, Math.max(1, props.strokeWidth ?? 1));
  const fill = visible(props.color) && kind === 'shape' ? props.color : 'none';
  const cloudy = kind === 'cloud' || (props.cloudyBorderIntensity ?? 0) > 0;
  const dashed = props.strokeStyle === 2 ? '3 2' : undefined;
  const common = {
    stroke,
    strokeWidth: width,
    fill,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
    ...(dashed ? { strokeDasharray: dashed } : {}),
  };
  let body;
  switch (kind) {
    case 'text':
    case 'typewriter': {
      const text = props.fontColor ?? stroke;
      body = (
        <>
          {kind === 'text' && (props.strokeWidth ?? 1) > 0 ? (
            <rect x={3} y={4} width={18} height={16} {...common} strokeWidth={1} fill="none" />
          ) : null}
          {/* A "T": the text colour. */}
          <path d="M8 8.5H16M12 8.5V16.5" stroke={text} strokeWidth={2} strokeLinecap="round" />
        </>
      );
      break;
    }
    case 'line':
      body =
        tool === 'polyline' ? (
          <path d="M3 18L9 8L15 16L21 6" {...common} fill="none" />
        ) : (
          <>
            <path d="M4 20L20 4" {...common} fill="none" />
            {tool === 'lineArrow' ? (
              <path d="M12 4H20V12" {...common} fill="none" strokeDasharray={undefined} />
            ) : null}
          </>
        );
      break;
    case 'shape':
    case 'cloud':
      if (cloudy) body = <path d={cloudPath(5)} {...common} />;
      else if (tool === 'circle') body = <ellipse cx={12} cy={12} rx={8.5} ry={7} {...common} />;
      else if (tool === 'polygon') body = <path d="M12 3.5L20.5 10L17 20H7L3.5 10Z" {...common} />;
      else body = <rect x={4} y={5} width={16} height={14} {...common} />;
      break;
    case 'ink':
      body = <path d="M3 16C6 6 9 6 10 12S15 20 17 11S20 7 21 9" {...common} fill="none" />;
      break;
    case 'highlight':
      body = (
        <>
          <rect x={2} y={7} width={20} height={10} fill={stroke} opacity={props.opacity ?? 1} />
          <path d="M5 12H19" stroke="var(--color-text-muted)" strokeWidth={1.5} />
        </>
      );
      break;
  }
  return (
    <svg
      className="style-swatch-art"
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${String(SIZE)} ${String(SIZE)}`}
      aria-hidden="true"
      focusable="false"
    >
      {body}
    </svg>
  );
}
