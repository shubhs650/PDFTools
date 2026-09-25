// Heavy previews (M1-17): rendered in slices by the Render worker's
// progressive path, encoded in the encoder worker, cached like any render.
// PreviewLayer routes a page here when the cost model predicts > 100 ms.
import { isAbortError } from '../../engine/errors';
import type { RenderCost } from '../../workers/render/costModel';
import { renderEngine, tileCache } from './host';
import { renderStats } from './renderStats';

type PageCost = Pick<RenderCost, 'objects' | 'segments'>;

const costs = new Map<string, Promise<PageCost>>();

/** A page's object and segment counts, asked once per page. */
export function pageCost(docId: string, pageIndex: number): Promise<PageCost> {
  const key = `${docId}|${String(pageIndex)}`;
  let p = costs.get(key);
  if (!p) {
    p = renderEngine().rpc.call('pageCost', { docId, pageIndex }).promise;
    p.catch(() => costs.delete(key)); // retry next time
    costs.set(key, p);
  }
  return p;
}

/** Forget a closed document's page costs. */
export function dropPageCosts(docId: string): void {
  for (const key of costs.keys()) if (key.startsWith(`${docId}|`)) costs.delete(key);
}

export interface PreviewJob {
  promise: Promise<Blob>;
  cancel(): void;
}

export function progressivePreview(docId: string, pageIndex: number, scale: number): PreviewJob {
  const key = JSON.stringify(['progressive', docId, pageIndex, scale]);
  const hit = tileCache.get(key);
  if (hit) return { promise: Promise.resolve(hit), cancel: () => undefined };
  const r = renderEngine();
  const stats = renderStats.progressive;
  stats.requested++;
  const job = r.rpc.call('renderProgressive', { docId, pageIndex, scale });
  const promise = job.promise.then(
    async (out) => {
      stats.done++;
      stats.slices.push(out.slices);
      stats.maxSliceMs.push(out.maxSliceMs);
      const blob = await r.encoder.call(
        'encode',
        { data: out.data, width: out.width, height: out.height, type: 'image/png' },
        { transfer: [out.data.buffer] },
      ).promise;
      tileCache.set(key, docId, pageIndex, blob);
      return blob;
    },
    (err: unknown) => {
      if (isAbortError(err)) stats.cancelled++;
      throw err;
    },
  );
  return {
    promise,
    cancel: () => {
      job.cancel();
    },
  };
}
