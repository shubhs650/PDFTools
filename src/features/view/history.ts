// Previous / Next View (§5, M2-10): per document, like a browser's back and
// forward. Every jump (bookmark, link, page box, search result) records the
// view it leaves; going back records the view it leaves on the forward side.
// A new jump after going back drops the forward entries. Pure.

export interface ViewEntry {
  page: number;
  /** Zoom factor in effect. */
  scale: number;
  scrollLeft: number;
  scrollTop: number;
}

export const HISTORY_CAP = 100;

export class ViewHistory {
  private readonly back: ViewEntry[] = [];
  private readonly forward: ViewEntry[] = [];
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
  jump(from: ViewEntry): void {
    const last = this.back[this.back.length - 1];
    if (!last || !same(last, from)) this.back.push(from);
    if (this.back.length > this.cap) this.back.shift();
    this.forward.length = 0;
  }

  /** Previous View: the entry to restore, `current` kept for Next View. */
  goBack(current: ViewEntry): ViewEntry | null {
    const to = this.back.pop();
    if (!to) return null;
    this.forward.push(current);
    return to;
  }

  goForward(current: ViewEntry): ViewEntry | null {
    const to = this.forward.pop();
    if (!to) return null;
    this.back.push(current);
    return to;
  }
}

const same = (a: ViewEntry, b: ViewEntry): boolean =>
  a.page === b.page &&
  a.scale === b.scale &&
  Math.abs(a.scrollLeft - b.scrollLeft) < 1 &&
  Math.abs(a.scrollTop - b.scrollTop) < 1;
