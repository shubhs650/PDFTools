// A box on a page flashed once (M12-27, ADR-033): where a comment is, after
// the close-out list brought it into view. Drawn by every document window
// over its page (page points as laid out, origin top left, before the page's
// own rotation, like the annotation layers; PageFlashLayer.tsx), never a
// comment and never saved. With reduced motion it shows as a still outline.
import { createStore } from 'zustand';

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

export const flashStore = createStore<{ flashes: readonly PageFlash[] }>()(() => ({ flashes: [] }));

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
