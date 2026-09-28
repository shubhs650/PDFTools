// Status schemes in memory (M3-13, D-23): the presets plus the user's own,
// loaded from IndexedDB once; the active one drives stamps (M3-14) and the CRS
// header (M3-19). Nothing here is logged (rule 10).
import { createStore, useStore } from 'zustand';
import { recordError } from '../../../app/diagnostics';
import {
  DEFAULT_SCHEME,
  DEFAULT_SCHEME_ID,
  PRESETS,
  validateScheme,
  type StatusScheme,
} from '../../../model/statusScheme';
import { appDb } from '../../../storage/appDb';

const ACTIVE_KEY = 'activeScheme';

interface SchemesState {
  custom: StatusScheme[];
  activeId: string;
  loaded: boolean;
  dialogOpen: boolean;
}

export const schemeStore = createStore<SchemesState>()(() => ({
  custom: [],
  activeId: DEFAULT_SCHEME_ID,
  loaded: false,
  dialogOpen: false,
}));

export function useSchemes<T>(selector: (s: SchemesState) => T): T {
  return useStore(schemeStore, selector);
}

export const allSchemes = (s: SchemesState = schemeStore.getState()): StatusScheme[] => [
  ...PRESETS,
  ...s.custom,
];

/** A stored scheme is always validated as a custom one. */
function withoutPreset(v: StatusScheme): StatusScheme {
  const rest = { ...v };
  delete rest.preset;
  return rest;
}

/** The active scheme (the default preset when the stored one is gone). */
export function activeScheme(s: SchemesState = schemeStore.getState()): StatusScheme {
  return allSchemes(s).find((x) => x.id === s.activeId) ?? DEFAULT_SCHEME;
}

let loading: Promise<void> | null = null;

export function loadSchemes(): Promise<void> {
  loading ??= appDb()
    .then(async (db) => {
      const [stored, active] = await Promise.all([
        db.listSchemes(),
        db.getSetting<string>(ACTIVE_KEY),
      ]);
      // Only well-formed schemes come back (a damaged record is skipped).
      const custom = stored.filter(
        (v): v is StatusScheme =>
          typeof v === 'object' &&
          v !== null &&
          typeof (v as StatusScheme).id === 'string' &&
          Array.isArray((v as StatusScheme).codes) &&
          validateScheme(withoutPreset(v as StatusScheme)).length === 0,
      );
      schemeStore.setState({
        custom,
        activeId: typeof active === 'string' ? active : DEFAULT_SCHEME_ID,
        loaded: true,
      });
    })
    .catch((err: unknown) => {
      recordError('schemes.load', err);
      schemeStore.setState({ loaded: true });
    });
  return loading;
}

async function persist(
  job: (db: Awaited<ReturnType<typeof appDb>>) => Promise<void>,
): Promise<boolean> {
  try {
    await job(await appDb());
    return true;
  } catch (err) {
    recordError('schemes.save', err);
    return false;
  }
}

export function saveScheme(s: StatusScheme): Promise<boolean> {
  schemeStore.setState((st) => ({
    custom: st.custom.some((c) => c.id === s.id)
      ? st.custom.map((c) => (c.id === s.id ? s : c))
      : [...st.custom, s],
  }));
  return persist((db) => db.putScheme(s));
}

export function deleteScheme(id: string): Promise<boolean> {
  schemeStore.setState((st) => ({
    custom: st.custom.filter((c) => c.id !== id),
    activeId: st.activeId === id ? DEFAULT_SCHEME_ID : st.activeId,
  }));
  return persist(async (db) => {
    await db.deleteScheme(id);
    await db.setSetting(ACTIVE_KEY, schemeStore.getState().activeId);
  });
}

export function setActiveScheme(id: string): Promise<boolean> {
  schemeStore.setState({ activeId: id });
  return persist((db) => db.setSetting(ACTIVE_KEY, id));
}

export function openSchemes(): void {
  void loadSchemes();
  schemeStore.setState({ dialogOpen: true });
}

export function closeSchemes(): void {
  schemeStore.setState({ dialogOpen: false });
}

/** "Clear all local data": back to the presets. */
export function resetSchemes(): void {
  loading = null;
  schemeStore.setState({ custom: [], activeId: DEFAULT_SCHEME_ID, loaded: true });
}
