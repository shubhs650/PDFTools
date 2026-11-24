// Thin Lines (M13-05, D-69, ADR-034): every line of the page drawn one device
// pixel wide at any zoom, on screen only (never the file, print, exports,
// snapshots or the CRS). One setting for every document, kept on this device
// (localStorage; listed on the Privacy page, removed by Clear all local data).
// The Render worker draws view renders from a thin copy while it is on
// (render/thinLines.ts); this module is only the setting.
import { createStore, useStore } from 'zustand';

/** localStorage key (storage names keep "pdftools", D-41). */
export const THIN_LINES_STORAGE_KEY = 'pdftools.thinLines';

interface ThinLinesState {
  on: boolean;
}

function read(): boolean {
  try {
    return localStorage.getItem(THIN_LINES_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export const thinLinesStore = createStore<ThinLinesState>()(() => ({ on: read() }));

export function useThinLines(): boolean {
  return useStore(thinLinesStore, (s) => s.on);
}

/** Read as each view render is sent (hostedEngine.ts) and in the render cache keys. */
export function isThinLinesOn(): boolean {
  return thinLinesStore.getState().on;
}

export function setThinLines(on: boolean): void {
  if (thinLinesStore.getState().on === on) return;
  thinLinesStore.setState({ on });
  try {
    if (on) localStorage.setItem(THIN_LINES_STORAGE_KEY, '1');
    else localStorage.removeItem(THIN_LINES_STORAGE_KEY);
  } catch {
    // Not kept (private window): the choice holds until the app closes.
  }
}

export function toggleThinLines(): void {
  setThinLines(!isThinLinesOn());
}

/** Clear all local data: back to off. */
export function resetThinLines(): void {
  setThinLines(false);
  try {
    localStorage.removeItem(THIN_LINES_STORAGE_KEY);
  } catch {
    // nothing stored
  }
}
