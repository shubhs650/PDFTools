import { afterEach, describe, expect, it } from 'vitest';
import type { WorkApi } from '../../src/engine/workApi';
import { WorkClient } from '../../src/engine/workClient';
import { serve } from '../../src/workers/rpc-host';

interface FakeWorld {
  memory: number;
  spawned: number;
  opened: { docId: string; original: number; tail: number; owner?: string }[];
  terminated: number;
  jobsSeen: string[];
  openDelayMs?: number;
}

const ports: MessagePort[] = [];
afterEach(() => {
  for (const p of ports.splice(0)) p.close();
});

/** A Worker stand-in backed by a MessageChannel and a fake WorkApi. */
function fakeSpawn(world: FakeWorld) {
  return (): Worker => {
    world.spawned++;
    const ch = new MessageChannel();
    ports.push(ch.port1, ch.port2);
    serve<WorkApi>(ch.port1, {
      init: () => ({ ms: 1, wasmBytes: 1 }),
      open: async ({ docId, original, tail, ownerPassword }) => {
        await new Promise((r) => setTimeout(r, world.openDelayMs ?? 0));
        world.jobsSeen.push(`open:${docId}`);
        world.opened.push({
          docId,
          original: original.byteLength,
          tail: tail?.byteLength ?? 0,
          ...(ownerPassword === undefined ? {} : { owner: ownerPassword }),
        });
        return { pageCount: 3, wasmBytes: world.memory };
      },
      unlock: ({ ownerPassword }) => ({ unlocked: ownerPassword === 'owner' }),
      pageGeometry: ({ docId }) => {
        world.jobsSeen.push(`geometry:${docId}`);
        return { runs: [] };
      },
      textSlices: ({ slices }) => slices.map(() => 'text'),
      // Three batches, 10 ms apart; stops at a cancel like the real one (between pages).
      search: async (req, ctx) => {
        for (let page = 0; page < 3; page++) {
          await new Promise((r) => setTimeout(r, 10));
          ctx.throwIfAborted();
          ctx.stream({
            searchId: req.searchId,
            hits: [
              { page, start: 0, length: req.query.length, before: '', match: req.query, after: '' },
            ],
            counts: [],
            pagesDone: page + 1,
            pageCount: 3,
          });
        }
        return {
          searchId: req.searchId,
          totalHits: 3,
          detailedHits: 3,
          pageCount: 3,
          ms: 30,
          firstHitMs: 10,
        };
      },
      searchContext: () => [],
      searchExtras: () => [],
      listAttachments: () => [],
      listLayers: () => ({ encrypted: false, layers: [] }),
      printOpen: () => ({ printId: 'p' }),
      printPages: () => [],
      printBand: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
      printClose: () => null,
      formFacts: () => ({ tabs: [], annotated: [], defaults: {}, encrypted: false }),
      checkSignatures: () => [],
      docProperties: () => {
        throw new Error('unused');
      },
      readAttachment: () => ({ bytes: new ArrayBuffer(0) }),
      indexText: () => ({ pages: 3, extracted: 3, pausedMs: 0, ms: 1 }),
      activity: () => {
        world.jobsSeen.push('activity');
        return null;
      },
      hitRects: ({ hits }) => hits.map(() => []),
      refresh: () => ({ pending: true }),
      append: ({ piece }) => ({ tailBytes: piece.byteLength }),
      verify: () => ({ ok: true }),
      digest: () => ({ pageCount: 3, pages: [] }),
      close: () => ({ wasmBytes: world.memory }),
      memory: () => ({ wasmBytes: world.memory, peakWasmBytes: world.memory }),
      docState: () => ({ pageCount: 3, appliedTailBytes: 0 }),
      textStats: async (_a, ctx) => {
        await new Promise((r) => setTimeout(r, 5));
        ctx.throwIfAborted();
        return { pages: 3, chars: 10, ms: 5 };
      },
    });
    const port = ch.port2;
    port.start();
    return Object.assign(port, {
      terminate: () => {
        world.terminated++;
        port.close();
      },
    }) as unknown as Worker;
  };
}

const MB = 1024 * 1024;
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(cond()).toBe(true);
};

describe('WorkClient lifecycle (ADR-004 decision 4)', () => {
  it('respawns when idle after a job above the threshold and reloads original + tail', async () => {
    const world: FakeWorld = {
      memory: 10 * MB,
      spawned: 0,
      opened: [],
      terminated: 0,
      jobsSeen: [],
    };
    let reloads = 0;
    const c = new WorkClient({
      wasmUrl: 'http://x/pdfium.wasm',
      respawnAboveBytes: 64 * MB,
      spawn: fakeSpawn(world),
    });
    await c.open('doc', new ArrayBuffer(100), {
      reload: () => {
        reloads++;
        return Promise.resolve(new ArrayBuffer(100));
      },
    });
    await c.refresh('doc', new ArrayBuffer(7));

    await c.run('textStats', { docId: 'doc' }).promise;
    expect(c.respawns).toBe(0); // below threshold

    world.memory = 300 * MB;
    await c.run('textStats', { docId: 'doc' }).promise;
    await until(() => c.respawns === 1);
    await until(() => world.opened.length === 2);
    expect(world.terminated).toBe(1);
    expect(reloads).toBe(1);
    expect(world.opened[1]).toEqual({ docId: 'doc', original: 100, tail: 7 });
    // still usable afterwards
    world.memory = 10 * MB;
    expect((await c.run('docState', { docId: 'doc' }).promise).pageCount).toBe(3);
    c.terminate();
  });

  it('never respawns while jobs are still running', async () => {
    const world: FakeWorld = {
      memory: 300 * MB,
      spawned: 0,
      opened: [],
      terminated: 0,
      jobsSeen: [],
    };
    const c = new WorkClient({ wasmUrl: 'x', respawnAboveBytes: 64 * MB, spawn: fakeSpawn(world) });
    const a = c.run('textStats', { docId: 'none' });
    const b = c.run('textStats', { docId: 'none' });
    await Promise.all([a.promise, b.promise]);
    await until(() => c.respawns === 1); // once, after both finished
    await new Promise((r) => setTimeout(r, 30));
    expect(c.respawns).toBe(1);
    c.terminate();
  });

  it('respawns after evicting a document, reloading only the remaining ones', async () => {
    const world: FakeWorld = {
      memory: 10 * MB,
      spawned: 0,
      opened: [],
      terminated: 0,
      jobsSeen: [],
    };
    const c = new WorkClient({ wasmUrl: 'x', spawn: fakeSpawn(world) });
    const src = { reload: () => Promise.resolve(new ArrayBuffer(5)) };
    await c.open('keep', new ArrayBuffer(5), src);
    await c.open('drop', new ArrayBuffer(5), src);
    await c.evict('drop');
    expect(c.respawns).toBe(1);
    expect(world.opened.map((o) => o.docId)).toEqual(['keep', 'drop', 'keep']);
    c.terminate();
  });

  it('cancels a job through its handle', async () => {
    const world: FakeWorld = { memory: 1, spawned: 0, opened: [], terminated: 0, jobsSeen: [] };
    const c = new WorkClient({ wasmUrl: 'x', spawn: fakeSpawn(world) });
    const job = c.run('textStats', { docId: 'd' });
    job.cancel();
    await expect(job.promise).rejects.toThrow(/cancelled/);
    c.terminate();
  });

  it('an owner unlock survives a respawn: the reload unlocks again (§7.12, ADR-013 d3)', async () => {
    const world: FakeWorld = {
      memory: 300 * MB,
      spawned: 0,
      opened: [],
      terminated: 0,
      jobsSeen: [],
    };
    const c = new WorkClient({
      wasmUrl: 'http://x/pdfium.wasm',
      respawnAboveBytes: 64 * MB,
      spawn: fakeSpawn(world),
    });
    await c.open('doc', new ArrayBuffer(10), {
      reload: () => Promise.resolve(new ArrayBuffer(10)),
      password: 'user',
    });
    expect(await c.unlock('doc', 'wrong')).toBe(false);
    expect(await c.unlock('doc', 'owner')).toBe(true);
    expect(await c.unlock('missing', 'owner')).toBe(false);
    await c.run('textStats', { docId: 'doc' }).promise;
    await until(() => c.respawns === 1 && world.opened.length === 2);
    expect(world.opened[0]?.owner).toBeUndefined();
    expect(world.opened[1]?.owner).toBe('owner');
    c.terminate();
  });

  it('a job on a document waits for its open in flight (M2-04 text geometry)', async () => {
    const world: FakeWorld = {
      memory: MB,
      spawned: 0,
      opened: [],
      terminated: 0,
      jobsSeen: [],
      openDelayMs: 30,
    };
    const c = new WorkClient({ wasmUrl: 'http://x/pdfium.wasm', spawn: fakeSpawn(world) });
    const opened = c.open('doc', new ArrayBuffer(10), {
      reload: () => Promise.resolve(new ArrayBuffer(10)),
    });
    expect(c.has('doc')).toBe(true); // known at once, so callers route here
    const geo = await c.run('pageGeometry', { docId: 'doc', pageIndex: 0 }).promise;
    await opened;
    expect(geo).toEqual({ runs: [] });
    expect(world.jobsSeen).toEqual(['open:doc', 'geometry:doc']);
    expect(await c.run('textSlices', { docId: 'doc', slices: [] }).promise).toEqual([]);
    c.terminate();
  });
});
