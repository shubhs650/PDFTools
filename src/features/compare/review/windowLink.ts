// Aligned sync and the linked pointer of the Review layout (M12-12, D-62,
// Q21; spike S27's follow.ts as app code). The overlay window, Document A and
// Document B show the same spot of the drawing, through the sheet's
// alignment, at matching zoom: the window the user last touched leads, and
// the others centre the mapped point at the leader's zoom ÷ the map's scale.
// Followers move inside the leader's scroll event, so all windows paint in
// the same frame. A follower held at its scroll limit (a spot near the
// sheet's edge in a larger window) stays there; the linked pointer, a
// crosshair at the same spot in the other windows, is always exact.
//
// Main thread, but only a few rectangles and scroll positions per event
// (S27: 0.1 ms a frame); no pixel work (rule 1).
import type { ScrollCapability } from '@embedpdf/plugin-scroll';
import type { ZoomCapability } from '@embedpdf/plugin-zoom';
import {
  between,
  centreOf,
  followerView,
  mapPoint,
  sameScale,
  scrollFor,
  type Pt,
  type WindowRole,
} from '../../../model/compare/link';
import type { Affine } from '../../../model/compare/material';
import { capability, hostStore } from '../../view/host';

/** A window of the layout: its document, the sheet's page in it and its map into the overlay's frame. */
export interface LinkedWindow {
  role: WindowRole;
  docId: string;
  page: number;
  toRef: Affine;
  /** The window's root element (holds its `.viewport`). */
  host: HTMLElement;
}

interface Laid {
  vp: HTMLElement;
  /** Where the page's top-left corner sits in the scroll content (CSS px). */
  page: { left: number; top: number };
  /** CSS px per point as laid out now. */
  scale: number;
  view: { width: number; height: number };
}

/** The page's displayed size (points): EmbedPDF's page size turned by its rotation. */
function displayedSize(docId: string, page: number): { width: number; height: number } | null {
  const registry = hostStore.getState().registry;
  const doc = registry?.getStore().getState().core.documents[docId];
  const p = doc?.document?.pages[page];
  if (!doc || !p) return null;
  const turned = (p.rotation + doc.rotation) % 2 === 1;
  return turned ? { width: p.size.height, height: p.size.width } : p.size;
}

function zoomCap(): ZoomCapability | null {
  const registry = hostStore.getState().registry;
  return registry ? capability<ZoomCapability>(registry, 'zoom') : null;
}

function scrollCap(): ScrollCapability | null {
  const registry = hostStore.getState().registry;
  return registry ? capability<ScrollCapability>(registry, 'scroll') : null;
}

/** The window's page as it is laid out now, or null when it is not on screen yet. */
function laidOut(w: LinkedWindow): Laid | null {
  const vp = w.host.querySelector<HTMLElement>('.viewport');
  const el = vp?.querySelector<HTMLElement>(`.page[data-page="${String(w.page)}"]`);
  const size = displayedSize(w.docId, w.page);
  if (!vp || !el || !size || size.width <= 0) return null;
  const v = vp.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (r.width <= 0) return null;
  return {
    vp,
    page: { left: r.left - v.left + vp.scrollLeft, top: r.top - v.top + vp.scrollTop },
    scale: r.width / size.width,
    view: { width: vp.clientWidth, height: vp.clientHeight },
  };
}

/** The page point under a client position in a window, or null off its page. */
export function pagePointAt(w: LinkedWindow, clientX: number, clientY: number): Pt | null {
  const l = laidOut(w);
  if (!l) return null;
  const v = l.vp.getBoundingClientRect();
  const x = (clientX - v.left + l.vp.scrollLeft - l.page.left) / l.scale;
  const y = (clientY - v.top + l.vp.scrollTop - l.page.top) / l.scale;
  const size = displayedSize(w.docId, w.page);
  if (!size || x < 0 || y < 0 || x > size.width || y > size.height) return null;
  return { x, y };
}

/** The page point under the centre of a window, and its zoom as laid out. */
export function windowCentre(w: LinkedWindow): { centre: Pt; scale: number } | null {
  const l = laidOut(w);
  if (!l) return null;
  return {
    centre: centreOf({ left: l.vp.scrollLeft, top: l.vp.scrollTop }, l.scale, l.page, l.view),
    scale: l.scale,
  };
}

/**
 * The spot a leading window shows: the centre of the part of its sheet in view
 * (the sheet's centre when it fits the window whole), and its zoom as laid out.
 */
export function shownCentre(w: LinkedWindow): { centre: Pt; scale: number } | null {
  const l = laidOut(w);
  const size = displayedSize(w.docId, w.page);
  if (!l || !size) return null;
  const x0 = Math.max(l.vp.scrollLeft, l.page.left);
  const x1 = Math.min(l.vp.scrollLeft + l.view.width, l.page.left + size.width * l.scale);
  const y0 = Math.max(l.vp.scrollTop, l.page.top);
  const y1 = Math.min(l.vp.scrollTop + l.view.height, l.page.top + size.height * l.scale);
  if (x1 <= x0 || y1 <= y0) return windowCentre(w);
  return {
    centre: {
      x: ((x0 + x1) / 2 - l.page.left) / l.scale,
      y: ((y0 + y1) / 2 - l.page.top) / l.scale,
    },
    scale: l.scale,
  };
}

/** Scrolls a window so page point `p` is under its centre (sync, no smooth scrolling). */
export function centreWindowOn(w: LinkedWindow, p: Pt): void {
  const l = laidOut(w);
  if (!l) return;
  const s = scrollFor(p, l.scale, l.page, l.view);
  l.vp.scrollLeft = s.left;
  l.vp.scrollTop = s.top;
}

export interface LinkStats {
  drives: number;
  /** Time spent in drive() (ms), the main-thread cost of the link. */
  lastMs: number;
}

/**
 * The link between the windows of one comparison's Review layout. `enabled`
 * is the lock (on by default, D-62); the pointer link works either way.
 */
export class WindowLink {
  private windows = new Map<WindowRole, LinkedWindow>();
  private readonly offs: (() => void)[] = [];
  private leader: WindowRole | null = null;
  private pending: WindowRole | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly zooming = new Set<WindowRole>();
  private readonly crosshairs = new Map<WindowRole, HTMLElement>();
  enabled = true;

  /** The lock: with it off, no window follows another. */
  setEnabled(on: boolean): void {
    this.enabled = on;
  }
  readonly stats: LinkStats = { drives: 0, lastMs: 0 };

  /** The windows on screen now (their documents, pages and maps); listeners follow them. */
  setWindows(list: readonly LinkedWindow[]): void {
    this.detach();
    const zoom = zoomCap();
    for (const w of list) {
      this.windows.set(w.role, w);
      const vp = w.host.querySelector<HTMLElement>('.viewport');
      if (vp) {
        const onScroll = (): void => {
          if (this.enabled && this.leader === w.role) this.driveSoon(w.role);
          this.hidePointer();
        };
        vp.addEventListener('scroll', onScroll, { passive: true });
        this.offs.push(() => {
          vp.removeEventListener('scroll', onScroll);
        });
      }
      // The leader zoomed: drive once its page is laid out at the new scale.
      if (zoom)
        this.offs.push(
          zoom.forDocument(w.docId).onStateChange(() => {
            if (this.enabled && this.leader === w.role) this.driveSoon(w.role);
          }),
        );
    }
  }

  /**
   * Drives in a task of its own (coalesced): the leader's own scroll or zoom
   * update and the followers' never share one main-thread task (rule 1).
   */
  driveSoon(role: WindowRole): void {
    this.pending = role;
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const r = this.pending;
      this.pending = null;
      if (r && this.enabled) this.drive(r);
    }, 0);
  }

  detach(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.windows.clear();
    this.zooming.clear();
  }

  get leaderRole(): WindowRole | null {
    return this.leader;
  }

  /** The window the user is working in (a press, the wheel, a key or the focus). */
  lead(role: WindowRole): void {
    this.leader = role;
  }

  window(role: WindowRole): LinkedWindow | undefined {
    return this.windows.get(role);
  }

  /** `from`'s page points → `to`'s. */
  map(from: WindowRole, to: WindowRole): Affine | null {
    const a = this.windows.get(from);
    const b = this.windows.get(to);
    return a && b ? between(a.toRef, b.toRef) : null;
  }

  /**
   * Moves every other window to `role`'s spot. A window in the middle of a zoom
   * (its laid-out scale is not yet the plugin's) is retried on the next frame; a
   * follower whose zoom must change is zoomed first and centred once laid out;
   * one follower zooms per task (a zoom re-lays out its whole window), the next
   * in the task after.
   */
  drive(role: WindowRole, tries = 30): void {
    const t0 = performance.now();
    const lead = this.windows.get(role);
    const here = lead ? shownCentre(lead) : null;
    const zoom = zoomCap();
    if (!lead || !here || !zoom) return;
    const target = zoom.forDocument(lead.docId).getState().currentZoomLevel;
    if (!sameScale(here.scale, target)) {
      if (tries > 0)
        requestAnimationFrame(() => {
          this.drive(role, tries - 1);
        });
      return;
    }
    let zoomed = false;
    let more = false;
    for (const [other, w] of this.windows) {
      if (other === role) continue;
      const m = this.map(role, other);
      const now = windowCentre(w);
      if (!m || !now) continue;
      const want = followerView(m, here.centre, here.scale);
      if (sameScale(want.scale, now.scale)) {
        centreWindowOn(w, want.centre);
        continue;
      }
      if (this.zooming.has(other)) continue;
      if (zoomed) {
        more = true;
        continue;
      }
      zoomed = true;
      this.zooming.add(other);
      zoom.forDocument(w.docId).requestZoom(want.scale);
      const land = (n: number): void => {
        const at = windowCentre(w);
        if ((at && sameScale(at.scale, want.scale)) || n === 0) {
          this.zooming.delete(other);
          const lead2 = this.leader;
          if (lead2 && this.enabled) this.driveSoon(lead2);
          return;
        }
        requestAnimationFrame(() => {
          land(n - 1);
        });
      };
      requestAnimationFrame(() => {
        land(60);
      });
    }
    if (more) this.driveSoon(role);
    this.stats.drives++;
    this.stats.lastMs = performance.now() - t0;
  }

  /** A window's crosshair element (drawn by the window, placed here). */
  setCrosshair(role: WindowRole, el: HTMLElement | null): void {
    if (el) this.crosshairs.set(role, el);
    else this.crosshairs.delete(role);
  }

  /** The pointer moved over `role`'s page: a crosshair at the same spot in the other windows. */
  pointer(role: WindowRole, clientX: number, clientY: number): void {
    const from = this.windows.get(role);
    const p = from ? pagePointAt(from, clientX, clientY) : null;
    for (const [other, el] of this.crosshairs) {
      const w = this.windows.get(other);
      const m = this.map(role, other);
      const l = w ? laidOut(w) : null;
      if (other === role || !p || !m || !l) {
        el.hidden = true;
        continue;
      }
      const q = mapPoint(m, p);
      const v = l.vp.getBoundingClientRect();
      // The mark's window (its parent): offsetParent is null while the mark is hidden.
      const host = el.parentElement?.getBoundingClientRect() ?? v;
      const x = v.left - host.left + l.page.left - l.vp.scrollLeft + q.x * l.scale;
      const y = v.top - host.top + l.page.top - l.vp.scrollTop + q.y * l.scale;
      const inside = x >= 0 && y >= 0 && x <= l.view.width && y <= l.view.height;
      el.hidden = !inside;
      if (inside) el.style.transform = `translate(${String(x)}px, ${String(y)}px)`;
    }
  }

  hidePointer(): void {
    for (const el of this.crosshairs.values()) el.hidden = true;
  }
}

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });

/**
 * Waits until the window's page is laid out at the zoom its document is set to
 * (up to about two seconds); false when it never is (the window went away).
 */
export async function settled(w: LinkedWindow, frames = 120): Promise<boolean> {
  const zoom = zoomCap();
  for (let i = 0; i < frames; i++) {
    const c = windowCentre(w);
    const want = zoom?.forDocument(w.docId).getState().currentZoomLevel;
    if (c && want !== undefined && sameScale(c.scale, want)) return true;
    await nextFrame();
  }
  return false;
}

/** Room left around a fitted sheet (CSS px). */
const FIT_MARGIN = 16;

/** The zoom that fits the window's sheet: the whole page, or its width. */
export function fitScale(w: LinkedWindow, mode: 'page' | 'width'): number | null {
  const vp = w.host.querySelector<HTMLElement>('.viewport');
  const size = displayedSize(w.docId, w.page);
  if (!vp || !size || vp.clientWidth <= 0 || vp.clientHeight <= 0) return null;
  const sw = Math.max(1, vp.clientWidth - 2 * FIT_MARGIN) / size.width;
  const sh = Math.max(1, vp.clientHeight - 2 * FIT_MARGIN) / size.height;
  return mode === 'width' ? sw : Math.min(sw, sh);
}

/**
 * Shows the window's sheet fitted (the page, or its width from the top), once
 * the page is laid out. Resolves false when the window is not ready.
 */
export async function fitWindow(w: LinkedWindow, mode: 'page' | 'width'): Promise<boolean> {
  if (!(await settled(w))) return false;
  const z = fitScale(w, mode);
  const zoom = zoomCap();
  const size = displayedSize(w.docId, w.page);
  if (z === null || !zoom || !size) return false;
  zoom.forDocument(w.docId).requestZoom(z);
  if (!(await settled(w))) return false;
  const c = windowCentre(w);
  const vp = w.host.querySelector<HTMLElement>('.viewport');
  const top = c && vp ? Math.min(size.height / 2, vp.clientHeight / 2 / c.scale) : size.height / 2;
  centreWindowOn(w, { x: size.width / 2, y: mode === 'width' ? top : size.height / 2 });
  return true;
}

/** Whether the window's page is laid out and inside its view. */
function inView(w: LinkedWindow): boolean {
  const l = laidOut(w);
  if (!l) return false;
  const el = l.vp.querySelector<HTMLElement>(`.page[data-page="${String(w.page)}"]`);
  if (!el) return false;
  const v = l.vp.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return r.bottom > v.top && r.top < v.bottom && r.right > v.left && r.left < v.right;
}

/**
 * Brings the window's sheet page into its view (a window shows one page; the
 * document scrolls to it when the sheet changes). False after about two
 * seconds without it (the window went away).
 */
export async function showPage(w: LinkedWindow, frames = 120): Promise<boolean> {
  for (let i = 0; i < frames; i++) {
    if (!w.host.isConnected) return false;
    if (inView(w)) return true;
    if (i % 10 === 0)
      try {
        scrollCap()
          ?.forDocument(w.docId)
          .scrollToPage({ pageNumber: w.page + 1, behavior: 'instant' });
      } catch {
        // Its viewport is not registered yet: try again on a later frame.
      }
    await nextFrame();
  }
  return false;
}
