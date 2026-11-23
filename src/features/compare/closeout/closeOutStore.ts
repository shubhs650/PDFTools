// The close-out pane's state (M12-15, D-62): whether it is shown, its filter
// and selected comment per comparison, and the check highlight's colour (Q16:
// green, changed through the standard swatch picker). Held while the app
// runs; presets (M12-21) and the comparison file (M12-20) keep them later.
import { createStore, useStore } from 'zustand';
import { DEFAULT_CHECK_COLOUR, type CloseOutFilter } from './closeOutModel';

export interface CloseOutView {
  open: boolean;
  filter: CloseOutFilter;
  /** The selected row: its document and comment. */
  selected: { docId: string; id: string } | null;
}

export const DEFAULT_CLOSE_OUT_VIEW: CloseOutView = { open: false, filter: 'all', selected: null };

interface CloseOutState {
  colour: string;
  byId: Record<string, CloseOutView>;
}

export const closeOutStore = createStore<CloseOutState>()(() => ({
  colour: DEFAULT_CHECK_COLOUR,
  byId: {},
}));

export function useCloseOut<T>(fn: (s: CloseOutState) => T): T {
  return useStore(closeOutStore, fn);
}

export const closeOutView = (id: string): CloseOutView =>
  closeOutStore.getState().byId[id] ?? DEFAULT_CLOSE_OUT_VIEW;

export function useCloseOutView(id: string): CloseOutView {
  return useStore(closeOutStore, (s) => s.byId[id] ?? DEFAULT_CLOSE_OUT_VIEW);
}

export function updateCloseOut(id: string, fn: (v: CloseOutView) => CloseOutView): void {
  closeOutStore.setState((s) => {
    const cur = s.byId[id] ?? DEFAULT_CLOSE_OUT_VIEW;
    const next = fn(cur);
    return next === cur ? {} : { byId: { ...s.byId, [id]: next } };
  });
}

export function setCheckColour(hex: string): void {
  closeOutStore.setState({ colour: hex });
}

/** A closed comparison forgets its pane. */
export function dropCloseOut(id: string): void {
  if (!closeOutStore.getState().byId[id]) return;
  closeOutStore.setState((s) => ({
    byId: Object.fromEntries(Object.entries(s.byId).filter(([k]) => k !== id)),
  }));
}
