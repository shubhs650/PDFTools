// S17 page: an OCR worker (tesseract.js-core) under the CSP, driven by
// Playwright through window.__s17. The main thread only posts messages.
import { installProbes, probe } from '../shared/probe.ts';
import { RpcClient } from '../s3-two-engines/rpc.ts';
import type { OcrHandlers } from './ocr.worker.ts';

installProbes();
const statusEl = document.getElementById('status') as HTMLOutputElement;
const DATA = new URL('/ocr/eng.traineddata.gz', location.origin).href;

let worker: Worker | undefined;
let rpc: RpcClient<OcrHandlers> | undefined;
const progress: unknown[] = [];

function spawn(): RpcClient<OcrHandlers> {
  worker?.terminate();
  worker = new Worker(new URL('./ocr.worker.ts', import.meta.url), { type: 'module', name: 'ocr' });
  rpc = new RpcClient<OcrHandlers>(worker);
  return rpc;
}

async function init(): Promise<unknown> {
  return spawn().call('init', { dataUrl: DATA });
}

async function recognize(url: string, dpi: number): Promise<unknown> {
  if (!rpc) throw new Error('not started');
  const pgm = await (await fetch(url)).arrayBuffer();
  progress.length = 0;
  const t0 = performance.now();
  const r = (await rpc.call(
    'recognize',
    { pgm, dpi },
    { transfer: [pgm], onProgress: (p) => progress.push(p) },
  )) as Record<string, unknown>;
  return {
    ...r,
    roundTripMs: Math.round(performance.now() - t0),
    progressMessages: progress.length,
  };
}

/** Start a recognition, terminate the worker after `afterMs`, time it, then re-init a fresh worker. */
async function cancelAfter(url: string, dpi: number, afterMs: number): Promise<unknown> {
  if (!rpc) throw new Error('not started');
  const pgm = await (await fetch(url)).arrayBuffer();
  const run = rpc.call('recognize', { pgm, dpi }, { transfer: [pgm] });
  await new Promise((r) => setTimeout(r, afterMs));
  const t0 = performance.now();
  worker?.terminate();
  const terminateMs = Math.round(performance.now() - t0);
  const settled = await Promise.race([
    run.then(
      () => 'resolved',
      () => 'rejected',
    ),
    new Promise<string>((r) =>
      setTimeout(() => {
        r('pending');
      }, 500),
    ),
  ]);
  const t1 = performance.now();
  const again = await init();
  return { terminateMs, settled, reinitMs: Math.round(performance.now() - t1), again };
}

async function memory(): Promise<unknown> {
  const m = (
    performance as unknown as { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }> }
  ).measureUserAgentSpecificMemory;
  return m ? { mb: Math.round((await m.call(performance)).bytes / 1048576) } : { mb: null };
}

declare global {
  interface Window {
    __s17: Record<string, unknown>;
  }
}
window.__s17 = { probe, init, recognize, cancelAfter, memory };
statusEl.textContent = 'ready';
