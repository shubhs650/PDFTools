// Spike S29: the overlay on screen, two ways (D-59, ADR-031: "whether the
// combining happens in the browser's compositor or in a worker is settled by
// spike S29"). One sheet in a scrolling view, tiled at the current zoom.
//   worker:     one composed bitmap per tile (canvas, bitmaprenderer).
//   compositor: two grey bitmaps per tile, each side a layer tinted by CSS
//               (grey with mix-blend-mode: screen over its colour), side B
//               multiplied over side A (mix-blend-mode: multiply).
// window.s29 is driven by s29.spec.ts.
import { installProbes, probe } from '../shared/probe';
import type { OverlapMode, OverlayStyle, Rgb } from './composite';
import { DEFAULT_STYLE } from './composite';
import type { TileReq } from './overlay.worker';

installProbes();

const TILE = 512;
type Route = 'worker' | 'compositor';

const worker = new Worker(new URL('./overlay.worker.ts', import.meta.url), { type: 'module' });
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
worker.onmessage = (e: MessageEvent<{ id: number; value?: unknown; error?: string }>) => {
  const p = pending.get(e.data.id);
  if (!p) return;
  pending.delete(e.data.id);
  if (e.data.error) p.reject(new Error(e.data.error));
  else p.resolve(e.data.value);
};
function rpc<T>(method: string, args: unknown = {}): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker.postMessage({ id, method, args });
  });
}

const view = document.getElementById('view') as HTMLDivElement;
const sheet = document.getElementById('sheet') as HTMLDivElement;
const layerW = document.getElementById('layer-w') as HTMLDivElement;
const sideA = document.getElementById('side-a') as HTMLDivElement;
const sideB = document.getElementById('side-b') as HTMLDivElement;

let route: Route = 'worker';
let zoom = 1;
let size = { w: 0, h: 0 };
let gen = 0;
let style: OverlayStyle = DEFAULT_STYLE;
let mode: OverlapMode = 'multiply';
let thick = false;
const drawn = new Map<string, HTMLCanvasElement[]>();
let wantKeys = new Set<string>();
const renderMs: number[] = [];
const composeMs: number[] = [];

const px = () => zoom * (96 / 72); // CSS px per pt (DPR 1 in the test browser)
const rgbCss = (c: Rgb) => `rgb(${String(c[0])} ${String(c[1])} ${String(c[2])})`;

function applyCompositorStyle(): void {
  sideA.style.background = rgbCss(style.colA);
  sideB.style.background = rgbCss(style.colB);
  sideA.style.display = style.showA ? '' : 'none';
  sideB.style.display = style.showB ? '' : 'none';
  // Balance by opacity of the weaker side (the compositor can't weigh ink).
  sideA.style.opacity = String(Math.min(1, 1 - style.balance));
  sideB.style.opacity = String(Math.min(1, 1 + style.balance));
}

function layout(): void {
  sheet.style.width = `${String(Math.round(size.w * px()))}px`;
  sheet.style.height = `${String(Math.round(size.h * px()))}px`;
  layerW.hidden = route !== 'worker';
  const stack = sideA.parentElement;
  if (stack) stack.hidden = route !== 'compositor';
  applyCompositorStyle();
}

function visibleTiles(): {
  key: string;
  tx: number;
  ty: number;
  w: number;
  h: number;
  d: number;
}[] {
  const W = Math.round(size.w * px());
  const H = Math.round(size.h * px());
  const x0 = view.scrollLeft;
  const y0 = view.scrollTop;
  const x1 = x0 + view.clientWidth;
  const y1 = y0 + view.clientHeight;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const out = [];
  for (let ty = Math.floor(y0 / TILE) * TILE; ty < Math.min(y1, H); ty += TILE)
    for (let tx = Math.floor(x0 / TILE) * TILE; tx < Math.min(x1, W); tx += TILE) {
      const w = Math.min(TILE, W - tx);
      const h = Math.min(TILE, H - ty);
      out.push({
        key: `${String(zoom)}:${String(tx)}:${String(ty)}`,
        tx,
        ty,
        w,
        h,
        d: Math.hypot(tx + w / 2 - cx, ty + h / 2 - cy),
      });
    }
  // The centre first (visible-first rendering).
  return out.sort((a, b) => a.d - b.d);
}

function placeCanvas(
  parent: HTMLElement,
  bmp: ImageBitmap,
  tx: number,
  ty: number,
  cls = '',
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.className = `tile ${cls}`;
  c.style.left = `${String(tx)}px`;
  c.style.top = `${String(ty)}px`;
  c.getContext('bitmaprenderer')?.transferFromImageBitmap(bmp);
  parent.appendChild(c);
  return c;
}

/** Renders what is visible; resolves when every visible tile is on screen. */
async function refresh(force = false): Promise<number> {
  const t0 = performance.now();
  const myGen = ++gen;
  void rpc('cancel', { gen: myGen });
  const tiles = visibleTiles();
  wantKeys = new Set(tiles.map((t) => t.key));
  // Tiles of another zoom go once the new ones are in (no blank flash): here,
  // simply removed at the end.
  const jobs = tiles
    .filter((t) => force || !drawn.has(t.key))
    .map(async (t) => {
      const req: TileReq = {
        gen: myGen,
        key: t.key,
        z: px(),
        tx: t.tx,
        ty: t.ty,
        w: t.w,
        h: t.h,
        route,
      };
      const r = await rpc<{
        dropped?: boolean;
        bmp?: ImageBitmap;
        a?: ImageBitmap;
        b?: ImageBitmap;
        renderMs: number;
        composeMs: number;
      }>('tile', req);
      if (r.dropped || myGen !== gen) {
        r.bmp?.close();
        r.a?.close();
        r.b?.close();
        return;
      }
      renderMs.push(r.renderMs);
      composeMs.push(r.composeMs);
      for (const c of drawn.get(t.key) ?? []) c.remove();
      if (route === 'worker' && r.bmp) drawn.set(t.key, [placeCanvas(layerW, r.bmp, t.tx, t.ty)]);
      else if (r.a && r.b)
        drawn.set(t.key, [
          placeCanvas(sideA, r.a, t.tx, t.ty, 'grey'),
          placeCanvas(sideB, r.b, t.tx, t.ty, 'grey'),
        ]);
    });
  await Promise.all(jobs);
  if (myGen !== gen) return -1;
  for (const [k, cs] of drawn)
    if (!wantKeys.has(k) && !k.startsWith(`${String(zoom)}:`)) {
      for (const c of cs) c.remove();
      drawn.delete(k);
    }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return performance.now() - t0;
}

function clear(): void {
  for (const cs of drawn.values()) for (const c of cs) c.remove();
  drawn.clear();
}

// Frame probe: rAF deltas and long animation frames while something runs.
const frames: number[] = [];
let framing = false;
function frameLoop(last: number): void {
  requestAnimationFrame((t) => {
    if (!framing) return;
    frames.push(t - last);
    frameLoop(t);
  });
}
const loafs: number[] = [];
try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) loafs.push(e.duration);
  }).observe({ type: 'long-animation-frame', buffered: false });
} catch {
  /* not supported */
}

const api = {
  async init() {
    await rpc('init', { wasmUrl: '/pdfium/pdfium.wasm' });
    return true;
  },
  async open(a: string, b: string, opts: { pwA?: string; pwB?: string } = {}) {
    clear();
    size = await rpc<{ w: number; h: number }>('open', { a, b, ...opts });
    layout();
    return size;
  },
  async setRoute(r: Route) {
    route = r;
    clear();
    layout();
    return refresh(true);
  },
  async setZoom(z: number, centre = true) {
    const fx = (view.scrollLeft + view.clientWidth / 2) / Math.max(1, sheet.offsetWidth);
    const fy = (view.scrollTop + view.clientHeight / 2) / Math.max(1, sheet.offsetHeight);
    zoom = z;
    layout();
    if (centre) {
      view.scrollLeft = fx * sheet.offsetWidth - view.clientWidth / 2;
      view.scrollTop = fy * sheet.offsetHeight - view.clientHeight / 2;
    }
    return refresh();
  },
  async scrollTo(fx: number, fy: number) {
    view.scrollLeft = fx * sheet.offsetWidth - view.clientWidth / 2;
    view.scrollTop = fy * sheet.offsetHeight - view.clientHeight / 2;
    return refresh();
  },
  /** A zoom gesture: `steps` zoom changes `every` ms apart, rendering as it goes. */
  async zoomGesture(from: number, to: number, steps: number, every: number) {
    frames.length = 0;
    loafs.length = 0;
    probe.longTasks.length = 0;
    framing = true;
    frameLoop(performance.now());
    const t0 = performance.now();
    let last: Promise<number> = Promise.resolve(0);
    for (let i = 1; i <= steps; i++) {
      const z = from * Math.pow(to / from, i / steps);
      last = api.setZoom(z);
      await new Promise((r) => setTimeout(r, every));
    }
    await last;
    const settle = await refresh();
    const total = performance.now() - t0;
    framing = false;
    const sorted = [...frames].sort((a, b) => a - b);
    return {
      totalMs: Math.round(total),
      settleMs: Math.round(settle),
      frames: frames.length,
      p95: Math.round((sorted[Math.floor(sorted.length * 0.95)] ?? 0) * 10) / 10,
      over25: frames.filter((f) => f > 25).length,
      maxFrame: Math.round(Math.max(0, ...frames)),
      longTasks: probe.longTasks.length,
      longAnimationFrames: loafs.length,
    };
  },
  async setStyle(s: Partial<OverlayStyle>, m: OverlapMode = mode, th = thick) {
    const t0 = performance.now();
    const thickChanged = th !== thick;
    style = { ...style, ...s };
    mode = m;
    thick = th;
    await rpc('setStyle', { style, mode, thick });
    if (route === 'compositor' && !thickChanged) {
      applyCompositorStyle();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return performance.now() - t0;
    }
    await refresh(true);
    return performance.now() - t0;
  },
  stats() {
    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
    let bitmapPx = 0;
    for (const cs of drawn.values()) for (const c of cs) bitmapPx += c.width * c.height;
    return {
      tiles: drawn.size,
      canvases: [...drawn.values()].reduce((n, cs) => n + cs.length, 0),
      bitmapMB: Math.round((bitmapPx * 4) / 1e5) / 10,
      renderMsMedian: Math.round(med(renderMs.filter((x) => x > 0)) * 10) / 10,
      composeMsMedian: Math.round(med(composeMs) * 10) / 10,
      longTasks: probe.longTasks.length,
    };
  },
  workerStats: () => rpc('stats'),
  async memory() {
    const m = (
      performance as unknown as {
        measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
      }
    ).measureUserAgentSpecificMemory;
    if (!m || !crossOriginIsolated) return null;
    return Math.round((await m.call(performance)).bytes / 1e5) / 10;
  },
  resetTimes() {
    renderMs.length = 0;
    composeMs.length = 0;
    probe.longTasks.length = 0;
  },
};

(window as unknown as { s29: typeof api }).s29 = api;
document.body.dataset.ready = 'true';
