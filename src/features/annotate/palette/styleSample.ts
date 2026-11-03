// A style as the property grid reads it (M6-17): the Comment Styles Palette
// window edits a tool's Current Style and its Custom Styles with the same
// rows as the Properties pane (M6-06), which read annotation objects. A
// style is a partial property set applied over the tool's current style, so
// its sample is the tool's base defaults, then the current style, then the
// style's own properties: exactly what Set Current would give. Works with no
// document open (the styles live on the device, not in a PDF).
import {
  PdfAnnotationLineEnding as LE,
  PdfAnnotationSubtype as S,
  PdfStandardFont,
  type PdfAnnotationObject,
} from '@embedpdf/models';
import {
  has,
  patchFor,
  readProps,
  TOOL_PROPS,
  type Plain,
  type Prop,
  type Value,
} from '../properties/model';
import { annotationCapability } from '../selection';
import { cleanProps, type StyleProps, type StyleTool } from '../tools/toolDefaults';
import { defaultsFor } from '../tools/toolDefaultsStore';

const TEXT = {
  type: S.FREETEXT,
  fontFamily: PdfStandardFont.Helvetica,
  textAlign: 0,
  verticalAlign: 0,
};

/** Each tool's annotation when the plugin is not running (no document open). */
const FALLBACK: Readonly<Record<StyleTool, Record<string, unknown>>> = {
  freeText: TEXT,
  typewriter: { ...TEXT, intent: 'FreeTextTypeWriter' },
  freeTextCallout: { ...TEXT, intent: 'FreeTextCallout' },
  line: { type: S.LINE, lineEndings: { start: LE.None, end: LE.None } },
  lineArrow: { type: S.LINE, lineEndings: { start: LE.None, end: LE.OpenArrow } },
  polyline: { type: S.POLYLINE, lineEndings: { start: LE.None, end: LE.None } },
  polygon: { type: S.POLYGON },
  square: { type: S.SQUARE },
  circle: { type: S.CIRCLE },
  cloud: { type: S.POLYGON, cloudyBorderIntensity: 2 },
  ink: { type: S.INK },
  highlight: { type: S.HIGHLIGHT },
  underline: { type: S.UNDERLINE },
  strikeout: { type: S.STRIKEOUT },
  squiggly: { type: S.SQUIGGLY },
  highlightArea: { type: S.SQUARE },
  inkHighlighter: { type: S.INK, intent: 'InkHighlight' },
  textComment: { type: S.TEXT },
};

/** `props` over the tool's current style, as an annotation object (no placement). */
export function styleSample(tool: StyleTool, props: StyleProps): PdfAnnotationObject {
  let base: Record<string, unknown> | undefined;
  try {
    base = annotationCapability()?.getTool(tool)?.defaults;
  } catch {
    base = undefined;
  }
  return {
    ...(base && typeof base['type'] === 'number' ? base : FALLBACK[tool]),
    ...defaultsFor(tool),
    ...props,
    id: `style:${tool}`,
    pageIndex: 0,
    rect: { origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } },
  } as unknown as PdfAnnotationObject;
}

/** The grid's rows and values for `props` of `tool` (only the rows the tool has). */
export function styleRows(tool: StyleTool, props: StyleProps): Partial<Record<Prop, Value>> {
  const sample = styleSample(tool, props);
  const shown = new Set(TOOL_PROPS.filter((p) => has(sample, p)));
  return Object.fromEntries(
    Object.entries(readProps([sample])).filter(([p]) => shown.has(p as Prop)),
  );
}

/**
 * `props` with grid row `p` set to `v` (the same patch the Properties pane
 * makes), or null when the tool has no such row.
 */
export function editedStyle(
  tool: StyleTool,
  props: StyleProps,
  p: Prop,
  v: Plain,
): StyleProps | null {
  const sample = styleSample(tool, props);
  const patch = patchFor(sample, p, v) as Record<string, unknown> | null;
  if (!patch) return null;
  // Ink keeps /C in both fields (EmbedPDF's `color` is a deprecated alias, M6-03).
  if (sample.type === S.INK && typeof patch['strokeColor'] === 'string')
    patch['color'] = patch['strokeColor'];
  return cleanProps({ ...props, ...patch });
}
