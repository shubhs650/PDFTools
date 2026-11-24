// Previous / Next View (§5, M2-10), like a browser's back and forward, now ONE
// history for the window (M13-04, D-70, owner choice P2): a place is a tab and,
// for a document, its view; a comparison tab is recorded as a tab only. Every
// jump (page box, bookmark, link, search result, Zoom to Area, thumbnail, tab
// switch, opened document) records the place it leaves; going back records the
// place it leaves on the forward side. A new jump after going back drops the
// forward entries. Closing a tab forgets its places. Pure.

export interface ViewEntry {
  page: number;
  /** Zoom factor in effect. */
  scale: number;
  scrollLeft: number;
  scrollTop: number;
}

export interface Place {
  /** The tab: a document's id or a comparison's id. */
  tab: string;
  /** A document's view; none for a comparison tab (a tab only). */
  view?: ViewEntry | undefined;
}

export const HISTORY_CAP = 100;

export class ViewHistory {
  private back: Place[] = [];
  private forward: Place[] = [];
  private readonly cap: number;

  constructor(cap = HISTORY_CAP) {
    this.cap = cap;
  }

  get canBack(): boolean {
    return this.back.length > 0;
  }

  get canForward(): boolean {
    return this.forward.length > 0;
  }

  /** A jump away from `from`. */
  jump(from: Place): void {
    const last = this.back[this.back.length - 1];
    if (!last || !samePlace(last, from)) this.back.push(from);
    if (this.back.length > this.cap) this.back.shift();
    this.forward.length = 0;
  }

  /** Previous View: the place to go to, `current` kept for Next View. */
  goBack(current: Place | null): Place | null {
    return step(this.back, this.forward, current);
  }

  goForward(current: Place | null): Place | null {
    return step(this.forward, this.back, current);
  }

  /**
   * Drops every place whose tab `keep` refuses (a closed document or comparison);
   * places that become neighbours and are the same merge. True when anything went.
   */
  forget(keep: (tab: string) => boolean): boolean {
    const back = prune(this.back, keep);
    const forward = prune(this.forward, keep);
    const changed = back.length !== this.back.length || forward.length !== this.forward.length;
    this.back = back;
    this.forward = forward;
    return changed;
  }
}

/**
 * Takes the nearest place in `from` that would move the window (not `current`, nor its
 * own tab kept as a tab only); `current` goes on `to`.
 */
function step(from: Place[], to: Place[], current: Place | null): Place | null {
  let next = from.pop();
  while (next && current && (samePlace(next, current) || covers(next, current))) next = from.pop();
  if (!next) return null;
  if (current) {
    const last = to[to.length - 1];
    if (!last || !samePlace(last, current)) to.push(current);
  }
  return next;
}

function prune(list: readonly Place[], keep: (tab: string) => boolean): Place[] {
  const out: Place[] = [];
  for (const p of list) {
    if (!keep(p.tab)) continue;
    const last = out[out.length - 1];
    // Neighbours on one tab where one is the tab only: one step, the one with a view.
    if (last && (covers(last, p) || covers(p, last))) out[out.length - 1] = last.view ? last : p;
    else if (!last || !samePlace(last, p)) out.push(p);
  }
  return out;
}

/** `a` is tab `b.tab` only (a document left before it was laid out, or a comparison). */
const covers = (a: Place, b: Place): boolean => !a.view && a.tab === b.tab;

export const samePlace = (a: Place, b: Place): boolean =>
  a.tab === b.tab && (a.view && b.view ? sameView(a.view, b.view) : !a.view && !b.view);

const sameView = (a: ViewEntry, b: ViewEntry): boolean =>
  a.page === b.page &&
  a.scale === b.scale &&
  Math.abs(a.scrollLeft - b.scrollLeft) < 1 &&
  Math.abs(a.scrollTop - b.scrollTop) < 1;
