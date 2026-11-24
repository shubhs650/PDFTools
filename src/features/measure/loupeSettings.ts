// The Measure loupe's settings (M13-02, D-68, ADR-034): shown or not (Measure
// ribbon, Snap group), size and magnification, and whether picking a measuring
// tool turns snapping on (Settings → Measure). One set for every document,
// kept on this device (localStorage; listed on the Privacy page, removed by
// Clear all local data).
import { createStore, useStore } from 'zustand';
import { DEFAULT_LOUPE, parseLoupeSettings, type LoupeSettings } from '../view/loupe/loupeModel';

/** localStorage key (storage names keep "pdftools", D-41). */
export const LOUPE_STORAGE_KEY = 'pdftools.measureLoupe';

function read(): LoupeSettings {
  try {
    return parseLoupeSettings(localStorage.getItem(LOUPE_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_LOUPE };
  }
}

export const loupeSettingsStore = createStore<LoupeSettings>()(() => read());

export function useLoupeSettings<T>(fn: (s: LoupeSettings) => T): T {
  return useStore(loupeSettingsStore, fn);
}

export function setLoupeSettings(patch: Partial<LoupeSettings>): void {
  loupeSettingsStore.setState(patch);
  try {
    localStorage.setItem(LOUPE_STORAGE_KEY, JSON.stringify(loupeSettingsStore.getState()));
  } catch {
    // Not kept (private window): the choice holds until the app closes.
  }
}

/** Clear all local data: back to the defaults. */
export function resetLoupeSettings(): void {
  loupeSettingsStore.setState({ ...DEFAULT_LOUPE });
  try {
    localStorage.removeItem(LOUPE_STORAGE_KEY);
  } catch {
    // nothing stored
  }
}
