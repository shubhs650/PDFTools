// The drawing and note tools (M3-09, §7.1): which EmbedPDF tool each Comment
// command turns on, and the pure geometry of Shift-constrained drawing. The
// plugin draws, previews and commits; tools.ts wraps its pointer handlers.

export const DRAW_TOOLS = [
  'textComment',
  'freeText',
  // A text box without a box (/IT /FreeTextTypeWriter, M6-03): a tool of ours on the plugin's free text.
  'typewriter',
  'freeTextCallout',
  // Highlight Area (M6-08): a yellow rectangle blended with Multiply, on the plugin's square.
  'highlightArea',
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
  // Stamps (M3-14): tools of ours, registered with the plugin (stamps/stampTools.ts).
  'dynamicStamp',
  'imageStamp',
  // Calibrate (M3-15): two clicks on the page (measure/calibrate.ts).
  'calibrate',
  // Measurements (M3-16): line, polyline and polygon with a dimension intent (measure/measureTools.ts).
  'measureDistance',
  'measurePerimeter',
  'measureArea',
  // Scale viewport (M3-17): a rectangle, then the dialog (measure/viewports.ts).
  'scaleViewport',
  // Visual signatures (M6-13): @embedpdf/plugin-signature's placement tools (sign/signDocument.ts).
  'signatureStamp',
  'signatureInk',
  // Form fields (M6-14): @embedpdf/plugin-form's tools, wrapped by forms/fieldTools.ts.
  'formTextField',
  'formCheckbox',
  'formRadioButton',
  'formListbox',
  'formCombobox',
] as const;

/** A drawing tool; the id is also the plugin's tool id and interaction mode. */
export type DrawTool = (typeof DRAW_TOOLS)[number];

export const isDrawTool = (t: string): t is DrawTool =>
  (DRAW_TOOLS as readonly string[]).includes(t);

/** The text comment tools (M7-02): their comment is edited in place right after it is made. */
export const TEXT_TOOLS: ReadonlySet<DrawTool> = new Set([
  'freeText',
  'typewriter',
  'freeTextCallout',
]);

export const isTextTool = (t: string): boolean => TEXT_TOOLS.has(t as DrawTool);

/**
 * The plugin category the text comment tools add (M7-02): while one of them is
 * on, text comments stay selectable, so the new one is selected and edited.
 */
export const TEXT_COMMENT_CATEGORY = 'textComment';

/** Comment tab command → plugin tool. */
export const DRAW_COMMANDS: Record<string, DrawTool> = {
  'comment.stickyNote': 'textComment',
  'comment.typewriter': 'typewriter',
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
  'comment.highlightArea': 'highlightArea',
  'comment.link': 'link',
};

/** Tools that can also place their annotation from the keyboard (M3-Q6): Enter on the page. */
export const KEYBOARD_PLACED: ReadonlySet<DrawTool> = new Set([
  'textComment',
  'freeText',
  'typewriter',
  'dynamicStamp',
  'imageStamp',
  'signatureStamp',
  'signatureInk',
  'formTextField',
  'formCheckbox',
  'formRadioButton',
  'formListbox',
  'formCombobox',
]);

/** Tools whose drawing is a chain of clicks, finished by Enter or double-click. */
export const VERTEX_TOOLS: ReadonlySet<DrawTool> = new Set([
  'polyline',
  'polygon',
  'cloud',
  'measurePerimeter',
  'measureArea',
]);

/** Shift keeps lines at multiples of 45° … */
const ANGLED: ReadonlySet<DrawTool> = new Set([
  'line',
  'lineArrow',
  'polyline',
  'polygon',
  'cloud',
  'measureDistance',
  'measurePerimeter',
  'measureArea',
]);
/** … and boxes square. */
const BOXED: ReadonlySet<DrawTool> = new Set(['square', 'highlightArea', 'circle', 'link']);

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

/** A callout's text box when one drag places it (the plugin's click-placed size, page points). */
export const CALLOUT_BOX = { width: 150, height: 40 } as const;
/** The callout's knee: this far (page points) before the box, at most half the way back. */
export const CALLOUT_KNEE = 18;

export interface CalloutPlacement {
  knee: Pt;
  box: { origin: Pt; size: { width: number; height: number } };
}

/**
 * A callout drawn with one drag (M7-03, ADR-023 D-43 f; the PDF-XChange
 * gesture): the arrow tip where the drag started, the text box beside where it
 * ended (on the far side from the tip, its middle at the pointer's height),
 * kept on the page, and the knee placed automatically a short way before the
 * box, level with its middle.
 */
export function calloutFromDrag(
  tip: Pt,
  end: Pt,
  page: { width: number; height: number },
  size: { width: number; height: number } = CALLOUT_BOX,
): CalloutPlacement {
  const right = end.x >= tip.x;
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), Math.max(max, 0));
  const origin = {
    x: clamp(right ? end.x : end.x - size.width, page.width - size.width),
    y: clamp(end.y - size.height / 2, page.height - size.height),
  };
  // The box's side that faces the tip, at its middle: where the line meets it.
  const join = { x: right ? origin.x : origin.x + size.width, y: origin.y + size.height / 2 };
  const back = Math.min(CALLOUT_KNEE, Math.abs(join.x - tip.x) / 2);
  return {
    knee: { x: right ? join.x - back : join.x + back, y: join.y },
    box: { origin, size: { ...size } },
  };
}

/** The rect around a callout's tip, knee and box, `pad` wider all round (its drag preview). */
export function calloutBounds(
  tip: Pt,
  p: CalloutPlacement,
  pad: number,
): { origin: Pt; size: { width: number; height: number } } {
  const { origin, size } = p.box;
  const xs = [tip.x, p.knee.x, origin.x, origin.x + size.width];
  const ys = [tip.y, p.knee.y, origin.y, origin.y + size.height];
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return {
    origin: { x, y },
    size: { width: Math.max(...xs) + pad - x, height: Math.max(...ys) + pad - y },
  };
}

/**
 * Where a callout's line meets its box: the middle of the side facing the
 * knee (the annotation plugin's rule, so a preview matches what it makes).
 */
export function calloutJoin({ knee, box }: CalloutPlacement): Pt {
  const cx = box.origin.x + box.size.width / 2;
  const cy = box.origin.y + box.size.height / 2;
  const dx = knee.x - cx;
  const dy = knee.y - cy;
  if (Math.abs(dx) >= Math.abs(dy))
    return { x: dx > 0 ? box.origin.x + box.size.width : box.origin.x, y: cy };
  return { x: cx, y: dy > 0 ? box.origin.y + box.size.height : box.origin.y };
}
