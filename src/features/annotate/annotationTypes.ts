// Display names of annotation types (M3-05; the comments pane reuses them, M3-11).
import { PdfAnnotationSubtype, type PdfAnnotationObject } from '@embedpdf/models';
import { msg, type MessageKey } from '../../i18n';
import { measureKind, type MeasureKind } from '../../model/measurement';

const MEASURE: Record<MeasureKind, MessageKey> = {
  distance: msg('annotate.type.distance'),
  perimeter: msg('annotate.type.perimeter'),
  area: msg('annotate.type.area'),
};

const TYPE: Partial<Record<PdfAnnotationSubtype, MessageKey>> = {
  [PdfAnnotationSubtype.TEXT]: msg('annotate.type.note'),
  [PdfAnnotationSubtype.FREETEXT]: msg('annotate.type.freeText'),
  [PdfAnnotationSubtype.LINE]: msg('annotate.type.line'),
  [PdfAnnotationSubtype.SQUARE]: msg('annotate.type.rectangle'),
  [PdfAnnotationSubtype.CIRCLE]: msg('annotate.type.oval'),
  [PdfAnnotationSubtype.POLYGON]: msg('annotate.type.polygon'),
  [PdfAnnotationSubtype.POLYLINE]: msg('annotate.type.polyline'),
  [PdfAnnotationSubtype.HIGHLIGHT]: msg('annotate.type.highlight'),
  [PdfAnnotationSubtype.UNDERLINE]: msg('annotate.type.underline'),
  [PdfAnnotationSubtype.SQUIGGLY]: msg('annotate.type.squiggly'),
  [PdfAnnotationSubtype.STRIKEOUT]: msg('annotate.type.strikeout'),
  [PdfAnnotationSubtype.STAMP]: msg('annotate.type.stamp'),
  [PdfAnnotationSubtype.CARET]: msg('annotate.type.caret'),
  [PdfAnnotationSubtype.INK]: msg('annotate.type.ink'),
};

export function annotationTypeKey(a: PdfAnnotationObject): MessageKey {
  const k = measureKind(a);
  if (k) return MEASURE[k];
  return TYPE[a.type] ?? msg('annotate.type.other');
}
