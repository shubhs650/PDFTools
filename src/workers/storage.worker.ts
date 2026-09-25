// Storage worker (M1-12): owns OPFS, because sync access handles exist only in
// dedicated workers and are exclusive per file, so one owner avoids lock
// conflicts. Pure JS, no PDFium. Also computes document fingerprints.
import type { StorageApi } from '../engine/storageApi';
import { Transfer } from '../engine/protocol';
import { fingerprint } from '../storage/fingerprint';
import { OpfsStore } from '../storage/opfs';
import { serve } from './rpc-host';

let store: Promise<OpfsStore> | undefined;
const opfs = (): Promise<OpfsStore> => (store ??= OpfsStore.open());

serve<StorageApi>(self, {
  fingerprint: ({ file }) => fingerprint(file),

  putOriginal: async ({ fp, source }, ctx) =>
    (await opfs()).putOriginal(fp, source, {
      signal: ctx.signal,
      progress: (done, total) => {
        ctx.progress({ done, total });
      },
    }),

  writeTail: async ({ fp, tail, ui }) => {
    await (await opfs()).writeTail(fp, tail, ui);
    return null;
  },

  writeUiState: async ({ fp, ui }) => {
    await (await opfs()).writeUiState(fp, ui);
    return null;
  },

  list: async () => (await opfs()).list(),

  read: async ({ fp }) => {
    const { original, tail, ui } = await (await opfs()).read(fp);
    return new Transfer({ original, tail, ...(ui ? { ui } : {}) }, [original, tail]);
  },

  discard: async ({ fp }) => {
    await (await opfs()).discard(fp);
    return null;
  },

  clearAll: async () => {
    await (await opfs()).clearAll();
    return null;
  },
});
