// Display names of annotation types (M3-05; the comments pane reuses them, M3-11;
// the CRS template's comment-type ticks use the ids, M13-07).
import { PdfAnnotationSubtype, type PdfAnnotationObject } from '@embedpdf/models';
import { msg, type MessageKey } from '../../i18n';
import { measureKind } from '../../model/measurement';
import type { CrsType } from '../../model/crs/template';

/** Every type id's display name (`annotate.type.<id>`). */
export const TYPE_KEYS: Record<CrsType, MessageKey> = {
  note: msg('annotate.type.note'),
  freeText: msg('annotate.type.freeText'),
  line: msg('annotate.type.line'),
  rectangle: msg('annotate.type.rectangle'),
  oval: msg('annotate.type.oval'),
  polygon: msg('annotate.type.polygon'),
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

export function annotationTypeKey(a: PdfAnnotationObject): MessageKey {
  return TYPE_KEYS[annotationTypeId(a)];
}
