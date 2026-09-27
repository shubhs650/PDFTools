// App-level UI state (ARCHITECTURE §3.1: Zustand stores, per-document + app).
// Vanilla store so the reducers are testable without React; components read it
// through selectors (useApp) so a change re-renders only its readers.
import { createStore, useStore } from 'zustand';

/**
 * Pointer tools: Select (V) selects text since M2-04 (M1-Q5) until M3 gives it
 * objects; Select Text only ever selects text; Hand (H) pans.
 */
export type Tool = 'select' | 'selectText' | 'hand';

export const PANE_WIDTH_MIN = 160;
export const PANE_WIDTH_MAX = 480;
export const PANE_WIDTH_DEFAULT = 260; // --pane-width

export interface AppState {
  leftPaneOpen: boolean;
  /** The left pane shown when the pane area is open (a `rail.*` command id, M2-08). */
  leftPane: string;
  /** Width of the left pane in CSS px (resizable, M2-08). */
  leftPaneWidth: number;
  propertiesOpen: boolean;
  ribbonCollapsed: boolean;
  shortcutsOpen: boolean;
  tool: Tool;
  /** Space held: Hand until released (§8.1). */
  spaceHand: boolean;
  toggleLeftPane(): void;
  /** Shows `pane`; choosing the pane already shown closes the pane area. */
  choosePane(pane: string): void;
  setLeftPaneWidth(px: number): void;
  toggleProperties(): void;
  setProperties(open: boolean): void;
  toggleRibbon(): void;
  setShortcutsOpen(open: boolean): void;
  setTool(tool: Tool): void;
  setSpaceHand(on: boolean): void;
}

export const createAppStore = () =>
  createStore<AppState>()((set) => ({
    leftPaneOpen: true,
    leftPane: 'rail.thumbnails',
    leftPaneWidth: PANE_WIDTH_DEFAULT,
    propertiesOpen: false,
    ribbonCollapsed: false,
    shortcutsOpen: false,
    tool: 'select',
    spaceHand: false,
    toggleLeftPane: () => {
      set((s) => ({ leftPaneOpen: !s.leftPaneOpen }));
    },
    choosePane: (pane) => {
      set((s) =>
        s.leftPaneOpen && s.leftPane === pane
          ? { leftPaneOpen: false }
          : { leftPaneOpen: true, leftPane: pane },
      );
    },
    setLeftPaneWidth: (px) => {
      set({ leftPaneWidth: Math.round(Math.min(PANE_WIDTH_MAX, Math.max(PANE_WIDTH_MIN, px))) });
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
    setTool: (tool) => {
      set({ tool, spaceHand: false });
    },
    setSpaceHand: (on) => {
      set({ spaceHand: on });
    },
  }));

export const appStore = createAppStore();

export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(appStore, selector);
}
