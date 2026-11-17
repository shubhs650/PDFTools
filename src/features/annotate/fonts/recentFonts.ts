// Recently used comment fonts (M11-07, D-52): the five last chosen, on top of
// the font list. Kept on this device only (localStorage; listed on the
// Privacy page and removed by Clear all local data). Font ids only.
import { createStore, useStore } from 'zustand';
import { isCommentFont } from '../properties/model';

/** localStorage key (storage names keep "pdftools", D-41). */
export const RECENT_FONTS_STORAGE_KEY = 'pdftools.recentFonts';
export const RECENT_FONTS_MAX = 5;

function read(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(RECENT_FONTS_STORAGE_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter(isCommentFont).slice(0, RECENT_FONTS_MAX) : [];
  } catch {
    return [];
  }
}

const store = createStore<{ ids: string[] }>()(() => ({ ids: read() }));

export const useRecentFonts = (): string[] => useStore(store, (s) => s.ids);
export const recentFonts = (): string[] => store.getState().ids;

/** `ids` with `id` first, at most five. Pure. */
export function withRecent(ids: readonly string[], id: string): string[] {
  return [id, ...ids.filter((x) => x !== id)].slice(0, RECENT_FONTS_MAX);
}

/** A font was chosen (Properties pane, defaults, styles, text menu). */
export function noteFontUsed(id: string): void {
  if (!isCommentFont(id)) return;
  const ids = withRecent(store.getState().ids, id);
  store.setState({ ids });
  try {
    localStorage.setItem(RECENT_FONTS_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Not kept (private window): the list is still right until the app closes.
  }
}

/** Clear all local data. */
export function resetRecentFonts(): void {
  store.setState({ ids: [] });
  try {
    localStorage.removeItem(RECENT_FONTS_STORAGE_KEY);
  } catch {
    // nothing stored
  }
}
