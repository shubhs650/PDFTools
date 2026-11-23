// A box on a page flashed once (M12-27, ADR-033): where a comment is, after
// the close-out list brought it into view. Drawn by every document window
// over its page (page points as laid out, origin top left, before the page's
// own rotation, like the annotation layers), never a comment and never saved.
// With reduced motion it shows as a still outline for the same time.
import { createStore, useStore } from 'zustand';

/** A box to flash: its document, page (0-based) and rectangle [x0, y0, x1, y1] in page points. */
export interface PageFlash {
  docId: string;
  page: number;
  box: readonly [number, number, number, number];
  /** Tells one flash of the same box from the next (a new element restarts the animation). */
  key: number;
}

/** How long a flash shows (ms): the CSS animation's length. */
export const FLASH_MS = 1200;

const flashStore = createStore<{ flashes: readonly PageFlash[] }>()(() => ({ flashes: [] }));

let next = 0;

/** Flashes `box` on page `page` of `docId` once. */
export function flashBox(
  docId: string,
  page: number,
  box: readonly [number, number, number, number],
): void {
  const f: PageFlash = { docId, page, box, key: ++next };
  flashStore.setState((s) => ({
    flashes: [...s.flashes.filter((x) => x.docId !== docId || x.page !== page), f],
  }));
  setTimeout(() => {
    flashStore.setState((s) => ({ flashes: s.flashes.filter((x) => x !== f) }));
  }, FLASH_MS);
}

/** The flashes shown now (tests). */
export const shownFlashes = (): readonly PageFlash[] => flashStore.getState().flashes;

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
