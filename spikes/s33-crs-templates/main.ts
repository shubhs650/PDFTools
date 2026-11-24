// Spike S33 (M13-06) page: runs the template fill in a worker under the
// §10.1 CSP and reports time, size and main-thread long tasks.
import { installProbes, probe } from '../shared/probe.ts';
import type { Job } from './xlsx.worker.ts';

installProbes();
const worker = new Worker(new URL('./xlsx.worker.ts', import.meta.url), { type: 'module' });

const api = {
  probe,
  run(job: Job) {
    const t0 = performance.now();
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      worker.onmessage = (
        e: MessageEvent<Record<string, unknown> & { error?: string; buffer?: ArrayBuffer }>,
      ) => {
        if (e.data.error) {
          reject(new Error(e.data.error));
          return;
        }
        const { buffer, ...rest } = e.data;
        const head = buffer ? Array.from(new Uint8Array(buffer, 0, 2)) : [];
        resolve({ ...rest, total: performance.now() - t0, zipMagic: head });
      };
      worker.postMessage(job);
    });
  },
};

(window as unknown as { __s33: typeof api }).__s33 = api;
document.title = 'S33 ready';
