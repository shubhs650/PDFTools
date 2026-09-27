// Previous / Next View per document (§5, M2-10): the stateful side of
// history.ts. Jumps record the view they leave; Alt+Left / Alt+Right walk it.
import { notify } from '../../app/commands/dispatch';
import { documentStore } from '../../app/store/documentStore';
import { currentView, restoreView } from './controller';
import { ViewHistory } from './history';

const histories = new Map<string, ViewHistory>();

const historyOf = (docId: string): ViewHistory => {
  let h = histories.get(docId);
  if (!h) {
    h = new ViewHistory();
    histories.set(docId, h);
  }
  return h;
};

/** Call before a jump (bookmark, link, page box, search result). */
export function recordJump(): void {
  const cur = currentView();
  if (!cur) return;
  historyOf(cur.docId).jump(cur.entry);
  notify();
}

export function canGoBack(): boolean {
  const id = documentStore.getState().activeId;
  return !!id && !!histories.get(id)?.canBack;
}

export function canGoForward(): boolean {
  const id = documentStore.getState().activeId;
  return !!id && !!histories.get(id)?.canForward;
}

export function previousView(): void {
  const cur = currentView();
  const to = cur ? histories.get(cur.docId)?.goBack(cur.entry) : null;
  if (to) restoreView(to);
  notify();
}

export function nextView(): void {
  const cur = currentView();
  const to = cur ? histories.get(cur.docId)?.goForward(cur.entry) : null;
  if (to) restoreView(to);
  notify();
}

// A closed document's history goes with it.
documentStore.subscribe((s, prev) => {
  if (s.docs === prev.docs) return;
  for (const id of histories.keys()) if (!(id in s.docs)) histories.delete(id);
});
