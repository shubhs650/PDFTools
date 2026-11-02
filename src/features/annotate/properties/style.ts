// Property changes and Copy/Apply Style (M3-10): every change to a selection
// is one plugin batch update, so one undo step.
import type { PdfAnnotationObject } from '@embedpdf/models';
import { annotationCapability } from '../selection';
import { applyStyle, patchFor, styleOf, type Plain, type Prop, type Style } from './model';

export function applyProp(
  docId: string,
  sel: readonly PdfAnnotationObject[],
  p: Prop,
  v: Plain,
): void {
  const patches = sel
    .map((a) => ({ a, patch: patchFor(a, p, v) }))
    .filter((x): x is { a: PdfAnnotationObject; patch: Partial<PdfAnnotationObject> } => !!x.patch)
    .map(({ a, patch }) => ({ pageIndex: a.pageIndex, id: a.id, patch }));
  if (patches.length) annotationCapability()?.forDocument(docId).updateAnnotations(patches);
}

/** The copied style (Copy Style), kept for the session. */
let copied: Style | null = null;

export const copiedStyle = (): Style | null => copied;

export function copyStyle(a: PdfAnnotationObject): void {
  copied = styleOf(a);
}

export function pasteStyle(docId: string, sel: readonly PdfAnnotationObject[]): void {
  const style = copied;
  if (!style) return;
  const patches = sel
    .map((a) => ({ pageIndex: a.pageIndex, id: a.id, patch: applyStyle(style, a) }))
    .filter((x) => Object.keys(x.patch).length > 0);
  if (patches.length) annotationCapability()?.forDocument(docId).updateAnnotations(patches);
}
