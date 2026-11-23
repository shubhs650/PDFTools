// Comparison presets on this device (M12-21, D-58, Q35, §10.3): read once
// from IndexedDB and kept current here; saved from a result (Compare → Save
// as Preset…), picked in the input window's Options and applied when
// Compare runs; emptied by "Clear all local data". A preset's ignore zones
// are kept by sheet number and placed on the result's sheets as paired.
import { createStore, useStore } from 'zustand';
import { recordError } from '../../../app/diagnostics';
import { documentStore } from '../../../app/store/documentStore';
import { DEFAULT_SETTINGS } from '../../../model/compare/detect/entries';
import { placeZones, storeZones } from '../../../model/compare/detect/zoneSets';
import { DEFAULT_STYLE, hexOf, rgbOf } from '../../../model/compare/overlay';
import {
  namedPreset,
  presetsOf,
  type ComparePreset,
  type OverlayPreset,
  type TextPreset,
} from '../../../model/compare/presets';
import { DEFAULT_MARK_COLOURS } from '../../../model/compare/textView';
import { appDb } from '../../../storage/appDb';
import { diffView, updateDiff, withZones } from '../diff/diffState';
import type { Comparison } from '../model';
import { overlayView, setColour, sheetsOf, updateView } from '../overlay/overlayState';
import { pairingStore } from '../pairingFlow';
import {
  DEFAULT_RUN_OPTIONS,
  DEFAULT_TEXT_VIEW,
  textStore,
  updateTextView,
} from '../text/textFlow';

/** "Default settings" in the picker: the shipped settings, no preset. */
export const DEFAULT_PRESET = '';

/**
 * The settings carried over from the result a New comparison was opened from
 * (M12-24, ADR-033): picked like a preset, not saved on the device.
 */
export const CARRIED_PRESET = 'carried';

interface PresetState {
  presets: ComparePreset[];
  loaded: boolean;
  /**
   * Per comparison: the preset picked in its input window, and whether it is
   * still to be applied (Compare applies it once).
   */
  picked: Record<string, { id: string; pending: boolean }>;
  /** Per comparison opened by New comparison: the earlier result's settings (CARRIED_PRESET). */
  carried: Record<string, ComparePreset>;
  /** The comparison Save as Preset… is open for. */
  saving: string | null;
}

export const presetStore = createStore<PresetState>()(() => ({
  presets: [],
  loaded: false,
  picked: {},
  carried: {},
  saving: null,
}));

export function usePresets<T>(pick: (s: PresetState) => T): T {
  return useStore(presetStore, pick);
}

export async function loadPresets(): Promise<void> {
  try {
    const db = await appDb();
    presetStore.setState({ presets: presetsOf(await db.listComparePresets()), loaded: true });
  } catch (err) {
    recordError('compare.presets', err);
    presetStore.setState({ loaded: true });
  }
}

/** After "Clear all local data": no presets, read again when next needed. */
export function resetPresets(): void {
  presetStore.setState({ presets: [], loaded: false, picked: {}, carried: {}, saving: null });
}

let seq = 0;
const newPresetId = (): string => `preset-${Date.now().toString(36)}-${String(++seq)}`;

/** The result's sheets as paired (overlay), or none. */
function sheetsOfResult(id: string) {
  const p = pairingStore.getState().byId[id];
  return p?.status === 'done' ? sheetsOf(p.rows, p.pages) : [];
}

/** A PDF overlay result's settings as a preset holds them. */
export function overlaySettings(id: string): OverlayPreset {
  const v = overlayView(id);
  const d = diffView(id);
  const sheets = sheetsOfResult(id);
  return {
    colA: hexOf(v.style.colA),
    colB: hexOf(v.style.colB),
    sensitivity: d.sensitivity,
    minSize: d.minSize,
    zones: storeZones(d.zones, (pair) => sheets.findIndex((s) => s.pair === pair)),
  };
}

/** A text comparison result's settings as a preset holds them. */
export function textSettings(id: string): TextPreset {
  const v = textStore.getState().views[id] ?? DEFAULT_TEXT_VIEW;
  return {
    colours: { ...v.colours },
    headersFooters: v.options.headersFooters,
    renumbering: v.options.renumbering,
  };
}

/** Saves the result's settings under `name` (replacing a preset of that name); its id, or null. */
export async function savePreset(c: Comparison, name: string): Promise<string | null> {
  if (!presetStore.getState().loaded) await loadPresets();
  const settings =
    c.type === 'overlay'
      ? { type: 'overlay' as const, overlay: overlaySettings(c.id) }
      : { type: 'text' as const, text: textSettings(c.id) };
  const preset = namedPreset(
    presetStore.getState().presets,
    name,
    settings,
    newPresetId,
    Date.now(),
  );
  if (!preset) return null;
  await (await appDb()).putComparePreset(preset);
  await loadPresets();
  // This comparison now uses it: the input window shows it picked, nothing to apply.
  presetStore.setState((s) => ({
    picked: { ...s.picked, [c.id]: { id: preset.id, pending: false } },
  }));
  return preset.id;
}

/**
 * New comparison (M12-24, ADR-033): comparison `toId` starts with the settings
 * of `from`'s result (colours, sensitivity, minimum size and ignore zones, or
 * the text comparison's colours and options), applied when it is compared.
 */
export function carrySettings(from: Comparison, toId: string): void {
  const preset: ComparePreset =
    from.type === 'overlay'
      ? {
          id: CARRIED_PRESET,
          name: '',
          savedAt: Date.now(),
          type: 'overlay',
          overlay: overlaySettings(from.id),
        }
      : {
          id: CARRIED_PRESET,
          name: '',
          savedAt: Date.now(),
          type: 'text',
          text: textSettings(from.id),
        };
  presetStore.setState((s) => ({
    carried: { ...s.carried, [toId]: preset },
    picked: { ...s.picked, [toId]: { id: CARRIED_PRESET, pending: true } },
  }));
}

/** The settings carried into a comparison by New comparison, if they suit its type. */
export const carriedFor = (
  s: PresetState,
  comparisonId: string,
  type: Comparison['type'],
): ComparePreset | null => {
  const p = s.carried[comparisonId];
  return p?.type === type ? p : null;
};

/** Deletes a preset; comparisons that picked it go back to the default settings. */
export async function deletePreset(presetId: string): Promise<void> {
  await (await appDb()).deleteComparePreset(presetId);
  presetStore.setState((s) => ({
    picked: Object.fromEntries(
      Object.entries(s.picked).map(([k, p]) => [
        k,
        p.id === presetId ? { id: DEFAULT_PRESET, pending: p.pending } : p,
      ]),
    ),
  }));
  await loadPresets();
}

/** Picks a preset (or the default settings) for a comparison; applied when Compare runs. */
export function pickPreset(comparisonId: string, presetId: string): void {
  presetStore.setState((s) => ({
    picked: { ...s.picked, [comparisonId]: { id: presetId, pending: true } },
  }));
}

/** The preset picked for a comparison ('' : the default settings). */
export const pickedPreset = (s: PresetState, comparisonId: string): string =>
  s.picked[comparisonId]?.id ?? DEFAULT_PRESET;

const DEFAULT_OVERLAY: OverlayPreset = {
  colA: hexOf(DEFAULT_STYLE.colA),
  colB: hexOf(DEFAULT_STYLE.colB),
  sensitivity: DEFAULT_SETTINGS.sensitivity,
  minSize: 0,
  zones: [],
};

const DEFAULT_TEXT: TextPreset = {
  colours: DEFAULT_MARK_COLOURS,
  headersFooters: DEFAULT_RUN_OPTIONS.headersFooters,
  renumbering: DEFAULT_RUN_OPTIONS.renumbering,
};

/**
 * Compare runs: the preset picked in the input window (or the default
 * settings picked after one) goes into the result's settings, once.
 */
export function applyPickedPreset(c: Comparison): void {
  const pick = presetStore.getState().picked[c.id];
  if (!pick?.pending) return;
  presetStore.setState((s) => ({ picked: { ...s.picked, [c.id]: { ...pick, pending: false } } }));
  const preset =
    pick.id === CARRIED_PRESET
      ? carriedFor(presetStore.getState(), c.id, c.type)
      : presetStore.getState().presets.find((p) => p.id === pick.id);
  if (c.type === 'overlay') {
    const o = preset?.type === 'overlay' ? preset.overlay : DEFAULT_OVERLAY;
    updateView(c.id, (v) => setColour(setColour(v, 'a', rgbOf(o.colA)), 'b', rgbOf(o.colB)));
    const sheets = sheetsOfResult(c.id);
    updateDiff(c.id, (v) =>
      withZones(
        { ...v, sensitivity: o.sensitivity, minSize: o.minSize },
        placeZones(o.zones, (k) => sheets[k]?.pair),
      ),
    );
    return;
  }
  const t = preset?.type === 'text' ? preset.text : DEFAULT_TEXT;
  updateTextView(c.id, (v) => ({
    ...v,
    colours: { ...t.colours },
    options: { ...v.options, headersFooters: t.headersFooters, renumbering: t.renumbering },
  }));
}

/** The comparison in the selected tab when it shows a result (Save as Preset…). */
export function presetHost(): Comparison | null {
  const s = documentStore.getState();
  const c = s.activeTab ? s.comparisons[s.activeTab] : undefined;
  return c?.stage === 'result' ? c : null;
}

export function openSavePreset(comparisonId: string): void {
  presetStore.setState({ saving: comparisonId });
  if (!presetStore.getState().loaded) void loadPresets();
}

export function closeSavePreset(): void {
  presetStore.setState({ saving: null });
}
