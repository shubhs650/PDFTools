// Content sync between a text comparison's two windows (M12-19, D-64, Q32).
// Each window shows its whole document in continuous scroll; the window the
// user last touched leads, and the other scrolls so the place matching the
// leader's centre (through the sync curve, textView.ts) sits at its centre,
// inside the leader's scroll event, so both paint in the same frame. With
// sync on, the follower also takes the leader's zoom. Clicking an entry
// centres the change on both sides.
//
// Main thread, but only a handful of numbers per scroll event (binary
// searches on the curve, one rectangle read per window); no text work
// (rule 1).
import type { ScrollCapability } from '@embedpdf/plugin-scroll';
import type { ZoomCapability } from '@embedpdf/plugin-zoom';
import { sameScale } from '../../../model/compare/link';
import {
  entryPlaces,
  mapAlong,
  syncCurve,
  type ChangeEntry,
  type PageOf,
  type PageStack,
  type Side,
  type StackSpan,
  type SyncCurve,
} from '../../../model/compare/textView';
import { capability, hostStore } from '../../view/host';

export interface TextWindowRef {
  side: Side;
  docId: string;
  /** The window's root element (holds its `.viewport`). */
  host: HTMLElement;
}

/** A window as laid out now. */
export interface Laid {
  vp: HTMLElement;
  /** CSS px per pt. */
  scale: number;
  /** Where the stack's top sits in the scroll content (CSS px). */
  off: number;
}

const other = (s: Side): Side => (s === 'a' ? 'b' : 'a');

function zoomCap(): ZoomCapability | null {
  const registry = hostStore.getState().registry;
  return registry ? capability<ZoomCapability>(registry, 'zoom') : null;
}

function scrollCap(): ScrollCapability | null {
  const registry = hostStore.getState().registry;
  return registry ? capability<ScrollCapability>(registry, 'scroll') : null;
}

/**
 * Where a document's pages sit one under the other (pt), from the scroll
 * plugin's layout (every page, laid out or not); null before its layout.
 */
export function stackOf(docId: string): PageStack | null {
  try {
    const layout = scrollCap()?.forDocument(docId).getLayout();
    if (!layout || layout.virtualItems.length === 0) return null;
    const tops: number[] = [];
    const heights: number[] = [];
    for (const item of layout.virtualItems)
      for (const p of item.pageLayouts) {
        tops[p.pageIndex] = item.y + p.y;
        heights[p.pageIndex] = p.rotatedHeight;
      }
    return { tops, heights };
  } catch {
    return null; // not registered yet
  }
}

/** The window's scale and the stack's place in its scroll content, read off a page on screen. */
export function laidOut(w: TextWindowRef, stack: PageStack): Laid | null {
  const vp = w.host.querySelector<HTMLElement>('.viewport');
  const el = vp?.querySelector<HTMLElement>('.page[data-page]');
  if (!vp || !el) return null;
  const i = Number(el.dataset['page']);
  const top = stack.tops[i];
  const h = stack.heights[i];
  if (top === undefined || !h) return null;
  const r = el.getBoundingClientRect();
  if (r.height <= 0) return null;
  const v = vp.getBoundingClientRect();
  const scale = r.height / h;
  return { vp, scale, off: r.top - v.top + vp.scrollTop - top * scale };
}

/** The stack place at the window's centre. */
export function centreOf(l: Laid): number {
  return (l.vp.scrollTop + l.vp.clientHeight / 2 - l.off) / l.scale;
}

/** Scrolls so stack place `g` is at the window's centre (or `at`, a share of its height). */
export function scrollToPlace(l: Laid, g: number, at = 0.5): void {
  const top = l.off + g * l.scale - l.vp.clientHeight * at;
  if (Math.abs(l.vp.scrollTop - top) > 0.5) l.vp.scrollTop = Math.max(0, top);
}

export interface TextLinkStats {
  drives: number;
  /** Time spent in the last drive (ms), the main-thread cost of the sync. */
  lastMs: number;
}

/** What the link needs of a result: its sync points, its entries and the side pages' documents pages. */
export interface TextLinkModel {
  sync: Float32Array;
  entries: readonly ChangeEntry[];
  pageOf: Record<Side, PageOf>;
}

/** The model in the windows' stacks: the sync curve and each entry's place on both sides. */
export interface Placed {
  curve: SyncCurve;
  places: (Record<Side, StackSpan> | null)[];
}

const NO_CURVE: SyncCurve = { a: new Float64Array(), b: new Float64Array() };

/** The link between the two windows of one text comparison. */
export class TextLink {
  private readonly windows = new Map<Side, TextWindowRef>();
  private readonly offs: (() => void)[] = [];
  private leader: Side | null = null;
  private model: TextLinkModel | null = null;
  private placed: Placed | null = null;
  private readonly stacks = new Map<Side, PageStack>();
  private quietUntil = 0;
  /** A's half of a centring, on the next frame. */
  private pending = 0;
  private readonly listeners = new Set<() => void>();
  private frame = 0;
  private enabled = true;
  readonly stats: TextLinkStats = { drives: 0, lastMs: 0 };

  /** Sync on or off (D-64: a switch turns it off). */
  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  /** A new result (or the first): the curve and the places are worked out again when needed. */
  setModel(model: TextLinkModel | null): void {
    this.model = model;
    this.placed = null;
    this.refresh();
  }

  /** The curve and the entries' places in the current stacks, or null before both are laid out. */
  located(): Placed | null {
    if (this.placed) return this.placed;
    const a = this.stack('a');
    const b = this.stack('b');
    const m = this.model;
    if (!a || !b || !m) return null;
    const stacks = { a, b };
    const curve = syncCurve(m.sync, stacks, m.pageOf);
    this.placed = {
      curve,
      places: m.entries.map((e) => entryPlaces(e.change, stacks, m.pageOf, curve)),
    };
    return this.placed;
  }

  /** A window's page stack (pt), read from the scroll plugin and kept until its layout changes. */
  stack(side: Side): PageStack | null {
    const have = this.stacks.get(side);
    if (have) return have;
    const w = this.windows.get(side);
    const s = w ? stackOf(w.docId) : null;
    if (s) this.stacks.set(side, s);
    return s;
  }

  laid(side: Side): Laid | null {
    const w = this.windows.get(side);
    const s = this.stack(side);
    return w && s ? laidOut(w, s) : null;
  }

  /** Called after either window scrolls or zooms (once a frame): the bands redraw. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Redraws what follows the windows (the bands) on the next frame. */
  refresh(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      for (const fn of this.listeners) fn();
    });
  }

  setWindows(list: readonly TextWindowRef[]): void {
    this.detach();
    const zoom = zoomCap();
    const scroll = scrollCap();
    for (const w of list) {
      this.windows.set(w.side, w);
      const vp = w.host.querySelector<HTMLElement>('.viewport');
      if (vp) {
        const onScroll = (): void => {
          if (this.enabled && this.leader === w.side && performance.now() >= this.quietUntil)
            this.drive(w.side);
          this.refresh();
        };
        vp.addEventListener('scroll', onScroll, { passive: true });
        this.offs.push(() => {
          vp.removeEventListener('scroll', onScroll);
        });
      }
      if (scroll)
        this.offs.push(
          scroll.forDocument(w.docId).onLayoutChange(() => {
            this.stacks.delete(w.side);
            this.placed = null;
            this.refresh();
          }),
        );
      if (zoom)
        this.offs.push(
          zoom.forDocument(w.docId).onStateChange((state) => {
            this.refresh();
            if (!this.enabled || this.leader !== w.side) return;
            // The other window takes the leader's zoom, then its place.
            const o = this.windows.get(other(w.side));
            const level = state.currentZoomLevel;
            if (o) {
              const theirs = zoom.forDocument(o.docId).getState().currentZoomLevel;
              if (!sameScale(theirs, level)) zoom.forDocument(o.docId).requestZoom(level);
            }
            this.settle(w.side);
          }),
        );
    }
  }

  detach(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.windows.clear();
    this.stacks.clear();
    this.placed = null;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  get leaderSide(): Side | null {
    return this.leader;
  }

  /** The window the user is working in (a press, the wheel, a key or the focus). */
  lead(side: Side): void {
    this.leader = side;
  }

  /** Drives the follower once both windows are laid out at their zoom (up to about a second). */
  private settle(side: Side, tries = 60): void {
    const zoom = zoomCap();
    const ok = (s: Side): boolean => {
      const w = this.windows.get(s);
      const l = this.laid(s);
      return (
        !!w &&
        !!l &&
        !!zoom &&
        sameScale(l.scale, zoom.forDocument(w.docId).getState().currentZoomLevel)
      );
    };
    if (ok('a') && ok('b')) {
      this.drive(side);
      this.refresh();
      return;
    }
    if (tries > 0)
      requestAnimationFrame(() => {
        this.settle(side, tries - 1);
      });
  }

  /** Moves the other window to the place matching `side`'s centre. */
  drive(side: Side): void {
    const t0 = performance.now();
    const lead = this.laid(side);
    const follow = this.laid(other(side));
    if (!lead || !follow) return;
    const curve = this.located()?.curve ?? NO_CURVE;
    scrollToPlace(follow, mapAlong(curve, side, centreOf(lead)));
    this.stats.drives++;
    this.stats.lastMs = performance.now() - t0;
  }

  /**
   * Centres a change on both sides (its own text on each, D-64), a sixth of
   * the way down when it is tall; the windows do not follow each other for
   * these scrolls. B moves first and A on the next frame: a jump far down
   * both documents lays out new pages in each, and two at once would be one
   * long main-thread task (rule 1).
   */
  centreOn(places: Record<Side, StackSpan>): void {
    this.quietUntil = performance.now() + 250;
    const go = (side: Side): void => {
      const l = this.laid(side);
      const p = places[side];
      if (!l) return;
      const tall = (p.bottom - p.top) * l.scale > l.vp.clientHeight * 0.6;
      scrollToPlace(l, tall ? p.top : (p.top + p.bottom) / 2, tall ? 0.15 : 0.5);
    };
    go('b');
    if (this.pending) cancelAnimationFrame(this.pending);
    this.pending = requestAnimationFrame(() => {
      this.pending = 0;
      this.quietUntil = performance.now() + 150;
      go('a');
      this.refresh();
    });
    this.refresh();
  }

  /** Centres entry `id` on both sides; false when the windows are not laid out yet. */
  centreEntry(id: number): boolean {
    const p = this.located()?.places[id];
    if (!p) return false;
    this.centreOn(p);
    return true;
  }

  /** Both windows at the top of their documents. */
  toTop(): void {
    for (const side of ['a', 'b'] as const) {
      const l = this.laid(side);
      if (l) l.vp.scrollTop = 0;
    }
    this.refresh();
  }
}

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });

/**
 * Fits the window's document to its width once a page is laid out, at the
 * top of the document. False after about two seconds without it.
 */
export async function fitWidth(w: TextWindowRef, frames = 120): Promise<boolean> {
  for (let i = 0; i < frames; i++) {
    if (!w.host.isConnected) return false;
    const stack = stackOf(w.docId);
    const l = stack ? laidOut(w, stack) : null;
    const zoom = zoomCap();
    if (stack && l && zoom) {
      const widest = Math.max(
        1,
        ...[...l.vp.querySelectorAll<HTMLElement>('.page[data-page]')].map(
          (el) => el.getBoundingClientRect().width / l.scale,
        ),
      );
      const z = Math.max(0.1, (l.vp.clientWidth - 32) / widest);
      zoom.forDocument(w.docId).requestZoom(z);
      for (let k = 0; k < 60; k++) {
        await nextFrame();
        const now = laidOut(w, stack);
        if (now && sameScale(now.scale, zoom.forDocument(w.docId).getState().currentZoomLevel)) {
          now.vp.scrollTop = 0;
          return true;
        }
      }
      return false;
    }
    await nextFrame();
  }
  return false;
}

/** The links of the text comparisons on screen (the list centres entries through them). */
export const textLinks = new Map<string, TextLink>();

export const textLinkOf = (id: string): TextLink | undefined => textLinks.get(id);
