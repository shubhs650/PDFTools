// Thumbnail multi-selection (M4-09, §5): the pages the Organize commands act
// on. Click selects one page, Ctrl/Cmd+click toggles, Shift+click (and
// Shift+arrows) extends from the anchor. Without a selection the commands act
// on the current page. Page indexes follow page operations (`remap`).
import { createStore, useStore } from 'zustand';
import { documentStore } from '../../app/store/documentStore';

export interface Selection {
  /** Selected page indexes, ascending. */
  selected: number[];
  /** Where Shift extends from. */
  anchor: number;
}

export interface Modifiers {
  shift: boolean;
  toggle: boolean;
}

const EMPTY: Selection = { selected: [], anchor: 0 };

/** The selection after a click (or a keyboard move) on page `index`. Pure. */
export function nextSelection(prev: Selection, index: number, mods: Modifiers): Selection {
  if (mods.shift) {
    const lo = Math.min(prev.anchor, index);
    const hi = Math.max(prev.anchor, index);
    const range = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    const base = mods.toggle ? prev.selected : [];
    return {
      selected: [...new Set([...base, ...range])].sort((a, b) => a - b),
      anchor: prev.anchor,
    };
  }
  if (mods.toggle) {
    const has = prev.selected.includes(index);
    const selected = has
      ? prev.selected.filter((p) => p !== index)
      : [...prev.selected, index].sort((a, b) => a - b);
    return { selected, anchor: index };
  }
  return { selected: [index], anchor: index };
}

/** The selection after a page operation: `map[old]` is the new index (−1: gone). Pure. */
export function remapSelection(prev: Selection, map: readonly number[]): Selection {
  const selected = [...new Set(prev.selected.map((p) => map[p] ?? -1).filter((p) => p >= 0))].sort(
    (a, b) => a - b,
  );
  const anchor = map[prev.anchor] ?? -1;
  return { selected, anchor: anchor >= 0 ? anchor : (selected[0] ?? 0) };
}

interface State {
  docs: Record<string, Selection>;
}

export const pageSelectionStore = createStore<State>()(() => ({ docs: {} }));

export function usePageSelection(docId: string | null): Selection {
  return useStore(pageSelectionStore, (s) => (docId ? (s.docs[docId] ?? EMPTY) : EMPTY));
}

export function selectionOf(docId: string): Selection {
  return pageSelectionStore.getState().docs[docId] ?? EMPTY;
}

export function setSelection(docId: string, sel: Selection): void {
  pageSelectionStore.setState((s) => ({ docs: { ...s.docs, [docId]: sel } }));
}

export function clickPage(docId: string, index: number, mods: Modifiers): void {
  const prev = pageSelectionStore.getState().docs[docId] ?? {
    selected: [],
    anchor: documentStore.getState().docs[docId]?.view.page ?? 0,
  };
  setSelection(docId, nextSelection(prev, index, mods));
}

export function remapPageSelection(docId: string, map: readonly number[]): void {
  const prev = pageSelectionStore.getState().docs[docId];
  if (prev) setSelection(docId, remapSelection(prev, map));
}

/**
 * What the page commands act on: a multi-page selection, else the current
 * page (one selected page is the current page: the selection follows navigation).
 */
export function targetPages(docId: string): number[] {
  const sel = pageSelectionStore.getState().docs[docId]?.selected ?? [];
  if (sel.length > 1) return [...sel];
  return [documentStore.getState().docs[docId]?.view.page ?? 0];
}

documentStore.subscribe((s, prev) => {
  if (s.docs === prev.docs) return;
  const gone = Object.keys(pageSelectionStore.getState().docs).filter((id) => !(id in s.docs));
  if (!gone.length) return;
  pageSelectionStore.setState((st) => ({
    docs: Object.fromEntries(Object.entries(st.docs).filter(([id]) => !gone.includes(id))),
  }));
});
