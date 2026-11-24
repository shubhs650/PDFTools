// The app's side panes on a comparison tab (M12-25, ADR-033, D-62). The left pane area
// (Thumbnails, Bookmarks, …) only says "Open a document" there, so it closes itself when a
// comparison tab comes into use and opens again as it was when a document tab does. Opening
// a pane from the rail on a comparison tab still works. A maximised comparison (Maximise)
// stops being maximised once it is closed. Pure step + one store subscription.
import { appStore } from '../../../app/store/appStore';
import { documentStore } from '../../../app/store/documentStore';
import { keepLayouts } from './layoutStore';

export interface PaneMemory {
  /** The left pane area's state on documents, kept while comparison tabs are in use. */
  saved: boolean | null;
}

/**
 * The left pane area after the tab in use changes from one kind to another: `toCompare`
 * says whether the new tab is a comparison. Returns the pane area's state and the memory.
 */
export function paneStep(
  mem: PaneMemory,
  open: boolean,
  toCompare: boolean,
): { open: boolean; mem: PaneMemory } {
  if (toCompare) return { open: false, mem: { saved: mem.saved ?? open } };
  if (mem.saved === null) return { open, mem };
  return { open: mem.saved, mem: { saved: null } };
}

/** Starts following the tab in use; returns the stop function. */
export function watchAppPanes(): () => void {
  let mem: PaneMemory = { saved: null };
  let tab = documentStore.getState().activeTab;
  const isCompare = (id: string | null): boolean =>
    id !== null && Boolean(documentStore.getState().comparisons[id]);
  return documentStore.subscribe((s) => {
    keepLayouts((id) => Boolean(s.comparisons[id]));
    const max = appStore.getState().maximised;
    if (max !== null && !s.comparisons[max]) appStore.getState().setMaximised(null);
    if (s.activeTab === tab) return;
    const wasCompare = tab !== null && Boolean(s.comparisons[tab]);
    tab = s.activeTab;
    const toCompare = isCompare(tab);
    // Between two documents, or two comparisons after the first, nothing changes by itself.
    if (!toCompare && !wasCompare && mem.saved === null) return;
    const app = appStore.getState();
    const next = paneStep(mem, app.leftPaneOpen, toCompare);
    mem = next.mem;
    if (next.open !== app.leftPaneOpen) app.toggleLeftPane();
  });
}
