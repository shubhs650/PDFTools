// E2E-only probe for the viewer (M1-14): render counters, cache state and the
// S5/S9 auto-scroll method (fixed px/s, blank visible pages counted per
// frame). Never part of a production build.
import type { SelectionCapability } from '@embedpdf/plugin-selection';
import type { ZoomCapability } from '@embedpdf/plugin-zoom';
import { capability, hostStore, renderEngine, tileCache } from '../features/view/host';
import { renderStats, resetRenderStats, type KindStats } from '../features/view/renderStats';
import { viewFocus } from '../features/view/tileScheduler';
import type { TestHook } from './hook';

const viewport = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('[data-testid="document-view"]');
  if (!el) throw new Error('no document view');
  return el;
};

/** Visible pages that show neither a preview nor any tile yet. */
function blankVisiblePages(): number {
  const v = viewport().getBoundingClientRect();
  let blank = 0;
  for (const el of viewport().querySelectorAll<HTMLElement>('[data-page]:not([data-hidden])')) {
    const r = el.getBoundingClientRect();
    if (r.bottom <= v.top || r.top >= v.bottom) continue;
    const img = el.querySelector('img');
    if (!img?.complete || img.naturalWidth === 0) blank++;
  }
  return blank;
}

function pct(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round((s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0) * 10) / 10;
}

const summary = (k: KindStats) => ({
  requested: k.requested,
  done: k.done,
  aborted: k.aborted,
  failed: k.failed,
  cached: k.cached,
  p50: pct(k.latencies, 50),
  p95: pct(k.latencies, 95),
  max: pct(k.latencies, 100),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function registerViewProbe(hook: TestHook): void {
  hook.capabilities['view'] = {
    stats: () => ({
      tiles: summary(renderStats.tiles),
      previews: summary(renderStats.previews),
      progressive: {
        requested: renderStats.progressive.requested,
        done: renderStats.progressive.done,
        cancelled: renderStats.progressive.cancelled,
        slices: [...renderStats.progressive.slices],
        maxSliceMs: renderStats.progressive.maxSliceMs.map((ms) => Math.round(ms * 10) / 10),
      },
      cache: { bytes: tileCache.size, entries: tileCache.count, max: tileCache.maxBytes },
      focus: { ...viewFocus },
    }),
    /** Direct zoom request (the zoom UI arrives in M1-15). */
    zoom: (level: number) => {
      const registry = hostStore.getState().registry;
      if (!registry) throw new Error('no registry');
      capability<ZoomCapability>(registry, 'zoom').requestZoom(level);
    },
    /** Natural width of a page's preview image, and the width the current zoom asks for. */
    previewWidth: (pageIndex: number) => {
      const img = viewport().querySelector<HTMLImageElement>(
        `[data-page="${String(pageIndex)}"] img.page-preview`,
      );
      return img?.naturalWidth ?? 0;
    },
    reset: () => {
      resetRenderStats();
    },
    /** The selection plugin's state for the active document (M2-04). */
    selection: () => {
      const registry = hostStore.getState().registry;
      if (!registry) return null;
      const id = registry.getStore().getState().core.activeDocumentId;
      if (!id) return null;
      const st = capability<SelectionCapability>(registry, 'selection').getState(id);
      return {
        selection: st.selection,
        rects: Object.fromEntries(Object.entries(st.rects).map(([k, v]) => [k, v.length])),
        geometryPages: Object.keys(st.geometry).map(Number),
        selecting: st.selecting,
      };
    },
    /**
     * Issues Render-engine calls on the active document's `pages`, `inFlight`
     * at a time, and returns each call's latency (queue wait included). The
     * M2-01 spike uses it to measure what panes and the text layer cost the
     * visible tiles; later perf scenarios use it as background load.
     */
    engineLoad: async (
      method: 'geometry' | 'thumbnail' | 'textRects' | 'bookmarks',
      pages: number[],
      inFlight = 1,
    ) => {
      const registry = hostStore.getState().registry;
      if (!registry) throw new Error('no registry');
      const core = registry.getStore().getState().core;
      const doc = core.activeDocumentId ? core.documents[core.activeDocumentId]?.document : null;
      if (!doc) throw new Error('no active document');
      const engine = renderEngine().engine;
      const ms: number[] = [];
      const queue = [...pages];
      const one = async (): Promise<void> => {
        for (let i = queue.shift(); i !== undefined; i = queue.shift()) {
          const page = doc.pages[i];
          if (!page) continue;
          const t0 = performance.now();
          if (method === 'geometry') await engine.getPageGeometry(doc, page).toPromise();
          else if (method === 'textRects') await engine.getPageTextRects(doc, page).toPromise();
          else if (method === 'bookmarks') await engine.getBookmarks(doc).toPromise();
          // Raw (unencoded, uncached, not counted as a tile) at the stock
          // thumbnail plugin's priority: renderPageRect's HIGH, like tiles.
          else
            await engine
              .renderPageRectRaw(
                doc,
                page,
                { origin: { x: 0, y: 0 }, size: page.size },
                { scaleFactor: 150 / page.size.width },
              )
              .toPromise();
          ms.push(performance.now() - t0);
        }
      };
      await Promise.all(Array.from({ length: inFlight }, one));
      return { n: ms.length, p50: pct(ms, 50), p95: pct(ms, 95), max: pct(ms, 100) };
    },
    docCacheBytes: (docId: string) => tileCache.docBytes(docId),
    blankVisiblePages,
    visiblePageIndexes: () => {
      const v = viewport().getBoundingClientRect();
      return [...viewport().querySelectorAll<HTMLElement>('[data-page]')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.bottom > v.top && r.top < v.bottom;
        })
        .map((el) => Number(el.dataset['page']));
    },
    /** Visible pages whose tiles have all loaded (sharp). */
    sharpVisiblePages: () => {
      const v = viewport().getBoundingClientRect();
      let sharp = 0;
      for (const el of viewport().querySelectorAll<HTMLElement>('[data-page]')) {
        const r = el.getBoundingClientRect();
        if (r.bottom <= v.top || r.top >= v.bottom) continue;
        const tiles = el.querySelectorAll('.page-tiles img');
        if (tiles.length > 0 && [...tiles].every((i) => (i as HTMLImageElement).complete)) sharp++;
      }
      return sharp;
    },
    scrollTo: (top: number) => {
      viewport().scrollTop = top;
    },
    scrollHeight: () => viewport().scrollHeight,
    /** Scrolls at `pxPerSec` for `ms`; counts frames with a blank visible page. */
    autoScroll: (pxPerSec: number, ms: number) =>
      new Promise((resolve) => {
        const el = viewport();
        let frames = 0;
        let blankFrames = 0;
        const gaps: number[] = [];
        const t0 = performance.now();
        let last = t0;
        const step = (now: number): void => {
          frames++;
          gaps.push(now - last);
          el.scrollTop += (pxPerSec * (now - last)) / 1000;
          last = now;
          if (blankVisiblePages() > 0) blankFrames++;
          if (now - t0 < ms) requestAnimationFrame(step);
          else resolve({ frames, blankFrames, gapP95: pct(gaps, 95), gapMax: pct(gaps, 100) });
        };
        requestAnimationFrame(step);
      }),
    /** Resolves once no render has started or finished for `quietMs`. */
    settle: async (quietMs = 400, timeoutMs = 20_000) => {
      const count = () =>
        renderStats.tiles.requested +
        renderStats.tiles.done +
        renderStats.tiles.aborted +
        renderStats.previews.requested +
        renderStats.previews.done;
      let lastCount = -1;
      let since = performance.now();
      const t0 = performance.now();
      for (;;) {
        const c = count();
        if (c !== lastCount) {
          lastCount = c;
          since = performance.now();
        }
        if (performance.now() - since > quietMs) return Math.round(since - t0);
        if (performance.now() - t0 > timeoutMs) throw new Error('renders did not settle');
        await sleep(20);
      }
    },
  };
}
