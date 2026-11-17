// Moving a file tab (M11-04, ADR-028 D-50): one way for the drag, the keys
// (Ctrl+Shift+Left/Right) and, from M11-05, the tab menu's Move Left / Move Right.
// The strip registers an animator so the move slides into place, and listens for the
// announcement ("Moved to position 2 of 4", a polite live region).
import { documentStore } from './store/documentStore';

/**
 * Runs the commit (the store change) and animates the tabs into their new places,
 * keeping tab `movedId` in view.
 */
export type TabAnimator = (commit: () => void, movedId: string) => void;

let animator: TabAnimator | null = null;
const listeners = new Set<(position: number, count: number) => void>();

/** The strip, while mounted: animates moves. Returns the unregister function. */
export function setTabAnimator(a: TabAnimator): () => void {
  animator = a;
  return () => {
    if (animator === a) animator = null;
  };
}

/** Called after every move with the tab's new 1-based position and the tab count. */
export function onTabMoved(fn: (position: number, count: number) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Moves document `id` to `toIndex` (clamped to the row). Returns false when nothing
 * moved (unknown document, already there).
 */
export function moveTab(id: string, toIndex: number): boolean {
  const { order } = documentStore.getState();
  const from = order.indexOf(id);
  if (from < 0) return false;
  const to = Math.max(0, Math.min(toIndex, order.length - 1));
  if (to === from) return false;
  const commit = (): void => {
    documentStore.getState().move(id, to);
  };
  if (animator) animator(commit, id);
  else commit();
  for (const fn of listeners) fn(to + 1, order.length);
  return true;
}

/** Moves the active tab one place left (-1) or right (+1). */
export function moveActiveTab(step: -1 | 1): boolean {
  const { order, activeId } = documentStore.getState();
  if (!activeId) return false;
  return moveTab(activeId, order.indexOf(activeId) + step);
}
