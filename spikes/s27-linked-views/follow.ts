// Spike S27 (M12-02): one view drives others through a transform (D-62
// "aligned sync"). The leader is the window the user last touched; its scroll
// and zoom move the followers to the same spot of the drawing at the matching
// zoom. Followers are moved synchronously in the leader's scroll event, so all
// windows paint in the same frame.
import type { ZoomCapability } from '@embedpdf/plugin-zoom';
import type { PluginRegistry } from '@embedpdf/core';
import { capability, hostStore } from '../../src/features/view/host';
import { followerView, invert, type Affine, type Pt } from './link.ts';

interface PageBox {
  vp: HTMLElement;
  content: HTMLElement;
  size: { width: number; height: number };
}

const registry = (): PluginRegistry => {
  const r = hostStore.getState().registry;
  if (!r) throw new Error('no registry');
  return r;
};

/** The page size in points (EmbedPDF's core state), unrotated. */
export function pageSize(docId: string, page = 0): { width: number; height: number } | null {
  const core = registry().getStore().getState().core;
  return core.documents[docId]?.document?.pages[page]?.size ?? null;
}

function pageBox(docId: string, page = 0): PageBox | null {
  const vp = document.querySelector<HTMLElement>(`[data-s27-doc="${docId}"] .viewport`);
  const content = vp?.querySelector<HTMLElement>(`[data-page="${String(page)}"] .page-content`);
  const size = pageSize(docId, page);
  return vp && content && size ? { vp, content, size } : null;
}

/** The page point under the centre of a window, and the zoom it is shown at. */
export function viewCentre(docId: string, page = 0): { centre: Pt; scale: number } | null {
  const b = pageBox(docId, page);
  if (!b) return null;
  const v = b.vp.getBoundingClientRect();
  const c = b.content.getBoundingClientRect();
  const scale = c.width / b.size.width;
  return {
    centre: {
      x: (v.left + b.vp.clientWidth / 2 - c.left) / scale,
      y: (v.top + b.vp.clientHeight / 2 - c.top) / scale,
    },
    scale,
  };
}

/** Scrolls a window so `p` (page point) is under its centre. Sync. */
export function centreOn(docId: string, p: Pt, page = 0): void {
  const b = pageBox(docId, page);
  if (!b) return;
  const v = b.vp.getBoundingClientRect();
  const c = b.content.getBoundingClientRect();
  const scale = c.width / b.size.width;
  b.vp.scrollLeft += c.left + p.x * scale - (v.left + b.vp.clientWidth / 2);
  b.vp.scrollTop += c.top + p.y * scale - (v.top + b.vp.clientHeight / 2);
}

export interface LinkStats {
  drives: number;
  zooms: number;
  /** Time spent in drive() (ms), the main-thread cost of the link. */
  driveMs: number[];
}

export class Linker {
  /** Each document's transform into the reference frame (the overlay's, here Document B's). */
  private readonly toRef = new Map<string, Affine>();
  private readonly offs: (() => void)[] = [];
  private leader: string | null = null;
  private readonly zooming = new Set<string>();
  enabled = true;
  readonly stats: LinkStats = { drives: 0, zooms: 0, driveMs: [] };

  /** `frames`: each linked document's page coordinates → the reference frame. */
  attach(frames: Record<string, Affine>): void {
    this.detach();
    const zoom = capability<ZoomCapability>(registry(), 'zoom');
    for (const [id, m] of Object.entries(frames)) {
      this.toRef.set(id, m);
      const vp = document.querySelector<HTMLElement>(`[data-s27-doc="${id}"] .viewport`);
      if (!vp) throw new Error(`no window for ${id}`);
      const onScroll = (): void => {
        if (this.enabled && this.leader === id) this.drive(id);
      };
      vp.addEventListener('scroll', onScroll, { passive: true });
      this.offs.push(() => {
        vp.removeEventListener('scroll', onScroll);
      });
      // The leader zoomed: drive once its pages are laid out at the new scale.
      this.offs.push(
        zoom.forDocument(id).onStateChange(() => {
          if (this.enabled && this.leader === id) this.drive(id);
        }),
      );
    }
  }

  detach(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.toRef.clear();
    this.zooming.clear();
  }

  /** The window the user is working in (pointer down, wheel, key or focus). */
  lead(id: string): void {
    if (this.toRef.has(id)) this.leader = id;
  }

  get leaderId(): string | null {
    return this.leader;
  }

  /** leader page point → follower page point. */
  map(from: string, to: string): Affine {
    const a = this.toRef.get(from);
    const b = this.toRef.get(to);
    if (!a || !b) throw new Error('not linked');
    const inv = invert(b);
    // to ← ref ← from
    return {
      a: inv.a * a.a + inv.c * a.b,
      b: inv.b * a.a + inv.d * a.b,
      c: inv.a * a.c + inv.c * a.d,
      d: inv.b * a.c + inv.d * a.d,
      e: inv.a * a.e + inv.c * a.f + inv.e,
      f: inv.b * a.e + inv.d * a.f + inv.f,
    };
  }

  /**
   * Moves every follower to the leader's spot. A window in the middle of a
   * zoom (the plugin's scale is not yet the laid-out one) is retried on the
   * next frame; a follower whose zoom must change is zoomed first and centred
   * once its layout has the new scale.
   */
  drive(id: string, tries = 30): void {
    const t0 = performance.now();
    const here = viewCentre(id);
    if (!here) return;
    const zoom = capability<ZoomCapability>(registry(), 'zoom');
    const target = zoom.forDocument(id).getState().currentZoomLevel;
    if (!sameScale(here.scale, target)) {
      if (tries > 0)
        requestAnimationFrame(() => {
          this.drive(id, tries - 1);
        });
      return;
    }
    for (const other of this.toRef.keys()) {
      if (other === id) continue;
      const want = followerView(this.map(id, other), here.centre, here.scale);
      const now = viewCentre(other);
      if (!now) continue;
      if (sameScale(want.scale, now.scale)) {
        centreOn(other, want.centre);
        continue;
      }
      if (this.zooming.has(other)) continue;
      this.zooming.add(other);
      this.stats.zooms++;
      zoom.forDocument(other).requestZoom(want.scale);
      const land = (n: number): void => {
        const at = viewCentre(other);
        if ((at && sameScale(at.scale, want.scale)) || n === 0) {
          this.zooming.delete(other);
          if (this.leader) this.drive(this.leader);
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
    this.stats.drives++;
    this.stats.driveMs.push(performance.now() - t0);
  }
}

/** The zoom plugin floors levels to 0.001: equal within that and 0.2 %. */
export function sameScale(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.0015, 0.002 * b);
}
