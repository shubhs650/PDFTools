import { afterEach, describe, expect, it } from 'vitest';
import { AbortError, WorkerLostError } from '../../src/engine/errors';
import type { OcrApi, OcrDataSource } from '../../src/engine/ocrApi';
import { OcrClient } from '../../src/engine/ocrClient';
import type { OcrLanguage } from '../../src/model/ocr/languages';
import { serve } from '../../src/workers/rpc-host';

// The OCR client's lifecycle (ADR-020 d6): a worker per job initialized with
// the chosen languages, terminated by stop() and by a cancel mid-page, a
// fresh one for the next call or for other languages.

interface World {
  spawned: number;
  terminated: number;
  inits: string[][];
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
      init: ({ languages }) => {
        world.inits.push(languages.map((l) => `${l.code}@${l.url}`));
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
const sources = (codes: readonly OcrLanguage[]): OcrDataSource[] =>
  codes.map((code) => ({ code, url: `https://app.test/ocr/${code}.traineddata.gz` }));
const world = (recognizeMs: number): World => ({
  spawned: 0,
  terminated: 0,
  inits: [],
  recognized: 0,
  recognizeMs,
});

describe('OcrClient (ADR-020 d6)', () => {
  it('starts a worker on the first call, initializes it with the languages, and stops it on stop()', async () => {
    const w = world(1);
    const c = new OcrClient({ sources, spawn: fakeSpawn(w) });
    expect(c.running).toBe(false);
    const r = await c.recognize(raster(), ['eng']);
    expect(r.lines[0]?.words[0]?.text).toBe('ok');
    expect(w.spawned).toBe(1);
    expect(w.inits).toEqual([['eng@https://app.test/ocr/eng.traineddata.gz']]);
    expect(c.running).toBe(true);
    await c.recognize(raster(), ['eng']);
    expect(w.spawned).toBe(1); // reused within the job
    // Other languages: a fresh worker initialized with them, in the given order.
    await c.recognize(raster(), ['eng', 'hin']);
    expect(w.spawned).toBe(2);
    expect(w.inits[1]).toEqual([
      'eng@https://app.test/ocr/eng.traineddata.gz',
      'hin@https://app.test/ocr/hin.traineddata.gz',
    ]);
    c.stop();
    expect(w.terminated).toBe(2);
    expect(c.running).toBe(false);
    await c.recognize(raster(), ['eng', 'hin']);
    expect(w.spawned).toBe(3); // a fresh worker for the next job
    expect(c.starts).toBe(3);
    c.stop();
  });

  it('a cancel mid-page terminates the worker and rejects with AbortError at once', async () => {
    const w = world(200);
    const c = new OcrClient({ sources, spawn: fakeSpawn(w) });
    const controller = new AbortController();
    const job = c.recognize(raster(), ['eng'], { signal: controller.signal });
    await new Promise((r) => setTimeout(r, 20));
    const t0 = performance.now();
    controller.abort();
    await expect(job).rejects.toBeInstanceOf(AbortError);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(w.terminated).toBe(1);
    expect(c.running).toBe(false);
    // Already aborted: nothing starts.
    await expect(
      c.recognize(raster(), ['eng'], { signal: controller.signal }),
    ).rejects.toBeInstanceOf(AbortError);
    expect(w.spawned).toBe(1);
  });

  it('a lost worker rejects the call as WorkerLostError', async () => {
    const w = world(200);
    const c = new OcrClient({ sources, spawn: fakeSpawn(w) });
    const job = c.recognize(raster(), ['eng']);
    await new Promise((r) => setTimeout(r, 20));
    c.stop();
    await expect(job).rejects.toBeInstanceOf(WorkerLostError);
  });
});
