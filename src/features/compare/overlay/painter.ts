// Places the overlay's tiles (M12-11, D-59, rule 1): the main thread only
// works out which tiles the view needs, asks the Render worker for them and
// puts the bitmaps it gets back on screen, one canvas per tile
// (`bitmaprenderer`: no pixel work here). Tiles are drawn centre first; a
// zoom, a sheet or a style the view has left cancels its requests. While new
// tiles arrive, the previous ones stay visible (scaled when the zoom changed),
// so the window never flashes blank.
import { isAbortError } from '../../../engine/errors';
import type { OverlayTileRequest } from '../../../workers/render/overlayTiles';
import { CSS_PER_PT, sheetPixels, visibleTiles } from '../../../model/compare/overlayView';

/** What the tiles are drawn from, apart from the position. */
export type TileContent = Omit<OverlayTileRequest, 'scale' | 'x' | 'y' | 'width' | 'height'>;

/** Canvases kept beyond the visible ones (panning back finds them). */
const SPARE_TILES = 24;

export interface TileJob {
  promise: Promise<{ bitmap: ImageBitmap; cachedBytes: number }>;
  cancel(): void;
}

export type RequestTile = (req: OverlayTileRequest) => TileJob;

interface Layer {
  el: HTMLDivElement;
  /** Device pixels per point the layer's tiles were drawn at. */
  scale: number;
  dpr: number;
  contentKey: string;
  tiles: Map<string, HTMLCanvasElement>;
  pending: Map<string, TileJob>;
}

export interface PainterStats {
  /** Tiles of the current state on screen, and still wanted. */
  drawn: number;
  wanted: number;
  /** Every visible tile of the current state is drawn. */
  complete: boolean;
  /** The state these numbers are about: the zoom and the content key. */
  zoom: number;
  contentKey: string;
  cachedBytes: number;
}

export class OverlayPainter {
  private readonly view: HTMLElement;
  private readonly sheet: HTMLElement;
  private readonly request: RequestTile;
  private layers: Layer[] = [];
  private size = { width: 0, height: 0 };
  private zoom = 1;
  private content: TileContent | null = null;
  private contentKey = '';
  private wanted = 0;
  private cachedBytes = 0;
  private frame = 0;
  private disposed = false;
  private readonly onChange: (s: PainterStats) => void;

  constructor(
    view: HTMLElement,
    sheet: HTMLElement,
    request: RequestTile,
    onChange: (s: PainterStats) => void = () => undefined,
  ) {
    this.view = view;
    this.sheet = sheet;
    this.request = request;
    this.onChange = onChange;
  }

  /** The sheet (points) and what its tiles show; a new key draws every tile anew. */
  setContent(size: { width: number; height: number }, content: TileContent): void {
    this.size = size;
    this.content = content;
    this.contentKey = JSON.stringify([size, content]);
    this.layout();
    this.schedule();
  }

  setZoom(zoom: number): void {
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    this.layout();
    this.schedule();
  }

  /** The view scrolled or changed size. */
  viewChanged(): void {
    this.schedule();
  }

  /** The sheet's size in CSS pixels at the current zoom. */
  cssSize(): { width: number; height: number } {
    const k = this.zoom * CSS_PER_PT;
    return { width: this.size.width * k, height: this.size.height * k };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    for (const l of this.layers) this.removeLayer(l);
    this.layers = [];
  }

  stats(): PainterStats {
    const top = this.current();
    const drawn = top ? top.tiles.size : 0;
    return {
      drawn,
      wanted: this.wanted,
      complete: !!top && top.pending.size === 0 && this.wanted > 0 && this.missing(top) === 0,
      cachedBytes: this.cachedBytes,
      zoom: this.zoom,
      contentKey: this.contentKey,
    };
  }

  private layout(): void {
    const { width, height } = this.cssSize();
    this.sheet.style.width = `${String(Math.round(width))}px`;
    this.sheet.style.height = `${String(Math.round(height))}px`;
    // Older layers keep their tiles, scaled to the new zoom until new ones cover them.
    for (const l of this.layers) {
      const k = (this.scale() / l.scale) * (l.dpr / this.dpr());
      l.el.style.transform = k === 1 ? '' : `scale(${String(k)})`;
    }
  }

  private dpr(): number {
    return window.devicePixelRatio || 1;
  }

  /** Device pixels per point. */
  private scale(): number {
    return this.zoom * CSS_PER_PT * this.dpr();
  }

  private schedule(): void {
    if (this.disposed) return;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      this.refresh();
    });
  }

  private current(): Layer | undefined {
    const top = this.layers[this.layers.length - 1];
    return top?.scale === this.scale() && top.contentKey === this.contentKey ? top : undefined;
  }

  private visible(): ReturnType<typeof visibleTiles> {
    const dpr = this.dpr();
    const v = this.view.getBoundingClientRect();
    const s = this.sheet.getBoundingClientRect();
    const px = sheetPixels(this.size.width, this.size.height, this.scale());
    return visibleTiles(px.w, px.h, {
      x: (v.left - s.left) * dpr,
      y: (v.top - s.top) * dpr,
      w: v.width * dpr,
      h: v.height * dpr,
    });
  }

  private missing(layer: Layer): number {
    return this.visible().filter((t) => !layer.tiles.has(t.key)).length;
  }

  private refresh(): void {
    if (this.disposed || !this.content || this.size.width <= 0) return;
    let layer = this.current();
    if (!layer) {
      // A new zoom or content: older requests are no longer wanted, and only the
      // fullest older layer stays to cover the view until the new tiles are in
      // (a zoom gesture would otherwise stack a scaled layer per step).
      const keepOld = this.layers.reduce<Layer | null>(
        (best, l) => (l.tiles.size > (best?.tiles.size ?? 0) ? l : best),
        null,
      );
      for (const l of this.layers) if (l !== keepOld) this.removeLayer(l);
      this.layers = keepOld ? [keepOld] : [];
      if (keepOld) this.cancelPending(keepOld);
      const el = document.createElement('div');
      el.className = 'overlay-tiles';
      this.sheet.appendChild(el);
      layer = {
        el,
        scale: this.scale(),
        dpr: this.dpr(),
        contentKey: this.contentKey,
        tiles: new Map(),
        pending: new Map(),
      };
      this.layers.push(layer);
    }
    const tiles = this.visible();
    const keep = new Set(tiles.map((t) => t.key));
    this.wanted = tiles.length;
    // Requests for tiles scrolled out of view go; so do their canvases, past a few spare.
    for (const [k, job] of layer.pending)
      if (!keep.has(k)) {
        job.cancel();
        layer.pending.delete(k);
      }
    if (layer.tiles.size > keep.size + SPARE_TILES)
      for (const [k, c] of layer.tiles)
        if (!keep.has(k)) {
          c.remove();
          layer.tiles.delete(k);
        }
    const content = this.content;
    const l = layer;
    for (const t of tiles) {
      if (l.tiles.has(t.key) || l.pending.has(t.key)) continue;
      const job = this.request({
        ...content,
        scale: l.scale,
        x: t.x,
        y: t.y,
        width: t.w,
        height: t.h,
      });
      l.pending.set(t.key, job);
      job.promise.then(
        ({ bitmap, cachedBytes }) => {
          l.pending.delete(t.key);
          this.cachedBytes = cachedBytes;
          if (this.disposed || !this.layers.includes(l)) {
            bitmap.close();
            return;
          }
          this.place(l, t, bitmap);
          this.settle();
        },
        (err: unknown) => {
          l.pending.delete(t.key);
          if (!isAbortError(err)) console.warn('overlay tile failed', (err as Error).name);
          this.settle();
        },
      );
    }
    this.settle();
  }

  private place(
    l: Layer,
    t: { key: string; x: number; y: number; w: number; h: number },
    bitmap: ImageBitmap,
  ): void {
    const c = document.createElement('canvas');
    c.width = bitmap.width;
    c.height = bitmap.height;
    c.className = 'overlay-tile';
    c.style.left = `${String(t.x / l.dpr)}px`;
    c.style.top = `${String(t.y / l.dpr)}px`;
    c.style.width = `${String(t.w / l.dpr)}px`;
    c.style.height = `${String(t.h / l.dpr)}px`;
    c.getContext('bitmaprenderer')?.transferFromImageBitmap(bitmap);
    l.tiles.get(t.key)?.remove();
    l.tiles.set(t.key, c);
    l.el.appendChild(c);
  }

  /** Once the current layer covers the view, older layers go. */
  private settle(): void {
    const top = this.current();
    if (top?.pending.size === 0 && this.missing(top) === 0) {
      for (const l of this.layers) if (l !== top) this.removeLayer(l);
      this.layers = [top];
    }
    this.onChange(this.stats());
  }

  private cancelPending(l: Layer): void {
    for (const job of l.pending.values()) job.cancel();
    l.pending.clear();
  }

  private removeLayer(l: Layer): void {
    this.cancelPending(l);
    l.el.remove();
    l.tiles.clear();
  }
}
