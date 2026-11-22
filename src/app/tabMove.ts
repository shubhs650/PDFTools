// Moving a file tab (M11-04, ADR-028 D-50): one way for the drag, the keys
// (Ctrl+Shift+Left/Right) and the tab menu's Move Left / Move Right and Sort Tabs by
// Name (M11-05).
// The strip registers an animator so the move slides into place, and listens for the
// announcement ("Moved to position 2 of 4", a polite live region).
import { documentStore } from './store/documentStore';

/**
 * Runs the commit (the store change) and animates the tabs into their new places,
 * keeping tab `movedId` in view.
 */
export type TabAnimator = (commit: () => void, movedId: string) => void;

/** What the strip's live region says (M11-04 moves; M11-05 sort and copy). */
export type TabNews =
  | { kind: 'moved'; position: number; count: number }
  | { kind: 'sorted' }
  | { kind: 'copied' }
  | { kind: 'copyFailed' };

let animator: TabAnimator | null = null;
const listeners = new Set<(news: TabNews) => void>();

/** The strip, while mounted: animates moves. Returns the unregister function. */
export function setTabAnimator(a: TabAnimator): () => void {
  animator = a;
  return () => {
    if (animator === a) animator = null;
  };
}

/** Called after every move (the tab's new 1-based position and the count), sort or copy. */
export function onTabNews(fn: (news: TabNews) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Says something about the tabs in the strip's polite live region. */
export function tellTabs(news: TabNews): void {
  for (const fn of listeners) fn(news);
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
  tellTabs({ kind: 'moved', position: to + 1, count: order.length });
  return true;
}

/**
 * Puts the tabs in `next` order (Sort Tabs by Name, M11-05), sliding them into place;
 * the active tab keeps its focus and stays in view. False when nothing changed.
 */
export function reorderTabs(next: readonly string[]): boolean {
  const s = documentStore.getState();
  const same =
    next.length === s.order.length &&
    next.every((id, i) => id === s.order[i]) &&
    next.every((id) => s.order.includes(id));
  if (same || next.length !== s.order.length) return false;
  const commit = (): void => {
    documentStore.getState().reorder(next);
  };
  const keep = s.activeTab ?? next[0];
  if (animator && keep) animator(commit, keep);
  else commit();
  tellTabs({ kind: 'sorted' });
  return true;
}

/** Moves the active tab one place left (-1) or right (+1). */
export function moveActiveTab(step: -1 | 1): boolean {
  const { order, activeTab } = documentStore.getState();
  if (!activeTab) return false;
  return moveTab(activeTab, order.indexOf(activeTab) + step);
}
