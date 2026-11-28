// What a new Area or Volume starts with (M14-06, D-73, Q7, Q28): the Depth of
// the next Volume, set in the Properties pane before drawing and remembered,
// and the area and volume units and decimals chosen there ("Automatic" follows
// the scale). Remembered on this device (localStorage; listed on the Privacy
// page, removed by Clear all local data). A placed measurement keeps its own
// (the Properties pane changes it there).
import { createStore, useStore } from 'zustand';
import type { MeasureMeta } from '../../model/measureMarkup';
import {
  DEFAULT_DEPTH,
  isAreaUnit,
  isDecimals,
  isDepth,
  isVolumeUnit,
  QUANTITY_DECIMALS,
  type AreaUnit,
  type Depth,
  type VolumeUnit,
} from '../../model/measureQuantity';

/** localStorage key (storage names keep "pdftools", D-41). */
export const QUANTITY_STORAGE_KEY = 'pdftools.measureQuantities';

export interface QuantitySettings {
  depth: Depth;
  /** null: Automatic (from the scale). */
  areaUnit: AreaUnit | null;
  areaDecimals: number;
  volumeUnit: VolumeUnit | null;
  volumeDecimals: number;
}

export const DEFAULT_QUANTITIES: QuantitySettings = {
  depth: { ...DEFAULT_DEPTH },
  areaUnit: null,
  areaDecimals: QUANTITY_DECIMALS,
  volumeUnit: null,
  volumeDecimals: QUANTITY_DECIMALS,
};

/** The stored choices, or the defaults for anything missing or unreadable. */
export function parseQuantities(raw: string | null): QuantitySettings {
  try {
    const o = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const d = o['depth'];
    return {
      depth: isDepth(d) ? { value: d.value, unit: d.unit } : { ...DEFAULT_DEPTH },
      areaUnit: isAreaUnit(o['areaUnit']) ? o['areaUnit'] : null,
      areaDecimals: isDecimals(o['areaDecimals']) ? o['areaDecimals'] : QUANTITY_DECIMALS,
      volumeUnit: isVolumeUnit(o['volumeUnit']) ? o['volumeUnit'] : null,
      volumeDecimals: isDecimals(o['volumeDecimals']) ? o['volumeDecimals'] : QUANTITY_DECIMALS,
    };
  } catch {
    return { ...DEFAULT_QUANTITIES, depth: { ...DEFAULT_DEPTH } };
  }
}

function read(): QuantitySettings {
  try {
    return parseQuantities(localStorage.getItem(QUANTITY_STORAGE_KEY));
  } catch {
    return parseQuantities(null);
  }
}

export const quantityStore = createStore<QuantitySettings>()(() => read());

export function useQuantities<T>(pick: (s: QuantitySettings) => T): T {
  return useStore(quantityStore, pick);
}

export function setQuantities(change: Partial<QuantitySettings>): void {
  quantityStore.setState(change);
  try {
    localStorage.setItem(QUANTITY_STORAGE_KEY, JSON.stringify(quantityStore.getState()));
  } catch {
    // Not kept (private window): the choice holds until the app closes.
  }
}

/** Clear all local data: back to the defaults. */
export function resetQuantities(): void {
  quantityStore.setState(parseQuantities(null));
  try {
    localStorage.removeItem(QUANTITY_STORAGE_KEY);
  } catch {
    // nothing stored
  }
}

/**
 * What a new Area or Volume gets from the remembered choices: its units and
 * decimals where they are not the defaults, and a Volume's depth.
 */
export function rememberedMeta(
  tool: MeasureMeta['tool'],
  s: QuantitySettings = quantityStore.getState(),
): Partial<MeasureMeta> {
  if (tool !== 'area' && tool !== 'volume') return {};
  const out: Partial<MeasureMeta> = {};
  if (s.areaUnit) out.areaUnit = s.areaUnit;
  if (s.areaDecimals !== QUANTITY_DECIMALS) out.areaDecimals = s.areaDecimals;
  if (tool === 'volume') {
    out.depth = { ...s.depth };
    if (s.volumeUnit) out.volumeUnit = s.volumeUnit;
    if (s.volumeDecimals !== QUANTITY_DECIMALS) out.volumeDecimals = s.volumeDecimals;
  }
  return out;
}
