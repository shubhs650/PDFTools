import { describe, expect, it, vi } from 'vitest';
import { AbortError } from '../../src/engine/errors';
import {
  ThumbnailQueue,
  type ThumbCache,
  type ThumbRequest,
} from '../../src/features/thumbnails/queue';

// The thumbnail queue (M2-08, ADR-012 decision 2).

const blob = (s: string) => new Blob([s]);

class MapCache implements ThumbCache {
  readonly map = new Map<string, Blob>();
  get(key: string) {
    return this.map.get(key);
  }
  set(key: string, _doc: string, _page: number, b: Blob) {
    this.map.set(key, b);
  }
}

/** A render step the test finishes by hand. */
function manualRender(heavy = false) {
  const calls: {
    r: ThumbRequest;
    resolve: (b: Blob) => void;
    reject: (e: unknown) => void;
    cancelled: boolean;
  }[] = [];
  const render = (r: ThumbRequest) => {
    let resolve!: (b: Blob) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<Blob>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const call = { r, resolve, reject, cancelled: false };
    calls.push(call);
    return {
      promise,
      heavy,
      cancel: () => {
        call.cancelled = true;
        reject(new AbortError());
      },
    };
  };
  return { calls, render };
}

const req = (pageIndex: number, priority: number): ThumbRequest => ({
  docId: 'd',
  pageIndex,
  scale: 0.2,
  priority,
});
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('ThumbnailQueue', () => {
  it('renders one at a time, nearest the page in view first, and caches', async () => {
    const { calls, render } = manualRender();
    const cache = new MapCache();
    const q = new ThumbnailQueue(render, () => true, cache);
    const a = q.request(req(0, 5));
    q.request(req(1, 1));
    q.request(req(2, 0));
    expect(calls.map((c) => c.r.pageIndex)).toEqual([0]); // first request starts at once
    calls[0]?.resolve(blob('a'));
    await expect(a.promise).resolves.toBeInstanceOf(Blob);
    await settle();
    expect(calls.map((c) => c.r.pageIndex)).toEqual([0, 2]); // then priority 0 before 1
    calls[1]?.resolve(blob('c'));
    await settle();
    expect(calls.map((c) => c.r.pageIndex)).toEqual([0, 2, 1]);
    calls[2]?.resolve(blob('b'));
    await settle();
    // Cached: asking again renders nothing.
    await q.request(req(0, 0)).promise;
    expect(q.started).toBe(3);
    expect(cache.map.size).toBe(3);
  });

  it('reprioritize reorders what waits', async () => {
    const { calls, render } = manualRender();
    const q = new ThumbnailQueue(render, () => true, new MapCache());
    q.request(req(0, 0));
    q.request(req(10, 1));
    q.request(req(20, 2));
    q.reprioritize((r) => Math.abs(r.pageIndex - 20));
    calls[0]?.resolve(blob('x'));
    await settle();
    expect(calls[1]?.r.pageIndex).toBe(20);
  });

  it('a cancelled request never renders', async () => {
    const { calls, render } = manualRender();
    const q = new ThumbnailQueue(render, () => true, new MapCache());
    q.request(req(0, 0));
    const b = q.request(req(1, 0));
    b.cancel();
    await expect(b.promise).rejects.toBeInstanceOf(AbortError);
    calls[0]?.resolve(blob('x'));
    await settle();
    expect(calls).toHaveLength(1);
    expect(q.pending).toBe(0);
  });

  it('waits while the document is busy', async () => {
    vi.useFakeTimers();
    try {
      const { calls, render } = manualRender();
      let quiet = false;
      const q = new ThumbnailQueue(render, () => quiet, new MapCache());
      q.request(req(0, 0));
      await vi.advanceTimersByTimeAsync(1000);
      expect(calls).toHaveLength(0);
      quiet = true;
      await vi.advanceTimersByTimeAsync(100);
      expect(calls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('activity interrupts a heavy render, which goes back in the queue', async () => {
    const { calls, render } = manualRender(true);
    const q = new ThumbnailQueue(render, () => true, new MapCache());
    const job = q.request(req(3, 0));
    q.interrupt();
    expect(calls[0]?.cancelled).toBe(true);
    await settle();
    expect(calls).toHaveLength(2); // re-queued and started again (quiet)
    calls[1]?.resolve(blob('x'));
    await expect(job.promise).resolves.toBeInstanceOf(Blob);
  });

  it('activity leaves a light render alone', () => {
    const { calls, render } = manualRender(false);
    const q = new ThumbnailQueue(render, () => true, new MapCache());
    q.request(req(0, 0));
    q.interrupt();
    expect(calls[0]?.cancelled).toBe(false);
  });
});
