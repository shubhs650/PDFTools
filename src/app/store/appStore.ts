// App-level UI state (ARCHITECTURE §3.1: Zustand stores, per-document + app).
// Vanilla store so the reducers are testable without React; components read it
// through selectors (useApp) so a change re-renders only its readers.
import { createStore, useStore } from 'zustand';
import type { DrawTool } from '../../features/annotate/tools/drawModel';
import { PANE_WIDTH_DEFAULT, clampPaneWidth } from '../paneSize';

/**
 * Pointer tools: Select (V) selects text and annotations (M3-05); Select Text
 * only ever selects text; Select Objects selects annotations (text selection
 * still works on the page between them); Hand (H) pans. The text markup tools
 * (M3-08) turn each text selection into a markup until Esc.
 */
export type Tool =
  | 'select'
  | 'selectText'
  | 'selectObjects'
  | 'hand'
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'squiggly'
  | 'insertText'
  | 'replaceText'
  // Redaction marks (M4-16): text selections become /Redact marks; areas are drawn.
  | 'redactText'
  | 'redactArea'
  // Snapshot (M6-09): a rectangle whose picture goes to the clipboard.
  | 'snapshot'
  // Attach File (M6-10): a click on a page picks the file to attach there.
  | 'attachFile'
  // Zoom to Area (M11-08·O4): a drag fills the window with its area, a click zooms in.
  | 'zoomArea'
  // Crop Tool (M11-08·O9): a drag on a page draws the area to keep; Crop Pages opens.
  | 'cropArea'
  // Select Fields (M6-14): form fields are selected, moved and resized; nothing is filled.
  | 'selectFields'
  // Note, text and drawing tools (M3-09): EmbedPDF tool ids.
  | DrawTool;

export { PANE_WIDTH_DEFAULT, PANE_WIDTH_MAX, PANE_WIDTH_MIN } from '../paneSize';

export interface AppState {
  leftPaneOpen: boolean;
  /** The left pane shown when the pane area is open (a `rail.*` command id, M2-08). */
  leftPane: string;
  /** Width of the left pane in CSS px (resizable, M2-08). */
  leftPaneWidth: number;
  propertiesOpen: boolean;
  /** Width of the Properties pane in CSS px (resizable, M11-10). */
  propertiesWidth: number;
  ribbonCollapsed: boolean;
  /** The ribbon tab shown (M3-17: scale viewports show on the Measure tab). */
  ribbonTab: string;
  shortcutsOpen: boolean;
  tool: Tool;
  /** Space held: Hand until released (§8.1). */
  spaceHand: boolean;
  /** Z held with Hand: Zoom to Area until released (M11-08·O4). */
  zoomHold: boolean;
  toggleLeftPane(): void;
  /** Shows `pane`; choosing the pane already shown closes the pane area. */
  choosePane(pane: string): void;
  setLeftPaneWidth(px: number): void;
  toggleProperties(): void;
  setProperties(open: boolean): void;
  setPropertiesWidth(px: number): void;
  toggleRibbon(): void;
  setRibbonTab(tab: string): void;
  setShortcutsOpen(open: boolean): void;
  setTool(tool: Tool): void;
  setSpaceHand(on: boolean): void;
  setZoomHold(on: boolean): void;
}

export const createAppStore = () =>
  createStore<AppState>()((set) => ({
    leftPaneOpen: true,
    leftPane: 'rail.thumbnails',
    leftPaneWidth: PANE_WIDTH_DEFAULT,
    propertiesOpen: false,
    propertiesWidth: PANE_WIDTH_DEFAULT,
    ribbonCollapsed: false,
    ribbonTab: 'home',
    shortcutsOpen: false,
    tool: 'select',
    spaceHand: false,
    zoomHold: false,
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
      set({ leftPaneWidth: clampPaneWidth(px) });
    },
    toggleProperties: () => {
      set((s) => ({ propertiesOpen: !s.propertiesOpen }));
    },
    setProperties: (open) => {
      set({ propertiesOpen: open });
    },
    setPropertiesWidth: (px) => {
      set({ propertiesWidth: clampPaneWidth(px) });
    },
    toggleRibbon: () => {
      set((s) => ({ ribbonCollapsed: !s.ribbonCollapsed }));
    },
    setRibbonTab: (tab) => {
      set({ ribbonTab: tab });
    },
    setShortcutsOpen: (open) => {
      set({ shortcutsOpen: open });
    },
    setTool: (tool) => {
      set({ tool, spaceHand: false, zoomHold: false });
    },
    setSpaceHand: (on) => {
      set({ spaceHand: on });
    },
    setZoomHold: (on) => {
      set({ zoomHold: on });
    },
  }));

export const appStore = createAppStore();

/** The pointer tool in effect: Z held (Zoom to Area) and Space held (Hand) win over the tool. */
export function effectiveTool(s: Pick<AppState, 'tool' | 'spaceHand' | 'zoomHold'>): Tool {
  if (s.zoomHold) return 'zoomArea';
  return s.spaceHand ? 'hand' : s.tool;
}

export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(appStore, selector);
}
