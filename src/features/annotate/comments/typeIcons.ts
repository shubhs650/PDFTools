// The icon of a comment's card (M6-05): the icon of the tool that makes that
// type, so the pane and the ribbon read the same (ADR-010 icons). Pure.
import { PdfAnnotationSubtype as S, type PdfAnnotationObject } from '@embedpdf/models';
import { measureKind } from '../../../model/measurement';

const BY_TYPE: Partial<Record<S, string>> = {
  [S.TEXT]: 'comment.stickyNote',
  [S.FREETEXT]: 'comment.textBox',
  [S.LINE]: 'comment.line',
  [S.SQUARE]: 'comment.rectangle',
  [S.CIRCLE]: 'comment.oval',
  [S.POLYGON]: 'comment.polygon',
  [S.POLYLINE]: 'comment.polyline',
  [S.HIGHLIGHT]: 'comment.highlight',
  [S.UNDERLINE]: 'comment.underline',
  [S.SQUIGGLY]: 'comment.squiggly',
  [S.STRIKEOUT]: 'comment.strikeout',
  [S.STAMP]: 'comment.stamp',
  [S.CARET]: 'comment.insertText',
  [S.INK]: 'comment.pencil',
  [S.FILEATTACHMENT]: 'comment.attachFile',
};

/** The command whose icon stands for the annotation's type (a comment bubble otherwise). */
export function typeIconCommand(a: PdfAnnotationObject): string {
  const k = measureKind(a);
  if (k) return `measure.${k}`;
  return BY_TYPE[a.type] ?? 'comment.commentsPane';
}
