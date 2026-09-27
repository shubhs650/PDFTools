// Pure annotation helpers for the keyboard (M3-05): which annotations Tab
// reaches on a page, and in what order.
import { PdfAnnotationSubtype, type PdfAnnotationObject } from '@embedpdf/models';
import type { AnnotationDocumentState } from '@embedpdf/plugin-annotation';

/** Not reachable by Tab: links (link layer), widgets (form layer), popups, replies and state replies. */
const SKIP = new Set([
  PdfAnnotationSubtype.LINK,
  PdfAnnotationSubtype.WIDGET,
  PdfAnnotationSubtype.POPUP,
]);

/** Reading order: top to bottom, then left to right (points, top-left origin). */
export function readingOrder(a: PdfAnnotationObject, b: PdfAnnotationObject): number {
  const dy = a.rect.origin.y - b.rect.origin.y;
  if (Math.abs(dy) > 2) return dy;
  return a.rect.origin.x - b.rect.origin.x;
}

export function pageAnnotations(
  state: AnnotationDocumentState,
  pageIndex: number,
): PdfAnnotationObject[] {
  return (state.pages[pageIndex] ?? [])
    .map((uid) => state.byUid[uid]?.object)
    .filter((o): o is PdfAnnotationObject => o !== undefined)
    .filter((o) => !SKIP.has(o.type) && !o.inReplyToId)
    .sort(readingOrder);
}

/**
 * The annotation Tab (dir 1) or Shift+Tab (-1) selects next; null past either
 * end, so the key moves focus out of the document as usual.
 */
export function cycleTarget(
  list: readonly PdfAnnotationObject[],
  currentId: string | null,
  dir: 1 | -1,
): PdfAnnotationObject | null {
  if (list.length === 0) return null;
  const i = currentId === null ? -1 : list.findIndex((a) => a.id === currentId);
  if (i === -1) return dir === 1 ? (list[0] ?? null) : (list[list.length - 1] ?? null);
  return list[i + dir] ?? null;
}
