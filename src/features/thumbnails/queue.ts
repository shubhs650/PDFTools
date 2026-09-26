// The thumbnail queue (M2-08, ADR-012 decision 2): one render in flight, the
// lowest priority value (nearest the page in view) first, nothing started
// until the document has been quiet for a while, and a heavy render in flight
// is given up (and re-queued) when the user starts working the document.
import { AbortError, isAbortError } from '../../engine/errors';

/** The shared image cache (tileCache in the app). */
export interface ThumbCache {
  get(key: string): Blob | undefined;
  set(key: string, docId: string, pageIndex: number, blob: Blob): void;
}

export interface ThumbRequest {
  docId: string;
  pageIndex: number;
  /** Render scale (thumbnail width × DPR / page width). */
  scale: number;
  /** Lower first: distance from the page in view. */
  priority: number;
}

interface Entry extends ThumbRequest {
  key: string;
  resolve: (blob: Blob) => void;
  reject: (err: unknown) => void;
}

interface Running {
  key: string;
  /** `heavy` is known only once the page's cost is in: read it when needed. */
  job: { cancel(): void; readonly heavy: boolean };
}

const cacheKey = (r: ThumbRequest): string =>
  JSON.stringify(['thumb', r.docId, r.pageIndex, Math.round(r.scale * 1000) / 1000]);

/** Rendering step, replaceable in tests. */
export type RenderThumb = (r: ThumbRequest) => {
  promise: Promise<Blob>;
  cancel(): void;
  heavy: boolean;
};

export class ThumbnailQueue {
  private readonly waiting = new Map<string, Entry>();
  private running: Running | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly render: RenderThumb;
  private readonly quiet: () => boolean;
  private readonly cache: ThumbCache;
  /** Renders started (tests and diagnostics). */
  started = 0;

  constructor(render: RenderThumb, quiet: () => boolean, cache: ThumbCache) {
    this.render = render;
    this.quiet = quiet;
    this.cache = cache;
  }

  request(r: ThumbRequest): { promise: Promise<Blob>; cancel(): void } {
    const key = cacheKey(r);
    const hit = this.cache.get(key);
    if (hit) return { promise: Promise.resolve(hit), cancel: () => undefined };
    let entry!: Entry;
    const promise = new Promise<Blob>((resolve, reject) => {
      entry = { ...r, key, resolve, reject };
    });
    // A new request for the same thumbnail replaces the old one.
    this.waiting.get(key)?.reject(new AbortError());
    this.waiting.set(key, entry);
    this.pump();
    return {
      promise,
      cancel: () => {
        if (this.waiting.get(key) === entry) {
          this.waiting.delete(key);
          entry.reject(new AbortError());
        }
      },
    };
  }

  /** The view changed priorities (the page in view moved). */
  reprioritize(priorityOf: (r: ThumbRequest) => number): void {
    for (const e of this.waiting.values()) e.priority = priorityOf(e);
  }

  /** Activity: a heavy render in flight gives the CPU back (it is re-queued). */
  interrupt(): void {
    if (this.running?.job.heavy) this.running.job.cancel();
  }

  get pending(): number {
    return this.waiting.size;
  }

  private pump(): void {
    if (this.running || this.timer || this.waiting.size === 0) return;
    if (!this.quiet()) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.pump();
      }, 100);
      return;
    }
    let next: Entry | undefined;
    for (const e of this.waiting.values()) if (!next || e.priority < next.priority) next = e;
    if (!next) return;
    const entry = next;
    this.waiting.delete(entry.key);
    this.started++;
    const job = this.render(entry);
    const running: Running = { key: entry.key, job };
    this.running = running;
    job.promise
      .then(
        (blob) => {
          this.cache.set(entry.key, entry.docId, entry.pageIndex, blob);
          entry.resolve(blob);
        },
        (err: unknown) => {
          // Interrupted by activity: back in the queue, unless someone asked again meanwhile.
          if (isAbortError(err) && !this.waiting.has(entry.key)) this.waiting.set(entry.key, entry);
          else entry.reject(err);
        },
      )
      .finally(() => {
        if (this.running === running) this.running = null;
        this.pump();
      });
  }
}
