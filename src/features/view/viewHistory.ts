// Previous / Next View (§5, M2-10), one history for the window (M13-04, D-70,
// owner choice P2): the stateful side of history.ts. Jumps within a document,
// tab switches and opened documents record the place they leave; Alt+Left /
// Alt+Right and the status bar arrows walk it. A comparison tab is recorded as a
// tab only (jumps inside it are not recorded); closing a tab forgets its places.
import { notify } from '../../app/commands/dispatch';
import { documentStore, type DocumentsState } from '../../app/store/documentStore';
import { restoreView, viewOf, viewReady } from './controller';
import { ViewHistory, type Place } from './history';

const history = new ViewHistory();
/** True while a step of the history selects a tab, so that switch is not recorded. */
let stepping = false;
/** The latest step that waits for its tab's window (a newer step cancels it). */
let pending = 0;
/** How long a step waits for the selected tab's pages before giving up on the view. */
const MOUNT_WAIT_MS = 3000;

/** Where tab `tab` is now: a document's view, or a comparison as a tab only. */
function placeOf(s: DocumentsState, tab: string): Place | null {
  if (s.comparisons[tab]) return { tab };
  if (!s.docs[tab]) return null;
  return { tab, view: viewOf(tab) ?? undefined };
}

function currentPlace(): Place | null {
  const s = documentStore.getState();
  return s.activeTab ? placeOf(s, s.activeTab) : null;
}

/** Call before a jump within the active document (page box, bookmark, link, search result …). */
export function recordJump(): void {
  const s = documentStore.getState();
  // A comparison tab is a tab only: what happens inside it is not recorded.
  if (!s.activeTab || !s.docs[s.activeTab]) return;
  const p = placeOf(s, s.activeTab);
  if (!p?.view) return;
  history.jump(p);
  notify();
}

export function canGoBack(): boolean {
  return history.canBack;
}

export function canGoForward(): boolean {
  return history.canForward;
}

export function previousView(): void {
  go(history.goBack(currentPlace()));
}

export function nextView(): void {
  go(history.goForward(currentPlace()));
}

function go(to: Place | null): void {
  notify();
  if (!to) return;
  const s = documentStore.getState();
  const ticket = ++pending;
  if (s.activeTab !== to.tab) {
    stepping = true;
    try {
      s.activate(to.tab);
    } finally {
      stepping = false;
    }
  }
  const view = to.view;
  if (!view) return;
  // A tab just selected mounts its window over the next frames; the view waits for it.
  const started = performance.now();
  const place = (): void => {
    if (ticket !== pending || documentStore.getState().activeTab !== to.tab) return;
    if (viewReady(to.tab)) restoreView(view);
    else if (performance.now() - started < MOUNT_WAIT_MS) requestAnimationFrame(place);
  };
  place();
}

// Switching tabs and opening a document are steps too; a closed tab's places go with it.
documentStore.subscribe((s, prev) => {
  let changed = false;
  if (s.order !== prev.order) {
    const tabs = new Set(s.order);
    changed = history.forget((tab) => tabs.has(tab));
  }
  const left = prev.activeTab;
  if (!stepping && left && s.activeTab !== left && s.order.includes(left)) {
    // The window being left is still on screen here (React draws the new tab later); a
    // document not laid out yet (opened together with another) is kept as its tab only.
    const p = s.docs[left] && !viewReady(left) ? { tab: left } : placeOf(s, left);
    if (p) {
      history.jump(p);
      changed = true;
    }
  }
  if (changed) notify();
});
