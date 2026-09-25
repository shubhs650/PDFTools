// M0-S3 harness: two PDFium instances in two workers (D-10). Driven from
// Playwright through window.__s3; also usable by hand for owner-local files
// (?src=/corpus/<file> or the file picker). See docs/adr/004-s3-two-engines.md.

import { createPdfiumEngine as createStockEngine } from '@embedpdf/engines/pdfium-worker-engine';
import type { PdfEngine } from '@embedpdf/engines/pdfium';
import type { PdfDocumentObject, PdfPageObject, Rect } from '@embedpdf/models';
import { installProbes, probe } from '../shared/probe.ts';
import { createHostedRender, type HostedRender } from './hosted-engine.ts';
import { AbortedError, RpcClient } from './rpc.ts';
import type { WorkHandlers } from './work.worker.ts';

installProbes();

const TILE = 256;
const abs = (p: string): string => new URL(p, location.origin).href;
const WASM = abs('/pdfium/pdfium.wasm');
const statusEl = document.getElementById('status') as HTMLOutputElement;
const logEl = document.getElementById('log') as HTMLPreElement;
const canvas = document.getElementById('viewport') as HTMLCanvasElement;
const ctx2d = canvas.getContext('2d');

type Mode = 'hosted' | 'stock';
interface State {
  mode: Mode;
  hosted?: HostedRender;
  engine: PdfEngine;
  work: RpcClient<WorkHandlers>;
  workWorker: Worker;
  doc?: PdfDocumentObject;
  bytes?: ArrayBuffer;
  docId?: string;
}
let st: State | undefined;

function need(): State & { doc: PdfDocumentObject; docId: string } {
  if (!st?.doc || !st.docId) throw new Error('no document');
  return st as State & { doc: PdfDocumentObject; docId: string };
}

function stats(xs: number[]): { n: number; p50: number; p95: number; max: number; mean: number } {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  const r = (v: number): number => Math.round(v * 10) / 10;
  return {
    n: s.length,
    p50: r(q(0.5)),
    p95: r(q(0.95)),
    max: r(s[s.length - 1] ?? 0),
    mean: r(s.reduce((a, b) => a + b, 0) / Math.max(1, s.length)),
  };
}

function longTasksSince(t0: number): number[] {
  return probe.longTasks.filter((t) => t.start >= t0).map((t) => Math.round(t.duration));
}

async function uaMemory(): Promise<number | null> {
  const p = performance as Performance & {
    measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
  };
  if (!crossOriginIsolated || !p.measureUserAgentSpecificMemory) return null;
  return (await p.measureUserAgentSpecificMemory()).bytes;
}

async function memory(): Promise<Record<string, number | null>> {
  const s = st;
  if (!s) throw new Error('not booted');
  return {
    renderWasm: s.hosted
      ? (await s.hosted.special<{ wasmBytes: number }>('memory')).wasmBytes
      : null,
    workWasm: (await s.work.call('memory', undefined)).wasmBytes,
    jsHeap:
      (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
        ?.usedJSHeapSize ?? null,
    uaSpecific: await uaMemory(),
  };
}

async function boot(mode: Mode = 'hosted'): Promise<unknown> {
  const t0 = performance.now();
  let engine: PdfEngine;
  let hosted: HostedRender | undefined;
  let renderInit: unknown;
  if (mode === 'hosted') {
    hosted = createHostedRender(WASM);
    engine = hosted.engine;
    renderInit = await hosted.ready;
  } else {
    engine = createStockEngine(WASM, { fontFallback: null });
    renderInit = 'stock (not observable)';
  }
  const workWorker = new Worker(new URL('./work.worker.ts', import.meta.url), {
    type: 'module',
    name: 'work',
  });
  const work = new RpcClient<WorkHandlers>(workWorker);
  const workInit = await work.call('init', { wasmUrl: WASM });
  st = { mode, engine, work, workWorker, ...(hosted ? { hosted } : {}) };
  return {
    mode,
    ms: performance.now() - t0,
    renderInit,
    workInit,
    crossOriginIsolated,
    longTasks: longTasksSince(t0),
  };
}

async function load(src: string | ArrayBuffer): Promise<unknown> {
  const s = st;
  if (!s) throw new Error('not booted');
  const t0 = performance.now();
  const bytes = typeof src === 'string' ? await (await fetch(src)).arrayBuffer() : src;
  const fetchMs = performance.now() - t0;
  const docId = `doc-${String(Date.now())}`;
  // One copy for the Render worker (kept for later reloads), the original is
  // transferred to the Work worker (ARCHITECTURE §3.1: Work holds a read-only copy).
  const renderCopy = bytes.slice(0);
  s.bytes = bytes.slice(0);
  const tR = performance.now();
  const doc = await s.engine.openDocumentBuffer({ id: docId, content: renderCopy }).toPromise();
  const renderOpenMs = performance.now() - tR;
  const tW = performance.now();
  const workOpen = await s.work.call('open', { docId, bytes }, { transfer: [bytes] });
  const workOpenMs = performance.now() - tW;
  s.doc = doc;
  s.docId = docId;
  return {
    sizeMB: Math.round((renderCopy.byteLength / 1e6) * 10) / 10,
    pageCount: doc.pageCount,
    fetchMs,
    renderOpenMs,
    workOpenMs,
    workOpen,
    memory: await memory(),
    longTasks: longTasksSince(t0),
  };
}

/** Visible tiles for a vertical-scroll layout at `zoom`, viewport = canvas. */
function visibleTiles(
  pages: PdfPageObject[],
  zoom: number,
  scrollTop: number,
): { page: PdfPageObject; rect: Rect; dx: number; dy: number }[] {
  const out: { page: PdfPageObject; rect: Rect; dx: number; dy: number }[] = [];
  const vw = canvas.width;
  const vh = canvas.height;
  let y = 0;
  for (const page of pages) {
    const pw = page.size.width * zoom;
    const ph = page.size.height * zoom;
    if (y + ph >= scrollTop && y <= scrollTop + vh) {
      for (let ty = 0; ty < ph; ty += TILE) {
        if (y + ty + TILE < scrollTop || y + ty > scrollTop + vh) continue;
        for (let tx = 0; tx < Math.min(pw, vw); tx += TILE) {
          const w = Math.min(TILE, pw - tx);
          const h = Math.min(TILE, ph - ty);
          out.push({
            page,
            rect: {
              origin: { x: tx / zoom, y: ty / zoom },
              size: { width: w / zoom, height: h / zoom },
            },
            dx: tx,
            dy: y + ty - scrollTop,
          });
        }
      }
    }
    y += ph + 10;
    if (y > scrollTop + vh) break;
  }
  return out;
}

async function renderTile(
  engine: PdfEngine,
  doc: PdfDocumentObject,
  t: { page: PdfPageObject; rect: Rect; dx: number; dy: number },
  zoom: number,
): Promise<number> {
  const t0 = performance.now();
  const img = await engine
    .renderPageRectRaw(doc, t.page, t.rect, { scaleFactor: zoom, dpr: 1 })
    .toPromise();
  const bmp = await createImageBitmap(
    new ImageData(
      new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength),
      img.width,
      img.height,
    ),
  );
  ctx2d?.drawImage(bmp, t.dx, t.dy);
  bmp.close();
  return performance.now() - t0;
}

interface BenchOpts {
  firstPage?: number;
  scrollSteps?: number;
  scrollPx?: number;
  zooms?: number[];
  zoomSteps?: number;
}

/** Simulated scroll then zoom: each step requests every visible tile at once. */
async function scrollZoom(o: BenchOpts = {}): Promise<{ tile: number[]; step: number[] }> {
  const { engine, doc } = need();
  const pages = doc.pages.slice(o.firstPage ?? 0);
  const tile: number[] = [];
  const step: number[] = [];
  const plan: { zoom: number; scrollTop: number }[] = [];
  for (let i = 0; i < (o.scrollSteps ?? 30); i++)
    plan.push({ zoom: 1, scrollTop: i * (o.scrollPx ?? 400) });
  for (const z of o.zooms ?? [2, 4]) {
    for (let i = 0; i < (o.zoomSteps ?? 8); i++)
      plan.push({ zoom: z, scrollTop: i * (o.scrollPx ?? 400) });
  }
  for (const p of plan) {
    const t0 = performance.now();
    const tiles = visibleTiles(pages, p.zoom, p.scrollTop);
    ctx2d?.clearRect(0, 0, canvas.width, canvas.height);
    tile.push(...(await Promise.all(tiles.map((t) => renderTile(engine, doc, t, p.zoom)))));
    step.push(performance.now() - t0);
    await new Promise((r) => requestAnimationFrame(r));
  }
  return { tile, step };
}

/** S3 method step 3: tile latency alone vs. while the Work worker extracts. */
async function concurrency(o: BenchOpts = {}): Promise<unknown> {
  const { work, docId } = need();
  const t0 = performance.now();
  const cold = await scrollZoom(o);
  const warm = await scrollZoom(o);
  const extractAlone = await work.call('extractAll', { docId });
  // Keep the Work worker busy for the whole run: repeat extraction until the
  // tile bench is done, then cancel the last pass.
  const progress: unknown[] = [];
  const ac = new AbortController();
  const bench = { done: false }; // object so the loop sees the update
  const passes: { ms: number; pagesPerSec: number }[] = [];
  const loop = (async () => {
    while (!bench.done) {
      try {
        const r = await work.call(
          'extractAll',
          { docId },
          { signal: ac.signal, onProgress: (p) => progress.push(p) },
        );
        passes.push({ ms: Math.round(r.ms), pagesPerSec: Math.round(r.pagesPerSec) });
      } catch (e) {
        if (!(e instanceof AbortedError)) throw e;
      }
    }
  })();
  const during = await scrollZoom(o);
  bench.done = true;
  ac.abort();
  await loop;
  return {
    coldTile: stats(cold.tile),
    warmTile: stats(warm.tile),
    duringWorkTile: stats(during.tile),
    warmStep: stats(warm.step),
    duringWorkStep: stats(during.step),
    extractAlone,
    extractPassesDuringBench: passes,
    progressEvents: progress.length,
    longTasks: longTasksSince(t0),
  };
}

/** Cancel the Work worker's extraction mid-run; latency from abort to rejection. */
async function cancelWork(afterMs = 300): Promise<unknown> {
  const { work, docId } = need();
  const ac = new AbortController();
  const job = work.call('extractAll', { docId }, { signal: ac.signal });
  await new Promise((r) => setTimeout(r, afterMs));
  const t0 = performance.now();
  ac.abort();
  try {
    await job;
    return { cancelled: false };
  } catch (e) {
    return { cancelled: e instanceof AbortedError, latencyMs: performance.now() - t0 };
  }
}

/** Deep zoom: 256 px tiles around the page centre at each zoom. */
async function deepZoom(pageIndex = 0, zooms = [1, 8, 64], n = 5): Promise<unknown> {
  const { engine, doc } = need();
  const page = doc.pages[pageIndex];
  if (!page) throw new Error('no page');
  const out: Record<string, unknown> = { page: page.size };
  const cx = page.size.width / 2;
  const cy = page.size.height / 2;
  for (const z of zooms) {
    const side = TILE / z;
    const times: number[] = [];
    for (let i = 0; i < n; i++) {
      const ox = cx + ((i % 3) - 1) * side;
      const oy = cy + (Math.floor(i / 3) - 1) * side;
      times.push(
        await renderTile(
          engine,
          doc,
          {
            page,
            rect: { origin: { x: ox, y: oy }, size: { width: side, height: side } },
            dx: 0,
            dy: 0,
          },
          z,
        ),
      );
    }
    out[`${String(z * 100)}%`] = { first: Math.round(times[0] ?? 0), ...stats(times.slice(1)) };
  }
  return out;
}

/** Can EmbedPDF renders be cancelled? Queued vs. in-flight. */
async function cancelRender(pageIndex = 0, heavyScale = 1.5): Promise<unknown> {
  const { engine, doc, hosted } = need();
  const page = doc.pages[pageIndex];
  if (!page) throw new Error('no page');
  const small: Rect = { origin: { x: 0, y: 0 }, size: { width: 64, height: 64 } };

  const tH = performance.now();
  await engine.renderPageRaw(doc, page, { scaleFactor: heavyScale }).toPromise();
  const heavyAloneMs = performance.now() - tH;

  // In flight: start heavy, abort after 5 ms, then ask for a small tile.
  const heavy = engine.renderPageRaw(doc, page, { scaleFactor: heavyScale });
  await new Promise((r) => setTimeout(r, 5));
  heavy.abort({ code: 0, message: 'probe' });
  const tS = performance.now();
  await engine.renderPageRectRaw(doc, page, small, { scaleFactor: 4 }).toPromise();
  const smallAfterAbortMs = performance.now() - tS;

  // Queued: 20 tiles, abort all but the first synchronously.
  const before = hosted ? await hosted.special<Record<string, number>>('stats') : undefined;
  const tasks = Array.from({ length: 20 }, (_, i) =>
    engine.renderPageRectRaw(
      doc,
      page,
      { origin: { x: i * 10, y: 0 }, size: { width: 64, height: 64 } },
      { scaleFactor: 8 },
    ),
  );
  tasks.slice(1).forEach((t) => {
    t.abort({ code: 0, message: 'probe' });
  });
  await tasks[0]?.toPromise();
  await new Promise((r) => setTimeout(r, 200));
  const after = hosted ? await hosted.special<Record<string, number>>('stats') : undefined;
  const key = 'renderPageRect';
  return {
    heavyAloneMs,
    smallAfterAbortMs,
    inflightAbortEffective: smallAfterAbortMs < heavyAloneMs / 2,
    queuedRequested: 20,
    queuedAbortedClientSide: 19,
    queuedExecutedInWorker:
      before && after ? (after[key] ?? 0) - (before[key] ?? 0) : 'n/a (stock)',
  };
}

/** Direct PDFium progressive render in the hosted Render worker. */
async function progressive(
  pageIndex = 0,
  zoom = 8,
  sliceMs = 8,
  cancelAfterMs?: number,
): Promise<unknown> {
  const { hosted, doc, bytes } = need();
  if (!hosted || !bytes) return 'n/a (stock)';
  const page = doc.pages[pageIndex];
  if (!page) throw new Error('no page');
  const size = 1024;
  const copy = bytes.slice(0);
  return hosted.special(
    'progressive',
    {
      bytes: copy,
      pageIndex,
      zoom,
      x: page.size.width / 2 - size / zoom / 2,
      y: page.size.height / 2 - size / zoom / 2,
      size,
      sliceMs,
      ...(cancelAfterMs === undefined ? {} : { cancelAfterMs }),
    },
    [copy],
  );
}

async function closeDoc(): Promise<unknown> {
  const { engine, doc, work, docId } = need();
  await engine.closeDocument(doc).toPromise();
  await work.call('close', { docId });
  delete st?.doc;
  delete st?.docId;
  return memory();
}

async function respawn(): Promise<unknown> {
  const s = st;
  if (!s) throw new Error('not booted');
  s.hosted?.terminate();
  if (!s.hosted) await s.engine.destroy().toPromise();
  s.workWorker.terminate();
  const b = await boot(s.mode);
  return { boot: b, memory: await memory() };
}

declare global {
  interface Window {
    __s3: Record<string, unknown>;
  }
}
window.__s3 = {
  probe,
  boot,
  load,
  memory,
  scrollZoom,
  concurrency,
  cancelWork,
  deepZoom,
  cancelRender,
  progressive,
  closeDoc,
  respawn,
};

// Manual use: ?src=/corpus/<file>&mode=stock|hosted, or pick a file.
const params = new URLSearchParams(location.search);
const fileEl = document.getElementById('file') as HTMLInputElement;
function show(v: unknown): void {
  logEl.textContent = JSON.stringify(v, null, 2);
}
fileEl.addEventListener('change', () => {
  const f = fileEl.files?.[0];
  if (!f) return;
  statusEl.value = 'loading';
  void f
    .arrayBuffer()
    .then(async (b) => {
      const l = await load(b);
      show({ load: l, deepZoom: await deepZoom(0), concurrency: await concurrency() });
      statusEl.value = 'done';
    })
    .catch((e: unknown) => {
      show(String(e));
      statusEl.value = 'error';
    });
});
boot((params.get('mode') as Mode | null) ?? 'hosted')
  .then(async (b) => {
    const src = params.get('src');
    show({ boot: b, ...(src ? { load: await load(src) } : {}) });
    statusEl.value = 'ready';
  })
  .catch((e: unknown) => {
    show(String(e));
    statusEl.value = 'error';
  });
