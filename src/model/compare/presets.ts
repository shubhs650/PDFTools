// Named comparison presets (M12-21, D-58, Q35, ARCHITECTURE §7.16, §10.3):
// the settings a reviewer uses again and again, saved from a result and
// picked in the input window, kept on this device in IndexedDB. A PDF
// overlay's preset holds its colours, the detection's sensitivity and
// minimum size, and its ignore zones (a zone set inside the preset); a text
// comparison's holds the mark colours and the header and renumbering
// handling. Records are validated on the way in: storage is never trusted.
// Pure.
import { SENSITIVITIES, type Sensitivity } from './detect/entries';
import { MAX_SET_NAME, MAX_SET_ZONES, zoneSetOf, type StoredZone } from './detect/zoneSets';
import { MARK_COLOUR_KEYS, type MarkColours } from './textView';

export interface OverlayPreset {
  /** Document A's and Document B's colours, "#rrggbb". */
  colA: string;
  colB: string;
  sensitivity: Sensitivity;
  /** Smallest difference listed, mm (0: every one). */
  minSize: number;
  /** Ignore zones, for every sheet or one sheet by its number in the result. */
  zones: StoredZone[];
}

export interface TextPreset {
  colours: MarkColours;
  /** Leave headers and footers out and report a changed one once. */
  headersFooters: boolean;
  /** Report clause renumbering once. */
  renumbering: boolean;
}

export type ComparePreset = {
  id: string;
  name: string;
  savedAt: number;
} & ({ type: 'overlay'; overlay: OverlayPreset } | { type: 'text'; text: TextPreset });

/** Longest preset name kept (as a zone set's). */
export const MAX_PRESET_NAME = MAX_SET_NAME;
/** Largest minimum size kept, mm. */
const MAX_MIN_SIZE = 1000;

const HEX = /^#[0-9a-f]{6}$/u;
const hex = (v: unknown): string | null =>
  typeof v === 'string' && HEX.test(v.toLowerCase()) ? v.toLowerCase() : null;

function overlayOf(v: unknown): OverlayPreset | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Partial<Record<keyof OverlayPreset, unknown>>;
  const colA = hex(o.colA);
  const colB = hex(o.colB);
  const sensitivity = SENSITIVITIES.find((s) => s === o.sensitivity);
  const min = o.minSize;
  if (!colA || !colB || !sensitivity) return null;
  if (typeof min !== 'number' || !Number.isFinite(min) || min < 0 || min > MAX_MIN_SIZE)
    return null;
  // The zones are checked as a zone set's are (zoneSets.ts).
  const set = zoneSetOf({ id: 'preset', name: 'preset', zones: o.zones ?? [] });
  if (!set) return null;
  return { colA, colB, sensitivity, minSize: min, zones: set.zones };
}

function textOf(v: unknown): TextPreset | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Partial<Record<keyof TextPreset, unknown>>;
  const c = o.colours as Partial<Record<keyof MarkColours, unknown>> | null | undefined;
  if (typeof c !== 'object' || c === null) return null;
  const colours: Partial<MarkColours> = {};
  for (const k of MARK_COLOUR_KEYS) {
    const h = hex(c[k]);
    if (!h) return null;
    colours[k] = h;
  }
  if (typeof o.headersFooters !== 'boolean' || typeof o.renumbering !== 'boolean') return null;
  return {
    colours: colours as MarkColours,
    headersFooters: o.headersFooters,
    renumbering: o.renumbering,
  };
}

/** A stored preset, or null when the record is not one. */
export function presetOf(v: unknown): ComparePreset | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Partial<Record<'id' | 'name' | 'savedAt' | 'type' | 'overlay' | 'text', unknown>>;
  if (typeof r.id !== 'string' || !r.id || typeof r.name !== 'string') return null;
  const name = r.name.trim().slice(0, MAX_PRESET_NAME);
  if (!name) return null;
  const savedAt = typeof r.savedAt === 'number' && Number.isFinite(r.savedAt) ? r.savedAt : 0;
  const base = { id: r.id, name, savedAt };
  if (r.type === 'overlay') {
    const overlay = overlayOf(r.overlay);
    return overlay ? { ...base, type: 'overlay', overlay } : null;
  }
  if (r.type === 'text') {
    const text = textOf(r.text);
    return text ? { ...base, type: 'text', text } : null;
  }
  return null;
}

/** Stored presets, valid ones only, by name. */
export function presetsOf(list: readonly unknown[]): ComparePreset[] {
  return list
    .map(presetOf)
    .filter((p): p is ComparePreset => p !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The presets for a comparison type, by name. */
export const presetsFor = (
  presets: readonly ComparePreset[],
  type: ComparePreset['type'],
): ComparePreset[] => presets.filter((p) => p.type === type);

/**
 * A preset to store under `name`: one of the same type and name is replaced
 * (it keeps its id), so saving again updates it.
 */
export function namedPreset(
  existing: readonly ComparePreset[],
  name: string,
  settings: { type: 'overlay'; overlay: OverlayPreset } | { type: 'text'; text: TextPreset },
  newId: () => string,
  now: number,
): ComparePreset | null {
  const n = name.trim().slice(0, MAX_PRESET_NAME);
  if (!n) return null;
  const same = existing.find((p) => p.type === settings.type && p.name === n);
  const base = { id: same?.id ?? newId(), name: n, savedAt: now };
  return settings.type === 'overlay'
    ? {
        ...base,
        type: 'overlay',
        overlay: { ...settings.overlay, zones: settings.overlay.zones.slice(0, MAX_SET_ZONES) },
      }
    : { ...base, type: 'text', text: settings.text };
}
