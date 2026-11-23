// The flash drawn over a page (M12-27, ADR-033); see pageFlash.ts.
import { useStore } from 'zustand';
import { flashStore } from './pageFlash';

/** A page's flash, if it has one. */
export function PageFlashLayer({
  documentId,
  pageIndex,
  scale,
}: {
  documentId: string;
  pageIndex: number;
  scale: number;
}) {
  const f = useStore(flashStore, (s) =>
    s.flashes.find((x) => x.docId === documentId && x.page === pageIndex),
  );
  if (!f) return null;
  const [x0, y0, x1, y1] = f.box;
  return (
    <div
      key={f.key}
      className="comment-flash"
      aria-hidden="true"
      data-testid="comment-flash"
      style={{
        left: x0 * scale,
        top: y0 * scale,
        width: (x1 - x0) * scale,
        height: (y1 - y0) * scale,
      }}
    />
  );
}
