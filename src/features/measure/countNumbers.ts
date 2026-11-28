// Same-size count numbers (M14-07, D-75, Q11): a view option, off by default,
// toggled from the status bar beside Thin Lines. While it is on, a count whose
// number would be drawn smaller than a small fixed size on screen gets a label
// of that size beside its symbol, on a see-through background, never more than
// about 4× its saved size (CountNumbersLayer.tsx). Screen only: never the file,
// print, exports or snapshots. One setting for every document, kept on this
// device (localStorage; listed on the Privacy page, removed by Clear all local data).
import { createStore, useStore } from 'zustand';

import { COUNT_NUMBERS_STORAGE_KEY } from './countKeys';

export { COUNT_NUMBERS_STORAGE_KEY };

/** The label's size on screen (CSS px). */
export const COUNT_LABEL_PX = 11;

/** The largest a label grows over its saved number's size on screen. */
export const COUNT_LABEL_CAP = 4;

interface CountNumbersState {
  on: boolean;
}

function read(): boolean {
  try {
    return localStorage.getItem(COUNT_NUMBERS_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export const countNumbersStore = createStore<CountNumbersState>()(() => ({ on: read() }));

export function useCountNumbers(): boolean {
  return useStore(countNumbersStore, (s) => s.on);
}

export function isCountNumbersOn(): boolean {
  return countNumbersStore.getState().on;
}

export function setCountNumbers(on: boolean): void {
  if (countNumbersStore.getState().on === on) return;
  countNumbersStore.setState({ on });
  try {
    if (on) localStorage.setItem(COUNT_NUMBERS_STORAGE_KEY, '1');
    else localStorage.removeItem(COUNT_NUMBERS_STORAGE_KEY);
  } catch {
    // Not kept (private window): the choice holds until the app closes.
  }
}

export function toggleCountNumbers(): void {
  setCountNumbers(!isCountNumbersOn());
}

/** Clear all local data: back to off. */
export function resetCountNumbers(): void {
  setCountNumbers(false);
  try {
    localStorage.removeItem(COUNT_NUMBERS_STORAGE_KEY);
  } catch {
    // nothing stored
  }
}

/**
 * A label's font size on screen (CSS px) for a saved number `saved` points
 * high at `scale` CSS px per point, or null when the saved number is already
 * at least the label's size (it shows as it is).
 */
export function labelPx(saved: number, scale: number): number | null {
  const shown = saved * scale;
  if (!(shown > 0) || shown >= COUNT_LABEL_PX) return null;
  return Math.min(COUNT_LABEL_PX, COUNT_LABEL_CAP * shown);
}
