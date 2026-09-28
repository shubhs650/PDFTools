import { useMemo } from 'react';
import { format } from '../../../i18n';
import { numbersFor, useAnnotationMap, useComments } from './commentsStore';

/**
 * The comments' numbers on the page (comment.autoNumber, M3-Q5): an in-app
 * overlay only, never written to the file. Same numbers as the pane and the CRS.
 */
export function NumberOverlay({
  documentId,
  pageIndex,
  scale,
}: {
  documentId: string;
  pageIndex: number;
  scale: number;
}) {
  const on = useComments((s) => s.numbersOnPage);
  const byUid = useAnnotationMap(on ? documentId : null);
  const marks = useMemo(() => {
    if (!byUid) return [];
    const nums = numbersFor(byUid);
    return Object.values(byUid)
      .map((t) => t.object)
      .filter((o) => o.pageIndex === pageIndex && nums.has(o.id))
      .map((o) => ({ id: o.id, n: nums.get(o.id) ?? 0, x: o.rect.origin.x, y: o.rect.origin.y }));
  }, [byUid, pageIndex]);
  if (!on || marks.length === 0) return null;
  return (
    <div className="comment-numbers" aria-hidden="true">
      {marks.map((m) => (
        <span
          key={m.id}
          className="comment-number-badge"
          style={{ left: m.x * scale, top: m.y * scale }}
        >
          {format.number(m.n, 0)}
        </span>
      ))}
    </div>
  );
}
