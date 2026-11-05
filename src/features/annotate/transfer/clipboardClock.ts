// Which clipboard is newer (M7-08, ADR-023 D-45): our comment clipboard
// (ADR-018, in the app only) or an image on the system clipboard. The page
// can't read the system clipboard without asking, and no event tells it when
// another app copies, so it keeps a clock: our copy gets a tick, and so does
// every moment the system clipboard may have changed under us — the window
// lost focus (another app, the screenshot tool), the browser reported a
// change, or we wrote a snapshot to it. An image already seen in a paste
// before our copy is the old one. Pure apart from the clock.

let now = 0;
let outside = 0;
/** Images seen in a paste: fingerprint → tick. A few are enough. */
const seen = new Map<string, number>();
const SEEN_MAX = 16;

/** The next tick. */
export const tick = (): number => ++now;

/** The system clipboard may have changed now. */
export function noteOutsideCopy(): void {
  outside = tick();
}

/** The last tick the system clipboard may have changed at (0: never). */
export const outsideAt = (): number => outside;

/** An image was on the system clipboard at a paste. */
export function noteSeen(fingerprint: string): void {
  if (seen.has(fingerprint)) return;
  seen.set(fingerprint, tick());
  if (seen.size > SEEN_MAX) {
    const first = seen.keys().next().value;
    if (first !== undefined) seen.delete(first);
  }
}

/** When this image was first seen in a paste (null: never). */
export const seenAt = (fingerprint: string): number | null => seen.get(fingerprint) ?? null;

export type PasteChoice = 'image' | 'comments' | 'none';

/**
 * What a paste takes: the newest copy. `clipAt` is our comment clipboard's
 * tick (null: empty); `imageSeenAt` when the clipboard's image was first seen
 * (null: new to us). Pure.
 */
export function pasteChoice(s: {
  image: boolean;
  clipAt: number | null;
  imageSeenAt: number | null;
  outsideAt: number;
}): PasteChoice {
  if (!s.image) return s.clipAt === null ? 'none' : 'comments';
  if (s.clipAt === null) return 'image';
  if (s.imageSeenAt !== null && s.imageSeenAt < s.clipAt) return 'comments';
  return s.outsideAt > s.clipAt ? 'image' : 'comments';
}

/** Whether the menu's Paste can take our comments without reading the system clipboard. Pure. */
export const clipIsNewest = (clipAt: number | null, outside: number): boolean =>
  clipAt !== null && clipAt > outside;

/** Tests only. */
export function resetClipboardClock(): void {
  now = 0;
  outside = 0;
  seen.clear();
}
