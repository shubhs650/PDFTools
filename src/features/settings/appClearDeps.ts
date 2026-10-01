// The app's side of "Clear all local data" (clearAll.ts, M1-26).
import { storageClient } from '../../engine/storageClient';
import { deleteAppDb } from '../../storage/appDb';
import { recentStore } from '../recent/recent';
import { recoveryStore } from '../recovery/recovery';
import { resetProfile } from './profile/profileStore';
import { resetSchemes } from '../stamps/schemes/schemeStore';
import { resetTemplates } from '../tables/templateStore';
import type { ClearDeps } from './clearAll';

const hasCaches = (): boolean => typeof caches !== 'undefined';

export const appClearDeps: ClearDeps = {
  clearRecovery: async () => {
    await storageClient().call('clearAll', null).promise;
  },
  deleteDatabase: deleteAppDb,
  cacheNames: () => (hasCaches() ? caches.keys() : Promise.resolve([])),
  deleteCache: (name) => caches.delete(name),
  reset: () => {
    recoveryStore.setState({ offers: [] });
    // The database is recreated, empty, the next time something needs it.
    recentStore.setState({ entries: [], problem: null });
    resetProfile();
    resetSchemes();
    resetTemplates();
  },
};
