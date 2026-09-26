import { afterEach, describe, expect, it } from 'vitest';
import { SearchSession } from '../../src/engine/searchSession';
import type { WorkApi } from '../../src/engine/workApi';
import { WorkClient } from '../../src/engine/workClient';
import { serve } from '../../src/workers/rpc-host';
import type { SearchBatch } from '../../src/workers/work/search';

// A new search cancels the previous one, and none of the old one's batches are
// delivered (D-08, §6, ADR-006). Over a real MessageChannel and our RPC.

const ports: MessagePort[] = [];
afterEach(() => {
  for (const p of ports.splice(0)) p.close();
});

function client(): WorkClient {
  return new WorkClient({
    wasmUrl: 'http://x/pdfium.wasm',
    spawn: () => {
      const ch = new MessageChannel();
      ports.push(ch.port1, ch.port2);
      serve<Pick<WorkApi, 'init' | 'search' | 'memory'>>(ch.port1, {
        init: () => ({ ms: 1, wasmBytes: 1 }),
        memory: () => ({ wasmBytes: 1, peakWasmBytes: 1 }),
        search: async (req, ctx) => {
          for (let page = 0; page < 5; page++) {
            await new Promise((r) => setTimeout(r, 5));
            ctx.throwIfAborted();
            ctx.stream({
              searchId: req.searchId,
              hits: [{ page, start: 0, length: 1, before: '', match: req.query, after: '' }],
              counts: [],
              pagesDone: page + 1,
              pageCount: 5,
            });
          }
          return {
            searchId: req.searchId,
            totalHits: 5,
            detailedHits: 5,
            pageCount: 5,
            ms: 25,
            firstHitMs: 5,
          };
        },
      });
      ch.port2.start();
      return Object.assign(ch.port2, {
        terminate: () => {
          ch.port2.close();
        },
      }) as unknown as Worker;
    },
  });
}

const req = (query: string) => ({ docId: 'd', query, options: {}, visible: [0] });

describe('SearchSession', () => {
  it('streams every batch of a search, in order (stream() is not throttled)', async () => {
    const c = client();
    const s = new SearchSession(c);
    const got: SearchBatch[] = [];
    const { promise } = s.start(req('a'), (b) => got.push(b));
    expect((await promise).totalHits).toBe(5);
    expect(got.map((b) => b.hits[0]?.page)).toEqual([0, 1, 2, 3, 4]);
    c.terminate();
  });

  it('a new search cancels the old one; no stale batch is delivered', async () => {
    const c = client();
    const s = new SearchSession(c);
    const got: string[] = [];
    const first = s.start(req('old'), (b) => got.push(b.hits[0]?.match ?? ''));
    await new Promise((r) => setTimeout(r, 12)); // a batch or two of the old one arrive
    const second = s.start(req('new'), (b) => got.push(b.hits[0]?.match ?? ''));
    await expect(first.promise).rejects.toThrow(/cancel/i);
    await second.promise;
    const firstNew = got.indexOf('new');
    expect(got.slice(firstNew).every((m) => m === 'new')).toBe(true);
    expect(got.filter((m) => m === 'new')).toHaveLength(5);
    c.terminate();
  });

  it('cancel() stops the running search and drops what is in flight', async () => {
    const c = client();
    const s = new SearchSession(c);
    const got: number[] = [];
    const { promise } = s.start(req('x'), (b) => got.push(b.pagesDone));
    s.cancel();
    await expect(promise).rejects.toThrow(/cancel/i);
    await new Promise((r) => setTimeout(r, 30));
    expect(got).toEqual([]);
    c.terminate();
  });
});
