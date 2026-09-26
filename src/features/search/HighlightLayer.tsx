import { useEffect, useState } from 'react';
import type { HitRect } from '../../workers/work/search';
import { rectsFor, useFind } from './findStore';

/**
 * Quick Find hits on one page (M2-07), in unrotated page space inside the
 * rotate plugin's box. Only mounted pages ask for their rectangles, so only
 * pages in view cost anything. Decorative: the find bar announces the result.
 */
export function HighlightLayer({
  documentId,
  pageIndex,
  scale,
}: {
  documentId: string;
  pageIndex: number;
  scale: number;
}) {
  const ours = useFind((s) => s.open && s.docId === documentId);
  const count = useFind((s) => s.results.pages.get(pageIndex)?.count ?? 0);
  const generation = useFind((s) => s.generation);
  const current = useFind((s) => (s.cursor?.page === pageIndex ? s.cursor.index : -1));
  const [rects, setRects] = useState<{ gen: number; rects: HitRect[][] } | null>(null);

  useEffect(() => {
    if (!ours || count === 0) return;
    let live = true;
    rectsFor(pageIndex).then(
      (r) => {
        if (live) setRects({ gen: generation, rects: r });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [ours, count, generation, pageIndex]);

  if (!ours || count === 0 || rects?.gen !== generation) return null;
  return (
    <div className="find-highlights" aria-hidden>
      {rects.rects.flatMap((hit, i) =>
        hit.map((r, k) => (
          <div
            key={`${String(i)}-${String(k)}`}
            className={i === current ? 'find-hit find-hit--current' : 'find-hit'}
            data-hit={i}
            style={{
              left: r.x * scale,
              top: r.y * scale,
              width: r.width * scale,
              height: r.height * scale,
            }}
          />
        )),
      )}
    </div>
  );
}
