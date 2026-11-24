// Arrow heads on level and upright lines (M13-04). PDFium's appearance for a
// line's or polyline's endings turns each head with `cm`, and writes a turn of
// exactly 90°, 180° or 270° with numbers like "8.74228e-08". PDF numbers have
// no exponent, so PDFium (and other viewers) cannot read that `cm` and the head
// vanishes: a Distance drawn left to right, or snapped level, lost its start
// arrow. After EmbedPDF has created or updated such a comment and PDFium has
// made its appearance, those numbers are rewritten as plain decimals
// (model/pdf/plainNumbers.ts) and the appearance is set back the way text
// colours are (freeTextColors.ts). Anything unexpected keeps PDFium's own.
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import { PdfAnnotationLineEnding, PdfAnnotationSubtype } from '@embedpdf/models';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { plainNumbers } from '../../model/pdf/plainNumbers';
import { exportAppearance, setAppearanceContent } from './freeTextColors';
import { acquirePage, rawCall, withWideString } from './pdfium';
import { latin1 } from './save/bytes';

interface LineArg {
  id?: unknown;
  type?: unknown;
  lineEndings?: { start?: unknown; end?: unknown } | undefined;
}

export type EndingOutcome = 'none' | 'unchanged' | 'fixed' | 'fallback';

const NONE: number = PdfAnnotationLineEnding.None;
const drawsEnding = (v: unknown): boolean => typeof v === 'number' && v !== NONE;

export function fixLineEndingAppearance(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  method: string,
  args: readonly unknown[],
): EndingOutcome {
  if (method !== 'createPageAnnotation' && method !== 'updatePageAnnotation') return 'none';
  const annot = args[2] as LineArg | undefined;
  if (annot?.type !== PdfAnnotationSubtype.LINE && annot?.type !== PdfAnnotationSubtype.POLYLINE)
    return 'none';
  if (typeof annot.id !== 'string') return 'none';
  if (!drawsEnding(annot.lineEndings?.start) && !drawsEnding(annot.lineEndings?.end)) return 'none';
  const opts = args[3] as { regenerateAppearance?: unknown } | undefined;
  if (method === 'updatePageAnnotation' && opts?.regenerateAppearance === false) return 'none';
  const docId = (args[0] as { id?: unknown } | undefined)?.id;
  const pageIndex = (args[1] as { index?: unknown } | undefined)?.index;
  if (typeof docId !== 'string' || typeof pageIndex !== 'number') return 'none';
  const ref = acquirePage(native, docId, pageIndex);
  try {
    const a = withWideString(mod, annot.id, (p) =>
      rawCall(mod, 'EPDFPage_GetAnnotByName', ref.pagePtr, p),
    );
    if (!a) return 'none';
    try {
      const exported = exportAppearance(mod, a);
      if (!exported) return 'fallback';
      const r = plainNumbers(latin1(exported.ex.data));
      if (!r.changed) return 'unchanged';
      return setAppearanceContent(mod, a, exported, r.content) ? 'fixed' : 'fallback';
    } finally {
      rawCall(mod, 'FPDFPage_CloseAnnot', a);
    }
  } finally {
    ref.release();
  }
}
