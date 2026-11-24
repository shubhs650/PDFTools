// Bringing a box of an overlay result's sheet into view (M12-14, D-61): the
// differences list asks, the Review layout's link does it (ReviewLayout
// registers each comparison's way to), on a sheet not shown yet once the
// sheet list has moved to it. The close-out list (M12-27, ADR-033) asks the
// same for a comment of Document A, at most 400 %, and flashes it when shown.
export type Box = readonly [number, number, number, number];

export interface FocusOptions {
  /** The most the overlay zooms in (a zoom level: 4 = 400 %). */
  maxZoom?: number;
  /** The same place in Document A's window (its page as displayed), centred there too without the lock. */
  a?: Box;
  /** Called once the box is in view. */
  onShown?: () => void;
}

interface Focus {
  box: Box;
  options: FocusOptions;
}

/** Each comparison's way to bring a box of the overlay into view, and a box waiting for its sheet. */
export const focusers = new Map<string, (box: Box, options?: FocusOptions) => void>();
export const pendingFocus = new Map<string, Focus>();

/**
 * Brings a box of the sheet's overlay into view (a difference, a comment), the
 * other windows following with the lock on. With `afterSheet`, once the sheet
 * asked for is shown (the list moved to another sheet).
 */
export function focusOverlay(
  id: string,
  box: Box,
  afterSheet = false,
  options: FocusOptions = {},
): void {
  const f = focusers.get(id);
  if (afterSheet || !f) pendingFocus.set(id, { box, options });
  else f(box, options);
}
