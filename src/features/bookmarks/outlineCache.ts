// The outline read for the Bookmarks pane (M2-10; M6-11 reads it in the Work
// worker, bookmarks.ts) is kept per document with the page version it was read
// at. A page change makes it stale: its destinations point at other indexes
// now. Kept apart from bookmarks.ts so the page operations can drop it
// without importing the pane's state (no import cycle).
const stale = new Set<string>();

/** Pages changed (M4-09): the outline is read again before it is shown. */
export function dropOutline(docId: string): void {
  stale.add(docId);
}

/** Whether the outline was dropped since it was last read (and forgets it). */
export function takeDropped(docId: string): boolean {
  return stale.delete(docId);
}
