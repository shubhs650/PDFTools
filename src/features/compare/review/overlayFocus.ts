// Bringing a box of an overlay result's sheet into view (M12-14, D-61): the
// differences list asks, the Review layout's link does it (ReviewLayout
// registers each comparison's way to), on a sheet not shown yet once the
// sheet list has moved to it.
export type Box = readonly [number, number, number, number];

/** Each comparison's way to bring a box of the overlay into view, and a box waiting for its sheet. */
export const focusers = new Map<string, (box: Box) => void>();
export const pendingFocus = new Map<string, Box>();

/**
 * Brings a box of the sheet's overlay into view (a difference), the other
 * windows following with the lock on. With `afterSheet`, once the sheet asked
 * for is shown (the list moved to another sheet).
 */
export function focusOverlay(id: string, box: Box, afterSheet = false): void {
  const f = focusers.get(id);
  if (afterSheet || !f) pendingFocus.set(id, box);
  else f(box);
}
