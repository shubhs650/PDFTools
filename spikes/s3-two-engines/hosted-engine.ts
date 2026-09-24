// Main-thread side of the "hosted" Render worker: a Proxy that implements
// EmbedPDF's IPdfiumExecutor by forwarding every call to render.worker.ts,
// wrapped in EmbedPDF's own PdfEngine orchestrator (priority queue, encoding).
// EmbedPDF's RemoteExecutor does the same but is not exported.

import { PdfEngine, browserImageDataToBlobConverter } from '@embedpdf/engines/pdfium';
import { Task, type IPdfiumExecutor } from '@embedpdf/models';
import type { RenderIn, RenderOut } from './render.worker.ts';

export interface HostedRender {
  engine: PdfEngine;
  ready: Promise<{ ms: number; wasmBytes: number }>;
  special<T>(
    method: 'memory' | 'stats' | 'progressive',
    args?: unknown,
    transfer?: Transferable[],
  ): Promise<T>;
  cancelProgressive(): void;
  terminate(): void;
}

export function createHostedRender(wasmUrl: string): HostedRender {
  const worker = new Worker(new URL('./render.worker.ts', import.meta.url), {
    type: 'module',
    name: 'render',
  });
  const send = (m: RenderIn, transfer: Transferable[] = []): void => {
    worker.postMessage(m, { transfer });
  };
  let next = 1;
  const pending = new Map<number, Task<unknown, unknown>>();
  const specials = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >();
  let onReady: (v: { ms: number; wasmBytes: number }) => void = () => undefined;
  const ready = new Promise<{ ms: number; wasmBytes: number }>((r) => (onReady = r));

  worker.addEventListener('message', (ev: MessageEvent<RenderOut>) => {
    const m = ev.data;
    if (m.type === 'ready') {
      onReady({ ms: m.ms, wasmBytes: m.wasmBytes });
      return;
    }
    const sp = specials.get(m.id);
    if (sp) {
      specials.delete(m.id);
      if (m.type === 'result') sp.resolve(m.data);
      else if (m.type === 'error') sp.reject(m.error);
      return;
    }
    const task = pending.get(m.id);
    if (!task) return;
    if (m.type === 'progress') {
      task.progress(m.progress);
      return;
    }
    pending.delete(m.id);
    if (m.type === 'result') task.resolve(m.data);
    else task.fail(m.error as never);
  });
  send({ type: 'init', wasmUrl });

  const executor = new Proxy(
    {},
    {
      get(_t, method) {
        if (typeof method !== 'string' || method === 'then') return undefined;
        return (...args: unknown[]) => {
          const task = new Task<unknown, unknown>();
          const id = next++;
          pending.set(id, task);
          // Wait for WASM before the first call, like EmbedPDF's RemoteExecutor.
          void ready.then(() => {
            send({ type: 'exec', id, method, args });
          });
          return task;
        };
      },
    },
  ) as IPdfiumExecutor;

  const engine = new PdfEngine(executor, { imageConverter: browserImageDataToBlobConverter });

  return {
    engine,
    ready,
    special: <T>(
      method: 'memory' | 'stats' | 'progressive',
      args?: unknown,
      transfer: Transferable[] = [],
    ) =>
      new Promise<T>((resolve, reject) => {
        const id = next++;
        specials.set(id, { resolve: resolve as (v: unknown) => void, reject });
        void ready.then(() => {
          send({ type: 'special', id, method, args }, transfer);
        });
      }),
    cancelProgressive: () => {
      send({ type: 'cancelProgressive' });
    },
    terminate: () => {
      worker.terminate();
    },
  };
}
