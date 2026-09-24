// M0-S4 page: loads PDF Oxide in a module worker, then runs extraction jobs
// that Playwright drives through window.__s4. The main thread only posts
// messages (CLAUDE.md rule 1).

import { installProbes, probe } from '../shared/probe.ts';
import { AbortedError, RpcClient } from '../s3-two-engines/rpc.ts';
import type { OxideHandlers } from './oxide.worker.ts';

installProbes();

const WASM = new URL('/oxide/pdf_oxide_bg.wasm', location.origin).href;
const statusEl = document.getElementById('status') as HTMLOutputElement;
const worker = new Worker(new URL('./oxide.worker.ts', import.meta.url), {
  type: 'module',
  name: 'work',
});
const rpc = new RpcClient<OxideHandlers>(worker);

let job: AbortController | undefined;
const progress: unknown[] = [];

async function open(url: string): Promise<unknown> {
  const bytes = await (await fetch(url)).arrayBuffer();
  return rpc.call('open', { bytes }, { transfer: [bytes] });
}

function extract(mode: 'text' | 'markdown'): Promise<unknown> {
  job = new AbortController();
  progress.length = 0;
  return rpc.call('extract', { mode }, { signal: job.signal, onProgress: (p) => progress.push(p) });
}

/** Start a full extraction, cancel it after `afterMs`, and time the cancel. */
async function cancelAfter(mode: 'text' | 'markdown', afterMs: number): Promise<unknown> {
  const run = extract(mode);
  await new Promise((r) => setTimeout(r, afterMs));
  const t0 = performance.now();
  job?.abort();
  try {
    await run;
    return { cancelled: false };
  } catch (e) {
    return {
      cancelled: e instanceof AbortedError,
      cancelMs: Math.round(performance.now() - t0),
      progress: progress.at(-1),
    };
  }
}

declare global {
  interface Window {
    __s4: Record<string, unknown>;
  }
}
window.__s4 = {
  probe,
  init: () => rpc.call('init', { wasmUrl: WASM }),
  open,
  extract,
  cancelAfter,
  tables: (page: number) => rpc.call('tables', { page }),
  progress: () => progress.length,
};
statusEl.textContent = 'ready';
