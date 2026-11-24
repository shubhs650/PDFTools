// The record of Compare's first-time tips (M12-26), apart from their store so
// the Help window can replay them without the app's code.

/** localStorage key (storage names keep "pdftools", D-41): the tips were seen or skipped. */
export const COMPARE_TIPS_STORAGE_KEY = 'pdftools.compareTipsSeen';

/** Help → "Show the Compare tips again": the overlay result on screen, or the next one, shows them. */
export function replayTips(): void {
  try {
    localStorage.removeItem(COMPARE_TIPS_STORAGE_KEY);
  } catch {
    // nothing stored
  }
}
