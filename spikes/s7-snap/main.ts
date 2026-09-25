// M0-S7 page: snap queries on pointer move (coalesced to one per animation
// frame) via two routes — the Work worker itself, or the pure-JS snap worker
// fed by transferred indexes — while the Render worker keeps drawing tiles.

import type { PdfDocumentObject } from '@embedpdf/models';
import { installProbes, probe } from '../shared/probe.ts';
import { createHostedRender, type HostedRender } from '../s3-two-engines/hosted-engine.ts';
import { RpcClient } from '../s3-two-engines/rpc.ts';
import type { GeometryHandlers } from './geometry.worker.ts';
import type { SnapHandlers } from './snap.worker.ts';

installProbes();
const WASM = new URL('/pdfium/pdfium.wasm', location.origin).href;
const statusEl = document.getElementById('status') as HTMLOutputElement;
const r2 = (n: number): number => Math.round(n * 100) / 100;
function stats(xs: number[]): { n: number; p50: number; p95: number; max: number } {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  return { n: s.length, p50: r2(q(0.5)), p95: r2(q(0.95)), max: r2(s[s.length - 1] ?? 0) };
}

const geo = new RpcClient<GeometryHandlers>(
  new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module', name: 'work' }),
);
const snapW = new RpcClient<SnapHandlers>(
  new Worker(new URL('./snap.worker.ts', import.meta.url), { type: 'module', name: 'snap' }),
);
let hosted: HostedRender | undefined;
let doc: PdfDocumentObject | undefined;
let phase = 'idle';
const rtt = new Map<string, number[]>();
const tileLat = new Map<string, number[]>();
let coalesced = 0;
let hits = 0;

async function boot(): Promise<void> {
  hosted = createHostedRender(WASM);
  await Promise.all([hosted.ready, geo.call('init', { wasmUrl: WASM })]);
}

async function load(url: string): Promise<unknown> {
  if (!hosted) throw new Error('not booted');
  const bytes = await (await fetch(url)).arrayBuffer();
  doc = await hosted.engine
    .openDocumentBuffer({ id: `d${String(Date.now())}`, content: bytes.slice(0) })
    .toPromise();
  return geo.call('open', { bytes }, { transfer: [bytes] });
}

/** Extract + index a page in the Work worker, then hand the index to the snap worker. */
async function extract(page: number, sliceMs?: number): Promise<unknown> {
  const t0 = performance.now();
  const r = await geo.call('extract', { page, ...(sliceMs === undefined ? {} : { sliceMs }) });
  const tH = performance.now();
  await snapW.call(
    'load',
    { page, index: r.index },
    { transfer: [r.index.segs.buffer, r.index.cellStart.buffer, r.index.items.buffer] },
  );
  return {
    stats: r.stats,
    gridMs: r.gridMs,
    totalMs: r2(performance.now() - t0),
    handoffMs: r2(performance.now() - tH),
  };
}

// ---- pointer simulation ------------------------------------------------------------
let pointerOn = false;
function startPointer(
  route: 'snap' | 'work',
  page: number,
  cx: number,
  cy: number,
  amp: number,
  r = 8,
): void {
  pointerOn = true;
  let inFlight = false;
  const t0 = performance.now();
  const frame = (): void => {
    if (!pointerOn) return;
    if (inFlight) {
      coalesced++; // one outstanding request at most: this move is dropped
    } else {
      const t = (performance.now() - t0) / 1000;
      const args = {
        page,
        x: cx + Math.sin(t * 1.3) * amp,
        y: cy + Math.sin(t * 2.1) * amp * 0.6,
        r,
      };
      inFlight = true;
      const ts = performance.now();
      const p = route === 'snap' ? snapW.call('snap', args) : geo.call('snap', args);
      void p.then((res) => {
        const key = `${route}:${phase}`;
        const arr = rtt.get(key) ?? [];
        arr.push(performance.now() - ts);
        rtt.set(key, arr);
        if (res) hits++;
        inFlight = false;
      });
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
function stopPointer(): void {
  pointerOn = false;
}

// ---- tile loop ----------------------------------------------------------------------
let tilesOn = false;
async function tileLoop(page: number, zoom: number): Promise<void> {
  if (!hosted || !doc) return;
  const pg = doc.pages[page];
  if (!pg) return;
  const side = 256 / zoom;
  let k = 0;
  while (tilesOn) {
    const x = pg.size.width / 2 - 2 * side + (k % 4) * side;
    const y = pg.size.height / 2 - 2 * side + (Math.floor(k / 4) % 4) * side;
    k++;
    const t = performance.now();
    await hosted.engine
      .renderPageRectRaw(
        doc,
        pg,
        { origin: { x, y }, size: { width: side, height: side } },
        { scaleFactor: zoom },
      )
      .toPromise();
    const arr = tileLat.get(phase) ?? [];
    arr.push(performance.now() - t);
    tileLat.set(phase, arr);
    await new Promise((r) => setTimeout(r, 16));
  }
}
function startTiles(page: number, zoom = 2): void {
  tilesOn = true;
  void tileLoop(page, zoom);
}
function stopTiles(): void {
  tilesOn = false;
}

declare global {
  interface Window {
    __s7: Record<string, unknown>;
  }
}
window.__s7 = {
  probe,
  load,
  extract,
  startPointer,
  stopPointer,
  startTiles,
  stopTiles,
  setPhase: (p: string) => (phase = p),
  report: () => ({
    rtt: Object.fromEntries([...rtt].map(([k, v]) => [k, stats(v)])),
    tiles: Object.fromEntries([...tileLat].map(([k, v]) => [k, stats(v)])),
    coalesced,
    hits,
    longTasks: probe.longTasks.map((l) => Math.round(l.duration)),
  }),
  reset: () => {
    rtt.clear();
    tileLat.clear();
    coalesced = 0;
    hits = 0;
  },
  snapOnce: (page: number, x: number, y: number, r = 8) => snapW.call('snap', { page, x, y, r }),
};
boot().then(
  () => (statusEl.value = 'ready'),
  (e: unknown) => (statusEl.value = `error ${String(e)}`),
);
