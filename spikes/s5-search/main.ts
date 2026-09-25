// M0-S5 page: continuous auto-scroll through the Render worker while the Work
// worker searches. The main thread only posts messages, draws bitmaps and
// renders a small results list. Driven by Playwright via window.__s5.

import type { PdfDocumentObject, PdfPageObject, PdfTask, Rect } from '@embedpdf/models';
import { installProbes, probe } from '../shared/probe.ts';
import { createHostedRender, type HostedRender } from '../s3-two-engines/hosted-engine.ts';
import { AbortedError, RpcClient } from '../s3-two-engines/rpc.ts';
import type { Hit, SearchOptions } from './search-core.ts';
import type { SearchHandlers } from './search.worker.ts';

installProbes();

const TILE = 256;
const GAP = 10;
const WASM = new URL('/pdfium/pdfium.wasm', location.origin).href;
const statusEl = document.getElementById('status') as HTMLOutputElement;
const canvas = document.getElementById('viewport') as HTMLCanvasElement;
const ctx2d = canvas.getContext('2d');
const qEl = document.getElementById('q') as HTMLInputElement;
const caseEl = document.getElementById('case') as HTMLInputElement;
const wordEl = document.getElementById('word') as HTMLInputElement;
const listEl = document.getElementById('results') as HTMLUListElement;
const countEl = document.getElementById('count') as HTMLOutputElement;

const r1 = (n: number): number => Math.round(n * 10) / 10;
function stats(xs: number[]): { n: number; p50: number; p95: number; max: number } {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  return { n: s.length, p50: r1(q(0.5)), p95: r1(q(0.95)), max: r1(s[s.length - 1] ?? 0) };
}

// ---- engines -------------------------------------------------------------
let hosted: HostedRender | undefined;
let doc: PdfDocumentObject | undefined;
const workWorker = new Worker(new URL('./search.worker.ts', import.meta.url), {
  type: 'module',
  name: 'work',
});
const work = new RpcClient<SearchHandlers>(workWorker);

async function boot(): Promise<void> {
  hosted = createHostedRender(WASM);
  await Promise.all([hosted.ready, work.call('init', { wasmUrl: WASM })]);
}

async function load(url: string): Promise<unknown> {
  if (!hosted) throw new Error('not booted');
  const bytes = await (await fetch(url)).arrayBuffer();
  const copy = bytes.slice(0);
  const t0 = performance.now();
  doc = await hosted.engine
    .openDocumentBuffer({ id: `d-${String(Date.now())}`, content: copy })
    .toPromise();
  const w = await work.call('open', { bytes }, { transfer: [bytes] });
  layout();
  return { pages: doc.pageCount, workPages: w.pages, openMs: r1(performance.now() - t0) };
}

// ---- viewport / tiles --------------------------------------------------------
let tops: number[] = [];
function layout(): void {
  tops = [];
  let y = 0;
  for (const p of doc?.pages ?? []) {
    tops.push(y);
    y += p.size.height + GAP;
  }
}

interface Tile {
  key: string;
  page: PdfPageObject;
  rect: Rect;
  x: number;
  y: number; // document coordinates
  visibleSince: number;
  bmp?: ImageBitmap;
  task?: PdfTask<unknown>;
  phase: string;
}
const tiles = new Map<string, Tile>();
const latencies = new Map<string, number[]>();
const aborted = new Map<string, number>();
const frameGaps: number[] = [];
const longFrames: { phase: string; gap: number; at: number }[] = [];
let scrollTop = 0;
let speed = 0;
let phase = 'idle';
let running = false;

function visiblePages(): number[] {
  const out: number[] = [];
  tops.forEach((t, i) => {
    const h = doc?.pages[i]?.size.height ?? 0;
    if (t + h >= scrollTop && t <= scrollTop + canvas.height) out.push(i);
  });
  return out;
}

function frame(now: number, last: number): void {
  if (!running || !doc || !hosted) return;
  frameGaps.push(now - last);
  if (now - last > 50) longFrames.push({ phase, gap: r1(now - last), at: r1(now) });
  scrollTop += (speed * (now - last)) / 1000;
  const maxTop = (tops[tops.length - 1] ?? 0) - canvas.height;
  if (scrollTop > maxTop) scrollTop = 0;
  const want = new Set<string>();
  for (const i of visiblePages()) {
    const page = doc.pages[i];
    if (!page) continue;
    const top = tops[i] ?? 0;
    for (let ty = 0; ty < page.size.height; ty += TILE) {
      if (top + ty + TILE < scrollTop || top + ty > scrollTop + canvas.height) continue;
      for (let tx = 0; tx < Math.min(page.size.width, canvas.width); tx += TILE) {
        const key = `${String(i)}:${String(tx)}:${String(ty)}`;
        want.add(key);
        if (tiles.has(key)) continue;
        const rect = {
          origin: { x: tx, y: ty },
          size: {
            width: Math.min(TILE, page.size.width - tx),
            height: Math.min(TILE, page.size.height - ty),
          },
        };
        const t: Tile = { key, page, rect, x: tx, y: top + ty, visibleSince: now, phase };
        tiles.set(key, t);
        const task = hosted.engine.renderPageRectRaw(doc, page, rect, { scaleFactor: 1, dpr: 1 });
        t.task = task as PdfTask<unknown>;
        task.wait(
          (img) => {
            const lat = performance.now() - t.visibleSince;
            const arr = latencies.get(t.phase) ?? [];
            arr.push(lat);
            latencies.set(t.phase, arr);
            void createImageBitmap(
              new ImageData(
                new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength),
                img.width,
                img.height,
              ),
            ).then((b) => {
              if (tiles.get(key) === t) t.bmp = b;
              else b.close();
            });
          },
          () => undefined,
        );
      }
    }
  }
  // Drop tiles that left the viewport; abort their queued renders.
  for (const [key, t] of tiles) {
    if (want.has(key)) continue;
    if (!t.bmp && t.task) {
      t.task.abort({ code: 0, message: 'scrolled away' });
      aborted.set(t.phase, (aborted.get(t.phase) ?? 0) + 1);
    }
    t.bmp?.close();
    tiles.delete(key);
  }
  if (ctx2d) {
    ctx2d.fillStyle = '#ddd';
    ctx2d.fillRect(0, 0, canvas.width, canvas.height);
    for (const t of tiles.values()) if (t.bmp) ctx2d.drawImage(t.bmp, t.x, t.y - scrollTop);
  }
  requestAnimationFrame((n) => {
    frame(n, now);
  });
}

function startScroll(pxPerSec = 900): void {
  speed = pxPerSec;
  if (running) return;
  running = true;
  requestAnimationFrame((n) => {
    frame(n, n);
  });
}

function stopScroll(): void {
  running = false;
}

function setPhase(p: string): void {
  phase = p;
}

function tileStats(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [p, xs] of latencies) {
    out[p] = {
      ...stats(xs),
      over150ms: xs.filter((x) => x > 150).length,
      abortedQueued: aborted.get(p) ?? 0,
    };
  }
  out.frames = {
    ...stats(frameGaps),
    over50ms: frameGaps.filter((x) => x > 50).length,
    longFrames,
  };
  return out;
}

function resetTileStats(): void {
  latencies.clear();
  aborted.clear();
  frameGaps.length = 0;
  longFrames.length = 0;
}

// ---- search (Enter only, D-08) ----------------------------------------------
interface SearchRun {
  id: number;
  query: string;
  startedAt: number;
  firstHitMs?: number;
  doneMs?: number;
  cancelLatencyMs?: number;
  hits: Hit[];
  /** Total hits, including those streamed only as per-page counts. */
  total: number;
  batches: number;
  result?: unknown;
  cancelled?: boolean;
  abortedAt?: number;
}
let seq = 0;
let current: SearchRun | undefined;
let controller: AbortController | undefined;
const runs: SearchRun[] = [];
let staleArrivals = 0;
let staleShown = 0;
let inputEvents = 0;
let searchCalls = 0;
let listDirty = false;

qEl.addEventListener('input', () => {
  inputEvents++; // typing never searches
});
qEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter')
    void search(qEl.value, { matchCase: caseEl.checked, wholeWord: wordEl.checked });
});

function renderList(): void {
  listDirty = false;
  const run = current;
  if (!run) return;
  countEl.value = String(run.total);
  // Only the first 50 rows are in the DOM (virtualised list stand-in).
  const rows = run.hits.slice(0, 50);
  listEl.replaceChildren(
    ...rows.map((h) => {
      const li = document.createElement('li');
      li.textContent = `p.${String(h.page + 1)}: …${h.before}[${h.match}]${h.after}…`;
      return li;
    }),
  );
}

function search(query: string, opts: SearchOptions = {}): Promise<SearchRun> {
  searchCalls++;
  const prev = current;
  if (prev && controller && prev.doneMs === undefined) {
    prev.abortedAt = performance.now();
    controller.abort();
  }
  controller = new AbortController();
  const run: SearchRun = {
    id: ++seq,
    query,
    startedAt: performance.now(),
    hits: [],
    total: 0,
    batches: 0,
  };
  current = run;
  runs.push(run);
  return work
    .call(
      'search',
      { id: run.id, query, opts, visible: visiblePages() },
      {
        signal: controller.signal,
        onProgress: (p) => {
          const msg = p as { id: number; hits: Hit[]; counts: [number, number][] };
          if (msg.id !== current?.id) {
            staleArrivals++; // dropped: never reaches the list
            return;
          }
          run.batches++;
          const counted = msg.counts.reduce((n, [, c]) => n + c, 0);
          if ((msg.hits.length || counted) && run.firstHitMs === undefined) {
            run.firstHitMs = performance.now() - run.startedAt;
          }
          for (const h of msg.hits) run.hits.push(h);
          run.total += msg.hits.length + counted;
          if (!listDirty) {
            listDirty = true;
            requestAnimationFrame(renderList);
          }
        },
      },
    )
    .then(
      (res) => {
        run.doneMs = performance.now() - run.startedAt;
        run.result = res;
        if (current !== run) staleShown++;
        return run;
      },
      (e: unknown) => {
        if (e instanceof AbortedError) {
          run.cancelled = true;
          run.cancelLatencyMs = performance.now() - (run.abortedAt ?? performance.now());
          return run;
        }
        throw e;
      },
    );
}

function summary(run: SearchRun): Record<string, unknown> {
  return {
    id: run.id,
    query: run.query,
    hits: run.total,
    detailed: run.hits.length,
    batches: run.batches,
    firstHitMs: run.firstHitMs === undefined ? null : r1(run.firstHitMs),
    doneMs: run.doneMs === undefined ? null : r1(run.doneMs),
    cancelled: run.cancelled ?? false,
    cancelLatencyMs: run.cancelLatencyMs === undefined ? null : r1(run.cancelLatencyMs),
    worker: run.result ?? null,
    firstPages: [...new Set(run.hits.slice(0, 20).map((h) => h.page))],
  };
}

/** Plugin-search path for comparison: EmbedPDF searchAllPages on the Render engine. */
async function renderEngineSearch(query: string): Promise<unknown> {
  if (!hosted || !doc) throw new Error('no document');
  const t0 = performance.now();
  let first: number | undefined;
  const task = hosted.engine.searchAllPages(doc, query);
  task.onProgress((p) => {
    if (first === undefined && (p as { results?: unknown[] }).results?.length)
      first = performance.now() - t0;
  });
  const res = (await task.toPromise()) as { total: number };
  return {
    total: res.total,
    ms: r1(performance.now() - t0),
    firstHitMs: first === undefined ? null : r1(first),
  };
}

declare global {
  interface Window {
    __s5: Record<string, unknown>;
  }
}
window.__s5 = {
  probe,
  load,
  startScroll,
  stopScroll,
  setPhase,
  tileStats,
  resetTileStats,
  search: async (q: string, o?: SearchOptions) => summary(await search(q, o)),
  searchNoWait: (q: string, o?: SearchOptions) => {
    void search(q, o);
    return seq;
  },
  runs: () => runs.map(summary),
  counters: () => ({
    inputEvents,
    searchCalls,
    staleArrivals,
    staleShown,
    listRows: listEl.children.length,
  }),
  rects: (page: number, hits: { start: number; length: number }[]) =>
    work.call('rects', { page, hits }),
  nativeSearch: (q: string) => work.call('nativeSearch', { query: q }),
  cacheInfo: () => work.call('cacheInfo', undefined),
  clearCache: () => work.call('clearCache', undefined),
  renderEngineSearch,
};

boot().then(
  () => (statusEl.value = 'ready'),
  (e: unknown) => {
    statusEl.value = `error ${String(e)}`;
  },
);
