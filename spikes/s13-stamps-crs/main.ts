// M3-02 spike page (ADR-015): dynamic stamps drawn in a worker, and a CRS-shaped
// XLSX built by ExcelJS in a worker, under the §10.1 CSP (served verbatim, with
// COOP/COEP). Playwright drives window.__s13 and reads the probes.
import { installProbes, probe } from '../shared/probe.ts';
import type { StampSpec } from './stamp.worker.ts';

installProbes();

const b64 = (buf: ArrayBuffer): string => {
  let s = '';
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

function run<T>(worker: Worker, msg: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<T & { error?: string }>) => {
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data);
    };
    worker.postMessage(msg);
  });
}

const stampWorker = new Worker(new URL('./stamp.worker.ts', import.meta.url), { type: 'module' });
const xlsxWorker = new Worker(new URL('./xlsx.worker.ts', import.meta.url), { type: 'module' });

const api = {
  probe,
  async stamp(spec: StampSpec) {
    const r = await run<{ png: ArrayBuffer; ms: number; w: number; h: number }>(stampWorker, spec);
    return { png: b64(r.png), bytes: r.png.byteLength, ms: r.ms, w: r.w, h: r.h };
  },
  async xlsx(rows: number, images: boolean, cancelAt?: number) {
    const t0 = performance.now();
    const r = await run<Record<string, unknown> & { buffer?: ArrayBuffer }>(xlsxWorker, {
      rows,
      images,
      cancelAt,
    });
    const { buffer, ...rest } = r;
    // Main thread only receives the finished bytes (transferred).
    return {
      ...rest,
      total: performance.now() - t0,
      b64: buffer && rows <= 60 ? b64(buffer) : null,
    };
  },
  memory: async () =>
    (
      performance as unknown as {
        measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
      }
    )
      .measureUserAgentSpecificMemory?.()
      .then((m) => m.bytes) ?? null,
};

(window as unknown as { __s13: typeof api }).__s13 = api;
document.title = 'S13 ready';
