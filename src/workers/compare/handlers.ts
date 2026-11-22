// The Compare worker's handlers (M12-07, D-66) over one store, apart from the
// worker module so tests can serve them on a MessageChannel.
import type { CompareApi } from '../../engine/compareApi';
import { RpcError } from '../../engine/errors';
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
    putText: ({ cmpId, side, page, text }, ctx) => {
      ctx.throwIfAborted();
      return { bytes: guard(() => store.putText(cmpId, side, page, text)) };
    },
    sheetBand: ({ cmpId, sheet, dpi, a, b, inkLevel }, ctx) => {
      ctx.throwIfAborted();
      return { rows: guard(() => store.sheetBand(cmpId, sheet, dpi, a, b, inkLevel)) };
    },
    sheetFacts: ({ cmpId, sheet }) => guard(() => store.sheetFacts(cmpId, sheet)),
    summary: ({ cmpId }) => guard(() => store.summary(cmpId)),
    release: ({ cmpId }) => ({ freedBytes: store.release(cmpId) }),
    memory: () => store.memory(),
  };
}
