// First-time tips of Compare (M12-26, ADR-033 decision 7): three short
// pop-ups on the first PDF overlay — the colours, the differences list,
// lining up — then never again on this device. Help replays them: its button
// forgets the record (the same origin's localStorage), and an overlay result
// on screen hears it and shows the tips at once.
import { createStore, useStore } from 'zustand';
import { COMPARE_TIPS_STORAGE_KEY, replayTips } from './tipsKey';

export { COMPARE_TIPS_STORAGE_KEY, replayTips };

/** The tips, in order. */
export const TIPS = ['colours', 'differences', 'lineUp'] as const;
export type TipId = (typeof TIPS)[number];

interface TipsState {
  /** The comparison the tips are shown on, and which tip; null when none shows. */
  showing: { id: string; step: number } | null;
}

const store = createStore<TipsState>()(() => ({ showing: null }));

function seen(): boolean {
  try {
    return localStorage.getItem(COMPARE_TIPS_STORAGE_KEY) !== null;
  } catch {
    // No storage (a locked-down browser): no tips rather than tips every time.
    return true;
  }
}

function recordSeen(): void {
  try {
    localStorage.setItem(COMPARE_TIPS_STORAGE_KEY, '1');
  } catch {
    // nothing to keep
  }
}

/**
 * A comparison's result is on screen: until the tips were seen to the end or
 * skipped on this device, they start (again, if the result went away before).
 */
export function offerTips(id: string): void {
  if (store.getState().showing || seen()) return;
  store.setState({ showing: { id, step: 0 } });
}

/** Next tip; after the last (Got it) the tips are done for good. */
export function nextTip(): void {
  const s = store.getState().showing;
  if (!s) return;
  if (s.step + 1 < TIPS.length) store.setState({ showing: { ...s, step: s.step + 1 } });
  else skipTips();
}

/** Skip tips, Got it or Escape: never shown again (until Help replays them). */
export function skipTips(): void {
  recordSeen();
  store.setState({ showing: null });
}

/** The result went away (its tab closed or left): its tips stop, to start again next time. */
export function hideTips(id: string): void {
  if (store.getState().showing?.id === id) store.setState({ showing: null });
}

/** The tip shown on comparison `id`, or null. */
export function useTip(id: string): { tip: TipId; step: number } | null {
  // A number from the store (a new object each time would render without end).
  const step = useStore(store, (s) => (s.showing?.id === id ? s.showing.step : -1));
  const tip = TIPS[step];
  return tip ? { tip, step } : null;
}

/**
 * Calls `onReplay` when another window of the app (Help) forgets the record,
 * so the result on screen shows the tips at once. Returns the unsubscribe.
 */
export function onReplay(onReplay: () => void): () => void {
  const listen = (e: StorageEvent): void => {
    if (e.key === COMPARE_TIPS_STORAGE_KEY && e.newValue === null) onReplay();
  };
  window.addEventListener('storage', listen);
  return () => {
    window.removeEventListener('storage', listen);
  };
}

/** Clear all local data: the tips show again on the next comparison. */
export function resetCompareTips(): void {
  store.setState({ showing: null });
  replayTips();
}

/** The tips' state, for tests. */
export const tipsStore = store;
