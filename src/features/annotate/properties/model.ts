// The Properties pane's model (M3-10, M6-06, §7.1): which properties an
// annotation type has, what a selection shows (shared properties, mixed
// values), the patch a change makes on each annotation, the annotation flags
// (Read only, Printable, Locked; ADR-021 D-38 f) and Copy/Apply Style. Pure:
// the plugin applies the patches and PDFium regenerates appearances (B7).
import {
  PdfAnnotationBorderStyle,
  PdfAnnotationSubtype as S,
  PdfStandardFont as F,
  type PdfAnnotationFlagName,
  type PdfAnnotationLineEnding,
  type PdfAnnotationObject,
} from '@embedpdf/models';

/** In grid order: Style, then Text, then the General texts. */
export const PROPS = [
  'fill',
  'stroke',
  'style',
  'width',
  'opacity',
  'blendMode',
  'rotation',
  'lineStart',
  'lineEnd',
  'fontFamily',
  'bold',
  'italic',
  'fontSize',
  'fontColor',
  'textAlign',
  'verticalAlign',
  'subject',
  'contents',
] as const;
export type Prop = (typeof PROPS)[number];

/** The grid's sections (M6-06): General, Style, Text. */
export const SECTION_PROPS = {
  general: ['subject', 'contents'],
  style: [
    'fill',
    'stroke',
    'style',
    'width',
    'opacity',
    'blendMode',
    'rotation',
    'lineStart',
    'lineEnd',
  ],
  text: ['fontFamily', 'bold', 'italic', 'fontSize', 'fontColor', 'textAlign', 'verticalAlign'],
} as const satisfies Record<string, readonly Prop[]>;

export type LineStyle = 'solid' | 'dashed' | 'cloudy';
export type FontFamily = 'helvetica' | 'times' | 'courier';
export const FONT_FAMILIES: readonly FontFamily[] = ['helvetica', 'times', 'courier'];

/** A property whose value differs across the selection. */
export const MIXED = Symbol('mixed');
export type Plain = string | number | boolean;
export type Value = Plain | typeof MIXED;

const TEXT_MARKUP = [S.HIGHLIGHT, S.UNDERLINE, S.STRIKEOUT, S.SQUIGGLY];
const SHAPES = [S.SQUARE, S.CIRCLE, S.POLYGON];
const LINES = [S.LINE, S.POLYLINE];
const MARKUPS = [...SHAPES, ...LINES, ...TEXT_MARKUP, S.INK, S.CARET, S.TEXT, S.FREETEXT, S.STAMP];
/** Attach File (M6-10): its paperclip's colour and its description (contents). */
const ATTACHMENT = [S.FILEATTACHMENT];

const TYPES: Record<Prop, ReadonlySet<S>> = {
  stroke: new Set([...SHAPES, ...LINES, ...TEXT_MARKUP, S.INK, S.CARET, S.TEXT, ...ATTACHMENT]),
  fill: new Set([...SHAPES, ...LINES, S.FREETEXT]),
  opacity: new Set(MARKUPS),
  // Written into the regenerated appearance (/ExtGState /BM); not for icons and images.
  blendMode: new Set([...SHAPES, ...LINES, ...TEXT_MARKUP, S.INK, S.FREETEXT]),
  // The types EmbedPDF turns (its rotate handle): never callouts (see `has`).
  rotation: new Set([...SHAPES, ...LINES, S.INK, S.FREETEXT, S.STAMP]),
  width: new Set([...SHAPES, ...LINES, S.INK]),
  style: new Set([...SHAPES, ...LINES]),
  lineStart: new Set(LINES),
  lineEnd: new Set(LINES),
  fontFamily: new Set([S.FREETEXT]),
  bold: new Set([S.FREETEXT]),
  italic: new Set([S.FREETEXT]),
  fontSize: new Set([S.FREETEXT]),
  fontColor: new Set([S.FREETEXT]),
  textAlign: new Set([S.FREETEXT]),
  verticalAlign: new Set([S.FREETEXT]),
  subject: new Set([...MARKUPS, ...ATTACHMENT]),
  contents: new Set([...MARKUPS, ...ATTACHMENT]),
};

type Loose = Record<string, unknown>;

const isCallout = (a: PdfAnnotationObject): boolean => {
  const o = a as unknown as Loose;
  return (
    a.type === S.FREETEXT &&
    (o['intent'] === 'FreeTextCallout' ||
      (Array.isArray(o['calloutLine']) && o['calloutLine'].length > 0))
  );
};

/** Whether `a` has property `p`. */
export const has = (a: PdfAnnotationObject, p: Prop): boolean =>
  TYPES[p].has(a.type) && !(p === 'rotation' && isCallout(a));

/** Properties that are style (Copy/Apply Style, tool defaults), not content or placement. */
const STYLE: readonly Prop[] = PROPS.filter(
  (p) => p !== 'subject' && p !== 'contents' && p !== 'rotation',
);

/** Cloudy borders exist on rectangles, ovals and polygons (/BE). */
export const canBeCloudy = (a: PdfAnnotationObject): boolean => SHAPES.includes(a.type);

export const propsOf = (a: PdfAnnotationObject): Prop[] => PROPS.filter((p) => has(a, p));

// ------------------------------------------------------------ fonts

/** The standard 14 fonts by family: [regular, bold, italic, bold italic]. */
const FONTS: Record<FontFamily, readonly [F, F, F, F]> = {
  helvetica: [F.Helvetica, F.Helvetica_Bold, F.Helvetica_Oblique, F.Helvetica_BoldOblique],
  times: [F.Times_Roman, F.Times_Bold, F.Times_Italic, F.Times_BoldItalic],
  courier: [F.Courier, F.Courier_Bold, F.Courier_Oblique, F.Courier_BoldOblique],
};

export interface FontParts {
  family: FontFamily;
  bold: boolean;
  italic: boolean;
}

/** A standard font as family, bold and italic (unknown fonts are Helvetica, as PDFium draws them). */
export function fontParts(font: number | undefined): FontParts {
  for (const family of FONT_FAMILIES) {
    const i = FONTS[family].indexOf(font as F);
    if (i >= 0) return { family, bold: (i & 1) === 1, italic: (i & 2) === 2 };
  }
  return { family: 'helvetica', bold: false, italic: false };
}

export const fontOf = ({ family, bold, italic }: FontParts): F =>
  FONTS[family][(bold ? 1 : 0) + (italic ? 2 : 0)] ?? F.Helvetica;

// ------------------------------------------------------------ values

/** One property's value on one annotation (undefined when it has none). */
function valueOf(a: PdfAnnotationObject, p: Prop): Plain | undefined {
  const o = a as unknown as Loose;
  const str = (k: string) => (typeof o[k] === 'string' ? o[k] : undefined);
  const num = (k: string) => (typeof o[k] === 'number' ? o[k] : undefined);
  const endings = o['lineEndings'] as { start?: number; end?: number } | undefined;
  switch (p) {
    case 'stroke':
      return str('strokeColor') ?? str('color');
    case 'fill':
      return str('color') ?? str('backgroundColor') ?? 'transparent';
    case 'opacity':
      return num('opacity') ?? 1;
    case 'blendMode':
      return num('blendMode') ?? 0;
    case 'rotation':
      return num('rotation') ?? 0;
    case 'width':
      return num('strokeWidth');
    case 'style':
      if ((num('cloudyBorderIntensity') ?? 0) > 0) return 'cloudy';
      return num('strokeStyle') === PdfAnnotationBorderStyle.DASHED ? 'dashed' : 'solid';
    case 'lineStart':
      return endings?.start ?? 0;
    case 'lineEnd':
      return endings?.end ?? 0;
    case 'fontFamily':
      return fontParts(num('fontFamily')).family;
    case 'bold':
      return fontParts(num('fontFamily')).bold;
    case 'italic':
      return fontParts(num('fontFamily')).italic;
    case 'fontSize':
      return num('fontSize');
    case 'fontColor':
      return str('fontColor');
    case 'textAlign':
      return num('textAlign') ?? 0;
    case 'verticalAlign':
      return num('verticalAlign') ?? 0;
    case 'subject':
      return str('subject') ?? '';
    case 'contents':
      return str('contents') ?? '';
  }
}

/** The properties every selected annotation has, each with its value or MIXED. */
export function readProps(sel: readonly PdfAnnotationObject[]): Partial<Record<Prop, Value>> {
  const first = sel[0];
  if (!first) return {};
  const out: Partial<Record<Prop, Value>> = {};
  for (const p of PROPS) {
    if (!sel.every((a) => has(a, p))) continue;
    const v = valueOf(first, p);
    out[p] = sel.every((a) => valueOf(a, p) === v) ? (v ?? MIXED) : MIXED;
  }
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function styleValue(a: PdfAnnotationObject, s: LineStyle): Loose {
  const cloud = canBeCloudy(a) ? { cloudyBorderIntensity: s === 'cloudy' ? 2 : 0 } : {};
  if (s === 'dashed')
    return { strokeStyle: PdfAnnotationBorderStyle.DASHED, strokeDashArray: [3, 3], ...cloud };
  if (s === 'cloudy' && !canBeCloudy(a)) return {};
  return { strokeStyle: PdfAnnotationBorderStyle.SOLID, strokeDashArray: [], ...cloud };
}

const isFamily = (v: unknown): v is FontFamily => FONT_FAMILIES.includes(v as FontFamily);

/** The patch setting `p` to `v` on `a`, or null when `a` has no such property. */
export function patchFor(
  a: PdfAnnotationObject,
  p: Prop,
  v: Plain,
): Partial<PdfAnnotationObject> | null {
  if (!has(a, p)) return null;
  const o = a as unknown as Loose;
  const endings = o['lineEndings'] as
    { start: PdfAnnotationLineEnding; end: PdfAnnotationLineEnding } | undefined;
  const ends = { start: endings?.start ?? 0, end: endings?.end ?? 0 };
  const font = fontParts(typeof o['fontFamily'] === 'number' ? o['fontFamily'] : undefined);
  let out: Loose;
  switch (p) {
    case 'stroke':
      // Text markups keep /C in both fields (EmbedPDF's `color` is a deprecated alias).
      out = TEXT_MARKUP.includes(a.type) ? { strokeColor: v, color: v } : { strokeColor: v };
      break;
    case 'fill':
      out = { color: v };
      break;
    case 'opacity':
      out = { opacity: clamp(Number(v), 0, 1) };
      break;
    case 'blendMode':
      out = { blendMode: clamp(Math.round(Number(v)), 0, 15) };
      break;
    case 'rotation':
      out = { rotation: ((Math.round(Number(v)) % 360) + 360) % 360 };
      break;
    case 'width':
      out = { strokeWidth: clamp(Number(v), 0, 72) };
      break;
    case 'style':
      out = styleValue(a, v as LineStyle);
      break;
    case 'lineStart':
      out = { lineEndings: { ...ends, start: Number(v) } };
      break;
    case 'lineEnd':
      out = { lineEndings: { ...ends, end: Number(v) } };
      break;
    case 'fontFamily':
      if (!isFamily(v)) return null;
      out = { fontFamily: fontOf({ ...font, family: v }) };
      break;
    case 'bold':
      out = { fontFamily: fontOf({ ...font, bold: v === true }) };
      break;
    case 'italic':
      out = { fontFamily: fontOf({ ...font, italic: v === true }) };
      break;
    case 'fontSize':
      out = { fontSize: clamp(Number(v), 4, 144) };
      break;
    case 'fontColor':
      out = { fontColor: v };
      break;
    case 'textAlign':
      out = { textAlign: clamp(Math.round(Number(v)), 0, 2) };
      break;
    case 'verticalAlign':
      out = { verticalAlign: clamp(Math.round(Number(v)), 0, 2) };
      break;
    case 'subject':
      out = { subject: v };
      break;
    case 'contents':
      out = { contents: v };
      break;
  }
  return out;
}

// ------------------------------------------------------------ flags (D-38 f)

/** The /F flags the grid and the comment menu set. */
export type Flag = 'readOnly' | 'print' | 'locked';

export const hasFlag = (a: Pick<PdfAnnotationObject, 'flags'>, f: PdfAnnotationFlagName): boolean =>
  a.flags?.includes(f) ?? false;

/** True, false, or MIXED when the selection disagrees. */
export function readFlag(sel: readonly PdfAnnotationObject[], f: Flag): boolean | typeof MIXED {
  const first = sel[0];
  if (!first) return false;
  const v = hasFlag(first, f);
  return sel.every((a) => hasFlag(a, f) === v) ? v : MIXED;
}

/** The patch turning flag `f` on or off on `a`, the other flags kept. */
export function flagPatch(
  a: PdfAnnotationObject,
  f: Flag,
  on: boolean,
): { flags: PdfAnnotationFlagName[] } {
  const rest = (a.flags ?? []).filter((x) => x !== f);
  return { flags: on ? [...rest, f] : rest };
}

/** Locked or Read only: not moved, resized, deleted or restyled in the app (PDF 32000-1 §12.5.3). */
export const isFixed = (a: Pick<PdfAnnotationObject, 'flags'>): boolean =>
  hasFlag(a, 'locked') || hasFlag(a, 'readOnly');

/**
 * What the grid lets a selection change: a Read only or Locked comment only
 * its Read only and Locked flags and the review mark (the note says which).
 */
export type Gate = 'open' | 'locked' | 'readOnly';

export function gateOf(sel: readonly PdfAnnotationObject[]): Gate {
  if (sel.some((a) => hasFlag(a, 'readOnly'))) return 'readOnly';
  if (sel.some((a) => hasFlag(a, 'locked'))) return 'locked';
  return 'open';
}

// ------------------------------------------------------------ styles

export type Style = Partial<Record<Prop, Plain>>;

/** Copy Style: the style properties of an annotation. */
export function styleOf(a: PdfAnnotationObject): Style {
  const out: Style = {};
  for (const p of STYLE) {
    if (!has(a, p)) continue;
    const v = valueOf(a, p);
    if (v !== undefined) out[p] = v;
  }
  return out;
}

/** Apply Style: the patch for the style properties `target` shares with `style`. */
export function applyStyle(
  style: Style,
  target: PdfAnnotationObject,
): Partial<PdfAnnotationObject> {
  let out: Partial<PdfAnnotationObject> = {};
  for (const p of STYLE) {
    const v = style[p];
    if (v === undefined) continue;
    const patch = patchFor({ ...target, ...out } as PdfAnnotationObject, p, v);
    if (patch) out = { ...out, ...patch };
  }
  return out;
}

/** Tool Properties (M6-06): properties a tool's defaults may hold (no placement, no text). */
export const TOOL_PROPS: readonly Prop[] = STYLE.filter((p) => p !== 'blendMode');

/** The tool-default fields of an annotation ("Make current properties default"). */
export function toolStyleOf(a: PdfAnnotationObject): Record<string, unknown> {
  let out: Record<string, unknown> = {};
  for (const p of TOOL_PROPS) {
    if (!has(a, p)) continue;
    const v = valueOf(a, p);
    if (v === undefined) continue;
    const patch = patchFor({ ...a, ...out }, p, v);
    if (patch) out = { ...out, ...patch };
  }
  // The pencil's color is also its deprecated `color` alias (M6-03).
  if (a.type === S.INK && typeof out['strokeColor'] === 'string') out['color'] = out['strokeColor'];
  return out;
}
