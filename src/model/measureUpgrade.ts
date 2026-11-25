// Measurements saved by Triya PDF 1.1.0 (M14-03, Q38): a Line, PolyLine or
// Polygon carrying the value, plus a FreeText grouped to it (/IRT, /RT /Group)
// showing the value on the sheet. "Update old measurements" turns each pair
// into one markup with its caption in its own appearance. Pure.
import {
  PdfAnnotationReplyType,
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
} from '@embedpdf/models';

export interface OldPair {
  /** The measurement (Line, PolyLine or Polygon). */
  measure: PdfAnnotationObject;
  /** Its grouped FreeText label. */
  label: PdfAnnotationObject;
}

const SHAPES: readonly PdfAnnotationSubtype[] = [
  PdfAnnotationSubtype.LINE,
  PdfAnnotationSubtype.POLYLINE,
  PdfAnnotationSubtype.POLYGON,
];

/**
 * The 1.1.0 pairs among `annots`: a measurement (by `isMeasurement`, which
 * reads its /Measure or /IT) with no `measure` field of its own, and the
 * FreeText grouped to it. A measurement with several grouped texts keeps the
 * first; a FreeText grouped to anything else is not a pair.
 */
export function oldPairs(
  annots: readonly PdfAnnotationObject[],
  isMeasurement: (a: PdfAnnotationObject) => boolean,
): OldPair[] {
  const byId = new Map(annots.map((a) => [a.id, a]));
  const out: OldPair[] = [];
  const seen = new Set<string>();
  for (const label of annots) {
    if (
      label.type !== PdfAnnotationSubtype.FREETEXT ||
      label.replyType !== PdfAnnotationReplyType.Group ||
      !label.inReplyToId
    )
      continue;
    const m = byId.get(label.inReplyToId);
    if (!m || seen.has(m.id) || !SHAPES.includes(m.type) || m.pageIndex !== label.pageIndex)
      continue;
    if ('measure' in m && (m as { measure?: unknown }).measure) continue;
    if (!isMeasurement(m)) continue;
    seen.add(m.id);
    out.push({ measure: m, label });
  }
  return out;
}
