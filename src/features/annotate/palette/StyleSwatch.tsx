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

export function StyleSwatch({
  tool,
  props,
  size = SIZE,
}: {
  tool: StyleTool;
  props: StyleProps;
  /** Drawn size in px (the window's tiles are larger, M6-17); the drawing scales. */
  size?: number;
}) {
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
      body =
        tool === 'inkHighlighter' ? (
          <path
            d="M3 15C7 9 11 9 13 12S18 15 21 9"
            stroke={stroke}
            strokeWidth={5}
            strokeLinecap="round"
            fill="none"
            opacity={props.opacity ?? 1}
          />
        ) : (
          <>
            <rect x={2} y={7} width={20} height={10} fill={stroke} opacity={props.opacity ?? 1} />
            <path d="M5 12H19" stroke="var(--color-text-muted)" strokeWidth={1.5} />
          </>
        );
      break;
    case 'area': {
      const area = visible(props.color) ? props.color : stroke;
      body = (
        <>
          <rect x={3} y={5} width={18} height={14} fill={area} opacity={props.opacity ?? 1} />
          <path d="M6 10H18M6 14H15" stroke="var(--color-text-muted)" strokeWidth={1.5} />
        </>
      );
      break;
    }
    case 'markup': {
      // Text lines, marked as the tool marks them.
      const mark =
        tool === 'strikeout' ? (
          <path d="M3 12H21" stroke={stroke} strokeWidth={2} />
        ) : tool === 'squiggly' ? (
          <path
            d="M3 18L5 16L7 18L9 16L11 18L13 16L15 18L17 16L19 18L21 16"
            stroke={stroke}
            strokeWidth={1.5}
            fill="none"
          />
        ) : (
          <path d="M3 17H21" stroke={stroke} strokeWidth={2} />
        );
      body = (
        <>
          <path d="M4 12H20" stroke="var(--color-text-muted)" strokeWidth={4} opacity={0.6} />
          {mark}
        </>
      );
      break;
    }
    case 'note':
      // A note: a folded sheet with lines.
      body = (
        <>
          <path
            d="M4 4H20V15L15 20H4Z"
            fill={stroke}
            stroke="var(--color-text-muted)"
            strokeWidth={1}
            strokeLinejoin="round"
          />
          <path d="M7 9H17M7 12.5H14" stroke="var(--color-text-muted)" strokeWidth={1.2} />
        </>
      );
      break;
  }
  return (
    <svg
      className="style-swatch-art"
      width={size}
      height={size}
      viewBox={`0 0 ${String(SIZE)} ${String(SIZE)}`}
      aria-hidden="true"
      focusable="false"
    >
      {body}
    </svg>
  );
}
