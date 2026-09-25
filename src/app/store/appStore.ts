// App-level UI state (ARCHITECTURE §3.1: Zustand stores, per-document + app).
// Vanilla store so the reducers are testable without React; components read it
// through selectors (useApp) so a change re-renders only its readers.
import { createStore, useStore } from 'zustand';

export interface AppState {
  leftPaneOpen: boolean;
  propertiesOpen: boolean;
  ribbonCollapsed: boolean;
  shortcutsOpen: boolean;
  toggleLeftPane(): void;
  toggleProperties(): void;
  setProperties(open: boolean): void;
  toggleRibbon(): void;
  setShortcutsOpen(open: boolean): void;
}

export const createAppStore = () =>
  createStore<AppState>()((set) => ({
    leftPaneOpen: true,
    propertiesOpen: false,
    ribbonCollapsed: false,
    shortcutsOpen: false,
    toggleLeftPane: () => {
      set((s) => ({ leftPaneOpen: !s.leftPaneOpen }));
    },
    toggleProperties: () => {
      set((s) => ({ propertiesOpen: !s.propertiesOpen }));
    },
    setProperties: (open) => {
      set({ propertiesOpen: open });
    },
    toggleRibbon: () => {
      set((s) => ({ ribbonCollapsed: !s.ribbonCollapsed }));
    },
    setShortcutsOpen: (open) => {
      set({ shortcutsOpen: open });
    },
  }));

export const appStore = createAppStore();

export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(appStore, selector);
}
