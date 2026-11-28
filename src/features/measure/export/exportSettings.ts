// The measurements export's remembered choices (M14-10, D-76, Q33): the
// format and "Include pictures", kept between exports on this device
// (localStorage; listed on the Privacy page, removed by Clear all local data).
import { createStore, useStore } from 'zustand';

/** localStorage key (storage names keep "pdftools", D-41). */
export const MEASURE_EXPORT_STORAGE_KEY = 'pdftools.measureExport';

export type ExportFormat = 'xlsx' | 'csv';

export interface ExportSettings {
  format: ExportFormat;
  pictures: boolean;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = { format: 'xlsx', pictures: false };

/** Stored text → settings (anything unreadable: the defaults). */
export function parseExportSettings(text: string | null): ExportSettings {
  if (!text) return { ...DEFAULT_EXPORT_SETTINGS };
  try {
    const o = JSON.parse(text) as Partial<Record<keyof ExportSettings, unknown>>;
    return {
      format: o.format === 'csv' ? 'csv' : 'xlsx',
      pictures: o.pictures === true,
    };
  } catch {
    return { ...DEFAULT_EXPORT_SETTINGS };
  }
}

function read(): ExportSettings {
  try {
    return parseExportSettings(localStorage.getItem(MEASURE_EXPORT_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_EXPORT_SETTINGS };
  }
}

export const exportSettingsStore = createStore<ExportSettings>()(() => read());

export function useExportSettings<T>(fn: (s: ExportSettings) => T): T {
  return useStore(exportSettingsStore, fn);
}

export function setExportSettings(patch: Partial<ExportSettings>): void {
  exportSettingsStore.setState(patch);
  try {
    localStorage.setItem(
      MEASURE_EXPORT_STORAGE_KEY,
      JSON.stringify(exportSettingsStore.getState()),
    );
  } catch {
    // Not kept (private window): the choice holds until the app closes.
  }
}

/** Clear all local data: back to the defaults. */
export function resetExportSettings(): void {
  exportSettingsStore.setState({ ...DEFAULT_EXPORT_SETTINGS });
  try {
    localStorage.removeItem(MEASURE_EXPORT_STORAGE_KEY);
  } catch {
    // nothing stored
  }
}
