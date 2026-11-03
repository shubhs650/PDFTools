// Per-tool default styles (M6-03, ADR-021 D-37, beta review B6): what a new
// comment of each tool looks like. The shipped defaults are red (#FF0000)
// text at 10 pt and red 1 pt lines and borders, no fill; highlight and the
// sticky note stay yellow (owner, 2026-11-01; the highlight joined the styled
// tools in M6-07 for its style palette, still yellow) and the measurement tools keep
// their own style (measureTools.ts). The user's own defaults are stored as
// overrides of the shipped ones (toolDefaultsStore.ts), so a later change
// to a shipped default reaches everyone who has not set that property.
// Pure: no store, no plugin.

/** Tools with a default style; the ids are the plugin's tool ids. */
export const STYLE_TOOLS = [
  'freeText',
  'typewriter',
  'freeTextCallout',
  'line',
  'lineArrow',
  'polyline',
  'polygon',
  'square',
  'circle',
  'cloud',
  'ink',
  // A text markup, not a drawing tool (markupModel.ts reads its style, M6-07).
  'highlight',
  // M6-17: the rest of the Text Markups and Notes groups of the Comment Styles
  // Palette. Their shipped defaults are what they drew before, so nothing
  // looks different until the user sets a style.
  'underline',
  'strikeout',
  'squiggly',
  'highlightArea',
  'inkHighlighter',
  'textComment',
] as const;

export type StyleTool = (typeof STYLE_TOOLS)[number];

export const isStyleTool = (t: string): t is StyleTool =>
  (STYLE_TOOLS as readonly string[]).includes(t);

/** The style properties a default may set (the plugin's annotation fields). */
export interface StyleProps {
  /** Line / border color; for text boxes and callouts also the /DA color. */
  strokeColor?: string;
  /** Fill (interior) color, or 'transparent'. */
  color?: string;
  fontColor?: string;
  /** Points. */
  fontSize?: number;
  /** Line / border width in points. */
  strokeWidth?: number;
  /** 0 … 1. */
  opacity?: number;
  /** Border style (M6-06): PdfAnnotationBorderStyle (1 solid, 2 dashed) and its dashes. */
  strokeStyle?: number;
  strokeDashArray?: number[];
  /** Cloudy border (/BE /I) for rectangles, ovals and polygons; 0 is none. */
  cloudyBorderIntensity?: number;
  /** Line endings (PdfAnnotationLineEnding) of lines and polylines. */
  lineEndings?: { start: number; end: number };
  /** One of the standard 12 text fonts (PdfStandardFont 0 … 11). */
  fontFamily?: number;
  /** 0 left, 1 centre, 2 right. */
  textAlign?: number;
  /** 0 top, 1 middle, 2 bottom. */
  verticalAlign?: number;
}

export const DEFAULT_RED = '#FF0000';
export const DEFAULT_FONT_SIZE = 10;
export const DEFAULT_LINE_WIDTH = 1;
export const HIGHLIGHT_YELLOW = '#FFE14D';
/** The plugin's sticky note and free highlight yellow (EmbedPDF 2.15.1 tool defaults). */
export const NOTE_YELLOW = '#FFCD45';

const TEXT: StyleProps = {
  fontColor: DEFAULT_RED,
  fontSize: DEFAULT_FONT_SIZE,
  strokeColor: DEFAULT_RED,
  strokeWidth: DEFAULT_LINE_WIDTH,
  color: 'transparent',
};

const LINE: StyleProps = {
  strokeColor: DEFAULT_RED,
  strokeWidth: DEFAULT_LINE_WIDTH,
  color: 'transparent',
};

/** The shipped defaults (B6). */
export const SHIPPED_DEFAULTS: Readonly<Record<StyleTool, Readonly<StyleProps>>> = {
  freeText: TEXT,
  // A typewriter is text on the page without a box (/IT /FreeTextTypeWriter).
  typewriter: {
    fontColor: DEFAULT_RED,
    fontSize: DEFAULT_FONT_SIZE,
    strokeWidth: 0,
    color: 'transparent',
  },
  freeTextCallout: TEXT,
  line: LINE,
  lineArrow: LINE,
  polyline: LINE,
  polygon: LINE,
  square: LINE,
  circle: LINE,
  cloud: LINE,
  // The pencil's color is also its deprecated `color` alias in the plugin.
  ink: { strokeColor: DEFAULT_RED, color: DEFAULT_RED, strokeWidth: DEFAULT_LINE_WIDTH },
  // Yellow, as before M6-03 (MARKUP_DEFAULTS); /C is kept in both fields.
  highlight: { strokeColor: HIGHLIGHT_YELLOW, color: HIGHLIGHT_YELLOW, opacity: 1 },
  // M6-17: as markupModel.ts's MARKUP_DEFAULTS drew them.
  underline: { strokeColor: '#1E6FD9', color: '#1E6FD9', opacity: 1 },
  strikeout: { strokeColor: '#D93025', color: '#D93025', opacity: 1 },
  squiggly: { strokeColor: '#1E8E3E', color: '#1E8E3E', opacity: 1 },
  // As drawTools.ts's HIGHLIGHT_AREA_DEFAULTS (its /BM /Multiply stays the tool's own).
  highlightArea: {
    color: HIGHLIGHT_YELLOW,
    strokeColor: HIGHLIGHT_YELLOW,
    strokeWidth: 0,
    opacity: 1,
  },
  // As the plugin's own tools drew them.
  inkHighlighter: { strokeColor: NOTE_YELLOW, color: NOTE_YELLOW, strokeWidth: 14, opacity: 1 },
  textComment: { strokeColor: NOTE_YELLOW, opacity: 1 },
};

/** The stored record's schema version (IndexedDB `toolDefaults`, keyed by tool id). */
export const TOOL_DEFAULTS_VERSION = 1;

export interface StoredToolDefaults {
  v: typeof TOOL_DEFAULTS_VERSION;
  /** Only the properties the user set; the rest follow the shipped defaults. */
  props: StyleProps;
}

const COLOR = /^#[0-9A-Fa-f]{6}$/;
const isColor = (v: unknown, transparent: boolean): v is string =>
  typeof v === 'string' && (COLOR.test(v) || (transparent && v === 'transparent'));
const inRange = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

const isInt = (v: unknown, min: number, max: number): v is number =>
  Number.isInteger(v) && inRange(v, min, max);

/** The well-formed properties of `raw` (anything else is dropped). */
export function cleanProps(raw: unknown): StyleProps {
  if (typeof raw !== 'object' || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const out: StyleProps = {};
  if (isColor(r['strokeColor'], false)) out.strokeColor = r['strokeColor'];
  if (isColor(r['color'], true)) out.color = r['color'];
  if (isColor(r['fontColor'], false)) out.fontColor = r['fontColor'];
  if (inRange(r['fontSize'], 1, 144)) out.fontSize = r['fontSize'];
  if (inRange(r['strokeWidth'], 0, 72)) out.strokeWidth = r['strokeWidth'];
  if (inRange(r['opacity'], 0, 1)) out.opacity = r['opacity'];
  if (isInt(r['strokeStyle'], 0, 6)) out.strokeStyle = r['strokeStyle'];
  const dash = r['strokeDashArray'];
  if (Array.isArray(dash) && dash.length <= 8 && dash.every((d) => inRange(d, 0, 100)))
    out.strokeDashArray = dash;
  if (inRange(r['cloudyBorderIntensity'], 0, 2))
    out.cloudyBorderIntensity = r['cloudyBorderIntensity'];
  const ends: unknown = r['lineEndings'];
  if (typeof ends === 'object' && ends !== null) {
    const { start, end } = ends as { start?: unknown; end?: unknown };
    if (isInt(start, 0, 10) && isInt(end, 0, 10)) out.lineEndings = { start, end };
  }
  if (isInt(r['fontFamily'], 0, 11)) out.fontFamily = r['fontFamily'];
  if (isInt(r['textAlign'], 0, 2)) out.textAlign = r['textAlign'];
  if (isInt(r['verticalAlign'], 0, 2)) out.verticalAlign = r['verticalAlign'];
  return out;
}

/**
 * A stored record brought to the current version, or null when it is damaged
 * or from a newer app (then the shipped defaults apply). Before M6-03 nothing
 * was stored, so every existing user starts on the new shipped defaults.
 */
export function migrateStored(raw: unknown): StoredToolDefaults | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as { v?: unknown; props?: unknown };
  if (r.v !== TOOL_DEFAULTS_VERSION) return null;
  const props = cleanProps(r.props);
  return Object.keys(props).length > 0 ? { v: TOOL_DEFAULTS_VERSION, props } : null;
}

export type Overrides = Partial<Record<StyleTool, StyleProps>>;

/** What a new comment of `tool` gets: the shipped defaults, then the user's. */
export function effectiveDefaults(tool: StyleTool, overrides: Overrides = {}): StyleProps {
  return { ...SHIPPED_DEFAULTS[tool], ...overrides[tool] };
}

/**
 * The patch that turns a tool whose defaults were last set to `before` into
 * `after`: keys that are gone are cleared (the plugin merges patches).
 */
export function defaultsPatch(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = { ...after };
  for (const k of Object.keys(before)) if (!(k in after)) patch[k] = undefined;
  return patch;
}
