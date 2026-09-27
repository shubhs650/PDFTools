// The drawing and note tools (M3-09, §7.1): which EmbedPDF tool each Comment
// command turns on, and the pure geometry of Shift-constrained drawing. The
// plugin draws, previews and commits; tools.ts wraps its pointer handlers.

export const DRAW_TOOLS = [
  'textComment',
  'freeText',
  'freeTextCallout',
  'line',
  'lineArrow',
  'polyline',
  'polygon',
  'square',
  'circle',
  'cloud',
  'ink',
  'inkHighlighter',
  'link',
] as const;

/** A drawing tool; the id is also the plugin's tool id and interaction mode. */
export type DrawTool = (typeof DRAW_TOOLS)[number];

export const isDrawTool = (t: string): t is DrawTool =>
  (DRAW_TOOLS as readonly string[]).includes(t);

/** Comment tab command → plugin tool. */
export const DRAW_COMMANDS: Record<string, DrawTool> = {
  'comment.stickyNote': 'textComment',
  'comment.textBox': 'freeText',
  'comment.callout': 'freeTextCallout',
  'comment.line': 'line',
  'comment.arrow': 'lineArrow',
  'comment.polyline': 'polyline',
  'comment.polygon': 'polygon',
  'comment.rectangle': 'square',
  'comment.oval': 'circle',
  'comment.cloud': 'cloud',
  'comment.pencil': 'ink',
  'comment.inkHighlighter': 'inkHighlighter',
  'comment.link': 'link',
};

/** Tools that can also place their annotation from the keyboard (M3-Q6): Enter on the page. */
export const KEYBOARD_PLACED: ReadonlySet<DrawTool> = new Set(['textComment', 'freeText']);

/** Tools whose drawing is a chain of clicks, finished by Enter or double-click. */
export const VERTEX_TOOLS: ReadonlySet<DrawTool> = new Set(['polyline', 'polygon', 'cloud']);

/** Shift keeps lines at multiples of 45° … */
const ANGLED: ReadonlySet<DrawTool> = new Set([
  'line',
  'lineArrow',
  'polyline',
  'polygon',
  'cloud',
]);
/** … and boxes square. */
const BOXED: ReadonlySet<DrawTool> = new Set(['square', 'circle', 'link']);

export interface Pt {
  x: number;
  y: number;
}

/** `to` moved onto the nearest 45° ray from `from`, keeping its distance along that ray. */
export function snapAngle(from: Pt, to: Pt, stepDeg = 45): Pt {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { ...to };
  const step = (stepDeg * Math.PI) / 180;
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  // Projection onto the ray, so the point stays under the pointer's reach.
  const d = dx * Math.cos(a) + dy * Math.sin(a);
  return { x: from.x + d * Math.cos(a), y: from.y + d * Math.sin(a) };
}

/** `to` moved so the box from `from` is square (the larger side wins), in `to`'s quadrant. */
export function snapSquare(from: Pt, to: Pt): Pt {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: from.x + Math.sign(dx || 1) * side, y: from.y + Math.sign(dy || 1) * side };
}

/** The constrained pointer position for `tool` with Shift held, from its anchor point. */
export function constrain(tool: string, anchor: Pt | null, pos: Pt): Pt {
  if (!anchor || !isDrawTool(tool)) return pos;
  if (ANGLED.has(tool)) return snapAngle(anchor, pos);
  if (BOXED.has(tool)) return snapSquare(anchor, pos);
  return pos;
}

/** A rect of `size` centred on a page of `page` size (page points). */
export function centred(
  page: { width: number; height: number },
  size: { width: number; height: number },
): { origin: Pt; size: { width: number; height: number } } {
  return {
    origin: { x: (page.width - size.width) / 2, y: (page.height - size.height) / 2 },
    size,
  };
}
