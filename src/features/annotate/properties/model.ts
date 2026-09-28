// The Properties pane's model (M3-10, §7.1): which properties an annotation
// type has, what a selection shows (shared properties, mixed values), the
// patch a change makes on each annotation, and Copy/Apply Style. Pure: the
// plugin applies the patches and PDFium regenerates appearances (B7).
import {
  PdfAnnotationBorderStyle,
  PdfAnnotationSubtype as S,
  type PdfAnnotationLineEnding,
  type PdfAnnotationObject,
} from '@embedpdf/models';

export const PROPS = [
  'stroke',
  'fill',
  'opacity',
  'width',
  'style',
  'lineStart',
  'lineEnd',
  'fontSize',
  'fontColor',
  'subject',
  'contents',
] as const;
export type Prop = (typeof PROPS)[number];

export type LineStyle = 'solid' | 'dashed' | 'cloudy';

/** A property whose value differs across the selection. */
export const MIXED = Symbol('mixed');
export type Value = string | number | typeof MIXED;

const TEXT_MARKUP = [S.HIGHLIGHT, S.UNDERLINE, S.STRIKEOUT, S.SQUIGGLY];
const SHAPES = [S.SQUARE, S.CIRCLE, S.POLYGON];
const LINES = [S.LINE, S.POLYLINE];
const MARKUPS = [...SHAPES, ...LINES, ...TEXT_MARKUP, S.INK, S.CARET, S.TEXT, S.FREETEXT, S.STAMP];

const TYPES: Record<Prop, ReadonlySet<S>> = {
  stroke: new Set([...SHAPES, ...LINES, ...TEXT_MARKUP, S.INK, S.CARET, S.TEXT]),
  fill: new Set([...SHAPES, ...LINES, S.FREETEXT]),
  opacity: new Set(MARKUPS),
  width: new Set([...SHAPES, ...LINES, S.INK]),
  style: new Set([...SHAPES, ...LINES]),
  lineStart: new Set(LINES),
  lineEnd: new Set(LINES),
  fontSize: new Set([S.FREETEXT]),
  fontColor: new Set([S.FREETEXT]),
  subject: new Set(MARKUPS),
  contents: new Set(MARKUPS),
};

/** Properties that are style (Copy/Apply Style), not content. */
const STYLE: readonly Prop[] = PROPS.filter((p) => p !== 'subject' && p !== 'contents');

/** Cloudy borders exist on rectangles, ovals and polygons (/BE). */
export const canBeCloudy = (a: PdfAnnotationObject): boolean => SHAPES.includes(a.type);

export const propsOf = (a: PdfAnnotationObject): Prop[] =>
  PROPS.filter((p) => TYPES[p].has(a.type));

type Loose = Record<string, unknown>;

/** One property's value on one annotation (undefined when it has none). */
function valueOf(a: PdfAnnotationObject, p: Prop): string | number | undefined {
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
    case 'width':
      return num('strokeWidth');
    case 'style':
      if ((num('cloudyBorderIntensity') ?? 0) > 0) return 'cloudy';
      return num('strokeStyle') === PdfAnnotationBorderStyle.DASHED ? 'dashed' : 'solid';
    case 'lineStart':
      return endings?.start ?? 0;
    case 'lineEnd':
      return endings?.end ?? 0;
    case 'fontSize':
      return num('fontSize');
    case 'fontColor':
      return str('fontColor');
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
    if (!sel.every((a) => TYPES[p].has(a.type))) continue;
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

/** The patch setting `p` to `v` on `a`, or null when `a` has no such property. */
export function patchFor(
  a: PdfAnnotationObject,
  p: Prop,
  v: string | number,
): Partial<PdfAnnotationObject> | null {
  if (!TYPES[p].has(a.type)) return null;
  const endings = (a as unknown as Loose)['lineEndings'] as
    { start: PdfAnnotationLineEnding; end: PdfAnnotationLineEnding } | undefined;
  const ends = { start: endings?.start ?? 0, end: endings?.end ?? 0 };
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
    case 'fontSize':
      out = { fontSize: clamp(Number(v), 4, 144) };
      break;
    case 'fontColor':
      out = { fontColor: v };
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

export type Style = Partial<Record<Prop, string | number>>;

/** Copy Style: the style properties of an annotation. */
export function styleOf(a: PdfAnnotationObject): Style {
  const out: Style = {};
  for (const p of STYLE) {
    if (!TYPES[p].has(a.type)) continue;
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
    const patch = patchFor(target, p, v);
    if (patch) out = { ...out, ...patch };
  }
  return out;
}
