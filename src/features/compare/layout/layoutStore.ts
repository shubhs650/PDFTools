// The room a comparison's result takes (M12-25, ADR-033, D-62): which of its panes are folded
// and how wide they are, which left-pane sections are open, and whether Filters is open.
// Remembered per comparison for the session; the reducers are pure, so they are unit tested.
import { createStore, useStore } from 'zustand';
import { clampPaneWidth } from '../../../app/paneSize';

/** A comparison pane: the overlay's left pane, Differences, Close-out, the text view's changes. */
export type PaneKey = 'sheets' | 'diffs' | 'closeout' | 'changes';

/** A foldable section of the overlay's left pane (Sheets always stays open). */
export type SectionKey = 'align' | 'area' | 'comments' | 'layers' | 'zones';

export interface CompareLayout {
  /** Panes folded to their edge strip. */
  folded: Partial<Record<PaneKey, boolean>>;
  /** Pane widths in CSS px, once dragged (else the pane's default). */
  widths: Partial<Record<PaneKey, number>>;
  /** Sections opened or closed by hand (else the section's default). */
  sections: Partial<Record<SectionKey, boolean>>;
  /** The Differences pane's detection filters (Sensitivity, Minimum size) open. */
  filters: boolean;
}

export const EMPTY_LAYOUT: CompareLayout = { folded: {}, widths: {}, sections: {}, filters: false };

/** The default width of each pane, in CSS px (the widths they had before M12-25). */
export const PANE_DEFAULT_WIDTH: Record<PaneKey, number> = {
  sheets: 240,
  diffs: 320,
  closeout: 300,
  changes: 320,
};

export const setFolded = (l: CompareLayout, pane: PaneKey, folded: boolean): CompareLayout =>
  Boolean(l.folded[pane]) === folded ? l : { ...l, folded: { ...l.folded, [pane]: folded } };

export const setPaneWidth = (l: CompareLayout, pane: PaneKey, px: number): CompareLayout => {
  const w = clampPaneWidth(px);
  return l.widths[pane] === w ? l : { ...l, widths: { ...l.widths, [pane]: w } };
};

export const paneWidth = (l: CompareLayout, pane: PaneKey): number =>
  l.widths[pane] ?? PANE_DEFAULT_WIDTH[pane];

export const setSection = (l: CompareLayout, section: SectionKey, open: boolean): CompareLayout =>
  l.sections[section] === open ? l : { ...l, sections: { ...l.sections, [section]: open } };

/** Whether a section is open: opened or closed by hand, else its default. */
export const sectionOpen = (l: CompareLayout, section: SectionKey, byDefault: boolean): boolean =>
  l.sections[section] ?? byDefault;

/** A key that changes whenever a pane folds or opens (the overlay is then fitted again). */
export const foldKey = (l: CompareLayout): string =>
  (['sheets', 'diffs', 'closeout', 'changes'] as const)
    .map((p) => (l.folded[p] ? '1' : '0'))
    .join('');

interface LayoutState {
  byId: Record<string, CompareLayout>;
}

export const layoutStore = createStore<LayoutState>()(() => ({ byId: {} }));

export const layoutOf = (id: string): CompareLayout =>
  layoutStore.getState().byId[id] ?? EMPTY_LAYOUT;

export function updateLayout(id: string, fn: (l: CompareLayout) => CompareLayout): void {
  layoutStore.setState((s) => {
    const cur = s.byId[id] ?? EMPTY_LAYOUT;
    const next = fn(cur);
    return next === cur ? s : { byId: { ...s.byId, [id]: next } };
  });
}

/** Forgets the layouts of comparisons that are closed. */
export function keepLayouts(open: (id: string) => boolean): void {
  const { byId } = layoutStore.getState();
  if (Object.keys(byId).every(open)) return;
  layoutStore.setState({
    byId: Object.fromEntries(Object.entries(byId).filter(([id]) => open(id))),
  });
}

export function useLayout(id: string): CompareLayout {
  return useStore(layoutStore, (s) => s.byId[id] ?? EMPTY_LAYOUT);
}
