// Which pages the viewer refreshes after a page operation or a comment
// transfer (M4-09, M4-20), or an OCR layer (M11-01).
import type { PageInfo } from '../../engine/renderApi';
import type { Change } from './pageOps';

type Identity = Pick<PageInfo, 'objectNumber' | 'rotation' | 'size'>;

/**
 * Indexes whose page changed: another page object, rotation or size there,
 * or a page that didn't exist. Only these are refreshed:
 * EmbedPDF's selection plugin fetches text geometry for every refreshed page,
 * and 2,000 such jobs held the Work worker for minutes (M4-20 perf). Pure.
 */
export function changedPages(before: readonly Identity[], after: readonly Identity[]): number[] {
  const out = new Set<number>();
  after.forEach((p, i) => {
    const o = before[i];
    if (!o) {
      out.add(i);
      return;
    }
    const same =
      o.objectNumber === p.objectNumber &&
      o.rotation === p.rotation &&
      o.size.width === p.size.width &&
      o.size.height === p.size.height;
    if (!same) out.add(i);
  });
  return [...out].sort((a, b) => a - b);
}

/**
 * Pages whose content a change rewrites without changing their identity: a
 * flatten, a crop, or objects that change page text (an OCR layer, M11-01). Without
 * them, EmbedPDF's selection plugin keeps its cached text geometry, so new
 * text could not be selected (or removed text still could) until reopening.
 * Pure.
 */
export const contentPages = (change: Change): number[] => {
  if (change.kind === 'op') {
    if (change.op.kind === 'flatten') return change.op.pages.map((p) => p.page);
    // A crop moves the page's origin even where its size stays (M11-08·O9).
    if (change.op.kind === 'crop') return [...change.op.pages];
    return [];
  }
  return change.content ?? [];
};
