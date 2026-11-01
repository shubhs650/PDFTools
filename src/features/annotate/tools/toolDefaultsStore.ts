// The comment tools' default styles in memory (M6-03, D-37): the user's
// overrides of the shipped defaults (toolDefaults.ts), loaded from IndexedDB
// once. drawTools.ts applies them to the annotation plugin's tools; the
// Properties pane (M6-06) and the style palette (M6-07) change them here.
// Nothing here is logged (rule 10).
import { createStore, useStore } from 'zustand';
import { recordError } from '../../../app/diagnostics';
import { appDb } from '../../../storage/appDb';
import {
  cleanProps,
  effectiveDefaults,
  isStyleTool,
  migrateStored,
  TOOL_DEFAULTS_VERSION,
  type Overrides,
  type StoredToolDefaults,
  type StyleProps,
  type StyleTool,
} from './toolDefaults';

interface ToolDefaultsState {
  overrides: Overrides;
  loaded: boolean;
}

export const toolDefaultsStore = createStore<ToolDefaultsState>()(() => ({
  overrides: {},
  loaded: false,
}));

export function useToolDefaults<T>(selector: (s: ToolDefaultsState) => T): T {
  return useStore(toolDefaultsStore, selector);
}

/** What a new comment of `tool` gets now. */
export const defaultsFor = (tool: StyleTool): StyleProps =>
  effectiveDefaults(tool, toolDefaultsStore.getState().overrides);

let loading: Promise<void> | null = null;

export function loadToolDefaults(): Promise<void> {
  loading ??= appDb()
    .then(async (db) => {
      const overrides: Overrides = {};
      for (const [tool, raw] of await db.listToolDefaults()) {
        // A damaged record, or one for a tool we no longer have, is skipped.
        const rec = isStyleTool(tool) ? migrateStored(raw) : null;
        if (rec && isStyleTool(tool)) overrides[tool] = rec.props;
      }
      toolDefaultsStore.setState((s) => ({
        // Anything set while loading wins over what was stored.
        overrides: { ...overrides, ...s.overrides },
        loaded: true,
      }));
    })
    .catch((err: unknown) => {
      recordError('toolDefaults.load', err);
      toolDefaultsStore.setState({ loaded: true });
    });
  return loading;
}

async function persist(tool: StyleTool, props: StyleProps | undefined): Promise<void> {
  try {
    const db = await appDb();
    if (props && Object.keys(props).length > 0) {
      const rec: StoredToolDefaults = { v: TOOL_DEFAULTS_VERSION, props };
      await db.putToolDefaults(tool, rec);
    } else await db.deleteToolDefaults(tool);
  } catch (err) {
    recordError('toolDefaults.save', err);
  }
}

/** Makes `props` part of `tool`'s defaults (merged with what the user set before). */
export function setToolDefaults(tool: StyleTool, props: StyleProps): Promise<void> {
  const next = { ...toolDefaultsStore.getState().overrides[tool], ...cleanProps(props) };
  toolDefaultsStore.setState((s) => ({ overrides: { ...s.overrides, [tool]: next } }));
  return persist(tool, next);
}

/** Back to the shipped defaults for `tool`. */
export function resetToolDefaults(tool: StyleTool): Promise<void> {
  const rest = Object.fromEntries(
    Object.entries(toolDefaultsStore.getState().overrides).filter(([k]) => k !== tool),
  ) as Overrides;
  toolDefaultsStore.setState({ overrides: rest });
  return persist(tool, undefined);
}

/** "Clear all local data" (the database is deleted separately). */
export function resetAllToolDefaults(): void {
  loading = null;
  toolDefaultsStore.setState({ overrides: {}, loaded: false });
}
