// Render instrumentation and caching around EmbedPDF's PdfEngine (M1-14).
// Wraps renderPage (previews) and renderPageRect (tiles) on the engine
// instance: cache hits resolve at once; misses are counted (requested, done,
// aborted, failed) with request→Blob latency, so tests can see stale tiles
// being aborted on scroll and zoom (ADR-004 decision 3).
import { Task, type PdfEngine } from '@embedpdf/models';
import type { TileCache } from './tileCache';

export interface KindStats {
  requested: number;
  done: number;
  aborted: number;
  failed: number;
  cached: number;
  latencies: number[];
}

export interface ProgressiveStats {
  requested: number;
  done: number;
  cancelled: number;
  /** Slices per finished render and the longest slice of each (ms). */
  slices: number[];
  maxSliceMs: number[];
}

export interface RenderStats {
  tiles: KindStats;
  previews: KindStats;
  progressive: ProgressiveStats;
}

const MAX_LATENCIES = 2000;

const empty = (): KindStats => ({
  requested: 0,
  done: 0,
  aborted: 0,
  failed: 0,
  cached: 0,
  latencies: [],
});

const emptyProgressive = (): ProgressiveStats => ({
  requested: 0,
  done: 0,
  cancelled: 0,
  slices: [],
  maxSliceMs: [],
});

export const renderStats: RenderStats = {
  tiles: empty(),
  previews: empty(),
  progressive: emptyProgressive(),
};

export function resetRenderStats(): void {
  renderStats.tiles = empty();
  renderStats.previews = empty();
  renderStats.progressive = emptyProgressive();
}

type RenderFn = (...args: unknown[]) => Task<Blob, unknown>;

interface Located {
  id: string;
}
interface PageRef {
  index: number;
}

/** Cache key: the exact request (document, page, rect, options). */
export function renderKey(method: string, args: unknown[]): string | null {
  const doc = args[0] as Located | undefined;
  const page = args[1] as PageRef | undefined;
  if (!doc?.id || typeof page?.index !== 'number') return null;
  const rest = method === 'renderPageRect' ? [args[2], args[3]] : [args[2]];
  return JSON.stringify([method, doc.id, page.index, ...rest]);
}

/** Documents whose first page preview has been drawn (background work waits for it, M2-08). */
const previewed = new Set<string>();

export function hasFirstPreview(docId: string): boolean {
  return previewed.has(docId);
}

export function instrumentEngine(engine: PdfEngine, cache: TileCache): void {
  const wrap = (method: 'renderPage' | 'renderPageRect', stats: () => KindStats): void => {
    const target = engine as unknown as Record<string, RenderFn>;
    const original = target[method]?.bind(engine);
    if (!original) return;
    target[method] = (...args: unknown[]) => {
      const s = stats();
      const key = renderKey(method, args);
      const doc = args[0] as Located;
      const page = args[1] as PageRef;
      const hit = key ? cache.get(key) : undefined;
      if (hit) {
        s.cached++;
        const task = new Task<Blob, unknown>();
        task.resolve(hit);
        return task;
      }
      s.requested++;
      const t0 = performance.now();
      const task = original(...args);
      task.wait(
        (blob) => {
          s.done++;
          if (method === 'renderPage') previewed.add(doc.id);
          if (s.latencies.length < MAX_LATENCIES) s.latencies.push(performance.now() - t0);
          if (key) cache.set(key, doc.id, page.index, blob);
        },
        (e) => {
          if (e.type === 'abort') s.aborted++;
          else s.failed++;
        },
      );
      return task;
    };
  };
  wrap('renderPage', () => renderStats.previews);
  wrap('renderPageRect', () => renderStats.tiles);
}
