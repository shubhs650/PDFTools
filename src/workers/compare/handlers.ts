// The Compare worker's handlers (M12-07, D-66) over one store, apart from the
// worker module so tests can serve them on a MessageChannel.
import { ocrPageText } from '../../model/compare/text/ocrText';
import type { CompareApi } from '../../engine/compareApi';
import { RpcError } from '../../engine/errors';
import { Transfer } from '../../engine/protocol';
import type { Handlers } from '../rpc-host';
import type { CompareStore } from './store';

/** Store errors are ours and name no document content (rule 10). */
function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof RpcError) throw err;
    throw new RpcError('compare-state', err instanceof Error ? err.message : 'compare state');
  }
}

export function compareHandlers(store: CompareStore): Handlers<CompareApi> {
  return {
    open: ({ cmpId }) => {
      store.open(cmpId);
      return null;
    },
    putSignature: ({ cmpId, side, page, signature }, ctx) => {
      ctx.throwIfAborted();
      return { bytes: guard(() => store.putSignature(cmpId, side, page, signature)) };
    },
    putText: ({ cmpId, side, page, text, layout }, ctx) => {
      ctx.throwIfAborted();
      return { bytes: guard(() => store.putText(cmpId, side, page, text, layout)) };
    },
    putOcr: ({ cmpId, side, page, lines, dpi, frame, turn }, ctx) => {
      ctx.throwIfAborted();
      return {
        bytes: guard(() =>
          store.putText(cmpId, side, page, ocrPageText(lines, dpi, frame, turn), true),
        ),
      };
    },
    matchText: ({ cmpId, pages, ...options }, ctx) => {
      const result = guard(() =>
        store.matchText(cmpId, pages, options, (stage, done, total) => {
          ctx.throwIfAborted();
          ctx.progress({ stage, done, total });
        }),
      );
      return new Transfer(result, [result.sync.buffer as ArrayBuffer]);
    },
    sheetBand: ({ cmpId, sheet, dpi, a, b, inkLevel }, ctx) => {
      ctx.throwIfAborted();
      return { rows: guard(() => store.sheetBand(cmpId, sheet, dpi, a, b, inkLevel)) };
    },
    pairPages: ({ cmpId, a, b, threshold }, ctx) => {
      const result = guard(() =>
        store.pairPages(cmpId, a, b, threshold, (done, total) => {
          ctx.throwIfAborted();
          ctx.progress({ done, total });
        }),
      );
      return new Transfer(result, [result.sim.buffer as ArrayBuffer]);
    },
    putGeometry: ({ cmpId, side, page, segments }, ctx) => {
      ctx.throwIfAborted();
      const features = guard(() => store.putGeometry(cmpId, side, page, segments));
      return { features, bytes: store.summary(cmpId).bytes };
    },
    alignAsIs: ({ cmpId, a, b }) => guard(() => store.alignAsIs(cmpId, a, b)),
    alignVector: ({ cmpId, sheet, a, b, coarse }, ctx) =>
      guard(() =>
        store.alignVector(cmpId, sheet, a, b, coarse, () => {
          ctx.throwIfAborted();
        }),
      ),
    putAlignBand: ({ cmpId, sheet, side, band }, ctx) => {
      ctx.throwIfAborted();
      return { bytes: guard(() => store.putAlignBand(cmpId, sheet, side, band)) };
    },
    alignImage: ({ cmpId, sheet, scale }, ctx) =>
      guard(() =>
        store.alignImage(cmpId, sheet, scale, () => {
          ctx.throwIfAborted();
        }),
      ),
    setAlignment: ({ cmpId, sheet, alignment }) => {
      guard(() => {
        store.setAlignment(cmpId, sheet, alignment);
      });
      return null;
    },
    sheetFacts: ({ cmpId, sheet }) => guard(() => store.sheetFacts(cmpId, sheet)),
    summary: ({ cmpId }) => guard(() => store.summary(cmpId)),
    release: ({ cmpId }) => ({ freedBytes: store.release(cmpId) }),
    memory: () => store.memory(),
  };
}
