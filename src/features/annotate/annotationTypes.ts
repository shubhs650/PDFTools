// Display names of annotation types (M3-05; the comments pane reuses them, M3-11;
// the CRS template's comment-type ticks use the ids, M13-07, and tell arrows,
// clouds, callouts and typewriter text apart from plain lines, shapes and
// text boxes, as a review sheet names them).
import {
  PdfAnnotationLineEnding as End,
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
} from '@embedpdf/models';
import { msg, type MessageKey } from '../../i18n';
import type { CurveTool } from '../../model/measureCurve';
import { metaOf } from '../../model/measureMarkup';
import { curveKind, measureKind } from '../../model/measurement';
import type { CrsType } from '../../model/crs/template';

/** Every type id's display name (`annotate.type.<id>`). */
export const TYPE_KEYS: Record<CrsType, MessageKey> = {
  note: msg('annotate.type.note'),
  freeText: msg('annotate.type.freeText'),
  callout: msg('annotate.type.callout'),
  typewriter: msg('annotate.type.typewriter'),
  line: msg('annotate.type.line'),
  arrow: msg('annotate.type.arrow'),
  rectangle: msg('annotate.type.rectangle'),
  oval: msg('annotate.type.oval'),
  polygon: msg('annotate.type.polygon'),
  cloud: msg('annotate.type.cloud'),
  polyline: msg('annotate.type.polyline'),
  ink: msg('annotate.type.ink'),
  highlight: msg('annotate.type.highlight'),
  underline: msg('annotate.type.underline'),
  squiggly: msg('annotate.type.squiggly'),
  strikeout: msg('annotate.type.strikeout'),
  caret: msg('annotate.type.caret'),
  stamp: msg('annotate.type.stamp'),
  fileAttachment: msg('annotate.type.fileAttachment'),
  distance: msg('annotate.type.distance'),
  perimeter: msg('annotate.type.perimeter'),
  area: msg('annotate.type.area'),
  other: msg('annotate.type.other'),
};

const TYPE: Partial<Record<PdfAnnotationSubtype, CrsType>> = {
  [PdfAnnotationSubtype.TEXT]: 'note',
  [PdfAnnotationSubtype.FREETEXT]: 'freeText',
  [PdfAnnotationSubtype.LINE]: 'line',
  [PdfAnnotationSubtype.SQUARE]: 'rectangle',
  [PdfAnnotationSubtype.CIRCLE]: 'oval',
  [PdfAnnotationSubtype.POLYGON]: 'polygon',
  [PdfAnnotationSubtype.POLYLINE]: 'polyline',
  [PdfAnnotationSubtype.HIGHLIGHT]: 'highlight',
  [PdfAnnotationSubtype.UNDERLINE]: 'underline',
  [PdfAnnotationSubtype.SQUIGGLY]: 'squiggly',
  [PdfAnnotationSubtype.STRIKEOUT]: 'strikeout',
  [PdfAnnotationSubtype.STAMP]: 'stamp',
  [PdfAnnotationSubtype.CARET]: 'caret',
  [PdfAnnotationSubtype.INK]: 'ink',
  [PdfAnnotationSubtype.FILEATTACHMENT]: 'fileAttachment',
};

/** The type's id: measurements by kind, else by subtype ("other" for the rest). */
export function annotationTypeId(a: PdfAnnotationObject): CrsType {
  return measureKind(a) ?? TYPE[a.type] ?? 'other';
}

/**
 * An Angle, Radius or Diameter (M14-05) is a Stamp in the file and to the CRS
 * template, but is named as the measurement it is.
 */
const CURVE_KEYS: Record<CurveTool, MessageKey> = {
  angle: msg('annotate.type.angle'),
  radius: msg('annotate.type.radius'),
  diameter: msg('annotate.type.diameter'),
};

export function annotationTypeKey(a: PdfAnnotationObject): MessageKey {
  const curve = curveKind(a);
  if (curve) return CURVE_KEYS[curve];
  // A Volume (M14-06) is an Area in the file and to the CRS template, named as what it is.
  if (metaOf(a)?.tool === 'volume') return msg('annotate.type.volume');
  return TYPE_KEYS[annotationTypeId(a)];
}

const ARROW_ENDS: ReadonlySet<End> = new Set([
  End.OpenArrow,
  End.ClosedArrow,
  End.ROpenArrow,
  End.RClosedArrow,
]);

/**
 * The CRS template's finer type (M13-07): a line with an arrowhead is an
 * arrow; a shape with a cloudy border is a cloud; a text box with a leader
 * line is a callout, one without a border a typewriter text.
 */
export function crsTypeId(a: PdfAnnotationObject): CrsType {
  const id = annotationTypeId(a);
  switch (id) {
    case 'line': {
      const e = 'lineEndings' in a ? a.lineEndings : undefined;
      return e && (ARROW_ENDS.has(e.start) || ARROW_ENDS.has(e.end)) ? 'arrow' : 'line';
    }
    case 'polygon':
    case 'rectangle':
    case 'oval':
      return 'cloudyBorderIntensity' in a && (a.cloudyBorderIntensity ?? 0) > 0 ? 'cloud' : id;
    case 'freeText': {
      const intent = a.intent?.replace(/^\//u, '');
      const leader = 'calloutLine' in a ? (a.calloutLine as unknown[] | undefined) : undefined;
      if (intent === 'FreeTextCallout' || (leader?.length ?? 0) > 0) return 'callout';
      return intent === 'FreeTextTypeWriter' ? 'typewriter' : 'freeText';
    }
    default:
      return id;
  }
}
