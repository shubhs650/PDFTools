import { afterEach, describe, expect, it } from 'vitest';
import { AbortError, WorkerLostError } from '../../src/engine/errors';
import type { OcrApi } from '../../src/engine/ocrApi';
import { OcrClient } from '../../src/engine/ocrClient';
import { serve } from '../../src/workers/rpc-host';

// The OCR client's lifecycle (ADR-020 d6): a worker per job, terminated by
// stop() and by a cancel mid-page, a fresh one for the next call.

interface World {
  spawned: number;
  terminated: number;
  inits: string[];
  recognized: number;
  /** How long a fake Recognize takes. */
  recognizeMs: number;
}

const ports: MessagePort[] = [];
afterEach(() => {
  for (const p of ports.splice(0)) p.close();
});

function fakeSpawn(world: World) {
  return (): Worker => {
    world.spawned++;
    const ch = new MessageChannel();
    ports.push(ch.port1, ch.port2);
    serve<OcrApi>(ch.port1, {
      init: ({ dataUrl }) => {
        world.inits.push(dataUrl);
        return { ms: 1, version: 'fake' };
      },
      recognize: async ({ width, height }, ctx) => {
        await new Promise((r) => setTimeout(r, world.recognizeMs));
        ctx.throwIfAborted();
        world.recognized++;
        return {
          lines: [
            {
              box: { x0: 0, y0: 0, x1: width, y1: height },
              baseline: null,
              words: [{ text: 'ok', box: { x0: 0, y0: 0, x1: width, y1: height }, conf: 99 }],
            },
          ],
          conf: 99,
          ms: world.recognizeMs,
        };
      },
    });
    const w = ch.port2 as unknown as Worker & { terminate(): void };
    w.terminate = () => {
      world.terminated++;
      ch.port1.close();
      ch.port2.close();
    };
    return w;
  };
}

const raster = () => ({ width: 2, height: 2, data: new Uint8Array([0, 0, 0, 0]).buffer, dpi: 300 });

describe('OcrClient (ADR-020 d6)', () => {
  it('starts a worker on the first call, initializes it with the data URL, and stops it on stop()', async () => {
    const world: World = { spawned: 0, terminated: 0, inits: [], recognized: 0, recognizeMs: 1 };
    const c = new OcrClient({
      dataUrl: 'https://app.test/ocr/eng.traineddata.gz',
      spawn: fakeSpawn(world),
    });
    expect(c.running).toBe(false);
    const r = await c.recognize(raster());
    expect(r.lines[0]?.words[0]?.text).toBe('ok');
    expect(world.spawned).toBe(1);
    expect(world.inits).toEqual(['https://app.test/ocr/eng.traineddata.gz']);
    expect(c.running).toBe(true);
    await c.recognize(raster());
    expect(world.spawned).toBe(1); // reused within the job
    c.stop();
    expect(world.terminated).toBe(1);
    expect(c.running).toBe(false);
    await c.recognize(raster());
    expect(world.spawned).toBe(2); // a fresh worker for the next job
    expect(c.starts).toBe(2);
    c.stop();
  });

  it('a cancel mid-page terminates the worker and rejects with AbortError at once', async () => {
    const world: World = { spawned: 0, terminated: 0, inits: [], recognized: 0, recognizeMs: 200 };
    const c = new OcrClient({ dataUrl: 'x', spawn: fakeSpawn(world) });
    const controller = new AbortController();
    const job = c.recognize(raster(), { signal: controller.signal });
    await new Promise((r) => setTimeout(r, 20));
    const t0 = performance.now();
    controller.abort();
    await expect(job).rejects.toBeInstanceOf(AbortError);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(world.terminated).toBe(1);
    expect(c.running).toBe(false);
    // Already aborted: nothing starts.
    await expect(c.recognize(raster(), { signal: controller.signal })).rejects.toBeInstanceOf(
      AbortError,
    );
    expect(world.spawned).toBe(1);
  });

  it('a lost worker rejects the call as WorkerLostError', async () => {
    const world: World = { spawned: 0, terminated: 0, inits: [], recognized: 0, recognizeMs: 200 };
    const c = new OcrClient({ dataUrl: 'x', spawn: fakeSpawn(world) });
    const job = c.recognize(raster());
    await new Promise((r) => setTimeout(r, 20));
    c.stop();
    await expect(job).rejects.toBeInstanceOf(WorkerLostError);
  });
});
