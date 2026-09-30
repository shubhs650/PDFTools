// Which pages the viewer refreshes after a page operation or a comment
// transfer (M4-09, M4-20).
import type { PageInfo } from '../../engine/renderApi';

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
