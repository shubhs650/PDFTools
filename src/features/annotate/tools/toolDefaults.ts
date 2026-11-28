// Per-tool default styles (M6-03, ADR-021 D-37, beta review B6): what a new
// comment of each tool looks like. The shipped defaults are red (#FF0000)
// text at 10 pt and red 1 pt lines and borders, no fill; the typewriter is
// black Courier (M7-07, D-37 amendment); highlight, highlight area and free
// highlight are at 50 % opacity (M7-07); highlight and the
// sticky note stay yellow (owner, 2026-11-01; the highlight joined the styled
// tools in M6-07 for its style palette, still yellow) and the measurement tools keep
// their own style (measureTools.ts). The user's own defaults are stored as
// overrides of the shipped ones (toolDefaultsStore.ts), so a later change
// to a shipped default reaches everyone who has not set that property.
// Pure: no store, no plugin.
import { PdfAnnotationLineEnding, PdfStandardFont } from '@embedpdf/models';
import { libraryFamily } from '../../../model/fonts/library';

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
  // M14-03 (Q31): each measuring tool remembers its own colour, width, ends and fill.
  'measureLength',
  'measurePolylength',
  'measurePerimeter',
  'measureArea',
  // M14-06: Volume, an Area with a depth (same style properties as Area).
  'measureVolume',
  // M14-05: Angle, Radius and Diameter (a Stamp each: colour, width and opacity).
  'measureAngle',
  'measureRadius',
  'measureDiameter',
  // M14-07: Count (a Stamp each; its colour, shape and size come from its count group).
  'measureCount',
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
  /** A font library family id (M11-07, D-52), or '' for the standard font in `fontFamily`. */
  libraryFont?: string;
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
/**
 * Highlight, Highlight Area and Free Highlight (M7-07, D-37 amendment, review
 * 4d): half strength, so the text under them stays readable. Their palette
 * presets use it too (stylePalette.ts).
 */
export const HIGHLIGHT_OPACITY = 0.5;
/** The typewriter's text (M7-07, D-37 amendment, Q4): black, the standard Courier font. */
export const TYPEWRITER_COLOR = '#000000';
export const TYPEWRITER_FONT = PdfStandardFont.Courier;

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

/** The measuring tools' red (M3-16), kept by M14-03 (Q31). */
export const MEASURE_RED = '#E44234';
const OPEN_ARROW: number = PdfAnnotationLineEnding.OpenArrow;
const BUTT: number = PdfAnnotationLineEnding.Butt;

const MEASURE: StyleProps = {
  strokeColor: MEASURE_RED,
  strokeWidth: DEFAULT_LINE_WIDTH,
  color: 'transparent',
  opacity: 1,
};

/** Angle, Radius and Diameter (M14-05). */
const CURVE: StyleProps = { strokeColor: MEASURE_RED, strokeWidth: DEFAULT_LINE_WIDTH, opacity: 1 };

/** The shipped defaults (B6). */
export const SHIPPED_DEFAULTS: Readonly<Record<StyleTool, Readonly<StyleProps>>> = {
  freeText: TEXT,
  // A typewriter is text on the page without a box (/IT /FreeTextTypeWriter),
  // black Courier as on a typewriter (M7-07).
  typewriter: {
    fontColor: TYPEWRITER_COLOR,
    fontFamily: TYPEWRITER_FONT,
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
  highlight: { strokeColor: HIGHLIGHT_YELLOW, color: HIGHLIGHT_YELLOW, opacity: HIGHLIGHT_OPACITY },
  // M6-17: as markupModel.ts's MARKUP_DEFAULTS drew them.
  underline: { strokeColor: '#1E6FD9', color: '#1E6FD9', opacity: 1 },
  strikeout: { strokeColor: '#D93025', color: '#D93025', opacity: 1 },
  squiggly: { strokeColor: '#1E8E3E', color: '#1E8E3E', opacity: 1 },
  // As drawTools.ts's HIGHLIGHT_AREA_DEFAULTS (its /BM /Multiply stays the tool's own).
  highlightArea: {
    color: HIGHLIGHT_YELLOW,
    strokeColor: HIGHLIGHT_YELLOW,
    strokeWidth: 0,
    opacity: HIGHLIGHT_OPACITY,
  },
  // As the plugin's own tool drew it, at half strength since M7-07.
  inkHighlighter: {
    strokeColor: NOTE_YELLOW,
    color: NOTE_YELLOW,
    strokeWidth: 14,
    opacity: HIGHLIGHT_OPACITY,
  },
  textComment: { strokeColor: NOTE_YELLOW, opacity: 1 },
  // M14-03 (Q31): today's red; open arrows on Length, butt ends on the others; a light
  // see-through fill on areas (drawn at FILL_ALPHA in the appearance, never as /IC).
  measureLength: { ...MEASURE, lineEndings: { start: OPEN_ARROW, end: OPEN_ARROW } },
  measurePolylength: { ...MEASURE, lineEndings: { start: BUTT, end: BUTT } },
  measurePerimeter: { ...MEASURE, lineEndings: { start: BUTT, end: BUTT } },
  measureArea: { ...MEASURE, color: MEASURE_RED },
  measureVolume: { ...MEASURE, color: MEASURE_RED },
  // M14-05: a Stamp has no fill or line ends; its appearance is drawn in this colour and width.
  measureAngle: CURVE,
  measureRadius: CURVE,
  measureDiameter: CURVE,
  measureCount: { opacity: 1 },
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
  const lib = r['libraryFont'];
  if (lib === '' || (typeof lib === 'string' && libraryFamily(lib)?.group)) out.libraryFont = lib;
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
