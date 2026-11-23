// The saved ignore zone sets (M12-14, D-61, Q22), read once from IndexedDB
// and kept current here; emptied by "Clear all local data".
import { createStore } from 'zustand';
import { recordError } from '../../../app/diagnostics';
import { zoneSetsOf, type ZoneSet } from '../../../model/compare/detect/zoneSets';
import { appDb } from '../../../storage/appDb';

export const zoneSetsStore = createStore<{ sets: ZoneSet[]; loaded: boolean }>()(() => ({
  sets: [],
  loaded: false,
}));

export async function loadZoneSets(): Promise<void> {
  try {
    const db = await appDb();
    zoneSetsStore.setState({ sets: zoneSetsOf(await db.listZoneSets()), loaded: true });
  } catch (err) {
    recordError('compare.zoneSets', err);
    zoneSetsStore.setState({ loaded: true });
  }
}

/** After "Clear all local data": no sets, read again when next needed. */
export function resetZoneSets(): void {
  zoneSetsStore.setState({ sets: [], loaded: false });
}
