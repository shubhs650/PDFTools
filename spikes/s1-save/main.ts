// M0-S1 page: drives save.worker.ts; the main thread only posts messages.
// Playwright calls window.__s1.scenario(); the owner can use the FSA button.

import { installProbes, probe } from '../shared/probe.ts';
import { RpcClient } from '../s3-two-engines/rpc.ts';
import type { SaveHandlers } from './save.worker.ts';

installProbes();

const statusEl = document.getElementById('status') as HTMLOutputElement;
const logEl = document.getElementById('log') as HTMLPreElement;
const fsaBtn = document.getElementById('fsa') as HTMLButtonElement;

const worker = new Worker(new URL('./save.worker.ts', import.meta.url), {
  type: 'module',
  name: 's1-save',
});
const rpc = new RpcClient<SaveHandlers>(worker);
const ready = rpc.call('init', { wasmUrl: new URL('/pdfium/pdfium.wasm', location.origin).href });

function show(v: unknown): void {
  logEl.textContent = JSON.stringify(v, null, 2);
}

async function scenario(name: string, markups = 100, url?: string): Promise<unknown> {
  await ready;
  const t0 = performance.now();
  const r = await rpc.call('scenario', {
    url: url ?? `/fixtures/${encodeURIComponent(name)}`,
    markups,
    name,
  });
  const longTasks = probe.longTasks.filter((l) => l.start >= t0).map((l) => Math.round(l.duration));
  const out = { ...r, mainThreadLongTasks: longTasks };
  show(out);
  return out;
}

fsaBtn.addEventListener('click', () => {
  const picker = (
    window as unknown as { showOpenFilePicker?: (o: unknown) => Promise<FileSystemFileHandle[]> }
  ).showOpenFilePicker;
  if (!picker) {
    show('File System Access API not available in this browser');
    return;
  }
  statusEl.value = 'picking';
  void (async () => {
    const [handle] = await picker({ types: [{ accept: { 'application/pdf': ['.pdf'] } }] });
    if (!handle) return;
    const perm = await (
      handle as unknown as { requestPermission(o: unknown): Promise<string> }
    ).requestPermission({
      mode: 'readwrite',
    });
    if (perm !== 'granted') throw new Error('write permission denied');
    statusEl.value = 'saving';
    show(await rpc.call('fsaAppend', { handle, markups: 100 }));
    statusEl.value = 'done';
  })().catch((e: unknown) => {
    show(String(e));
    statusEl.value = 'error';
  });
});

declare global {
  interface Window {
    __s1: Record<string, unknown>;
  }
}
window.__s1 = { scenario, probe };
void ready.then(() => (statusEl.value = 'ready'));
