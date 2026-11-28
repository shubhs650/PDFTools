// How Radius and Diameter are picked (M14-05, D-73, Q10): the centre then a
// point on the edge, or three points anywhere on the circle or arc. Chosen in
// the Properties pane while the tool is on, remembered for each tool on this
// device (localStorage; listed on the Privacy page, removed by Clear all local
// data).
import { createStore, useStore } from 'zustand';
import type { CurveMethod } from '../../model/measureCurve';

/** localStorage key (storage names keep "pdftools", D-41). */
export const CURVE_METHOD_STORAGE_KEY = 'pdftools.measureCurveMethod';

export interface CurveMethods {
  radius: CurveMethod;
  diameter: CurveMethod;
}

export const DEFAULT_CURVE_METHODS: CurveMethods = { radius: 'centre', diameter: 'centre' };

const isMethod = (v: unknown): v is CurveMethod => v === 'centre' || v === 'three';

/** The stored choice, or the defaults for anything missing or unreadable. */
export function parseCurveMethods(raw: string | null): CurveMethods {
  try {
    const o = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    return {
      radius: isMethod(o['radius']) ? o['radius'] : DEFAULT_CURVE_METHODS.radius,
      diameter: isMethod(o['diameter']) ? o['diameter'] : DEFAULT_CURVE_METHODS.diameter,
    };
  } catch {
    return { ...DEFAULT_CURVE_METHODS };
  }
}

function read(): CurveMethods {
  try {
    return parseCurveMethods(localStorage.getItem(CURVE_METHOD_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_CURVE_METHODS };
  }
}

export const curveMethodStore = createStore<CurveMethods>()(() => read());

export function useCurveMethod(tool: keyof CurveMethods): CurveMethod {
  return useStore(curveMethodStore, (s) => s[tool]);
}

export function setCurveMethod(tool: keyof CurveMethods, method: CurveMethod): void {
  curveMethodStore.setState({ [tool]: method });
  try {
    localStorage.setItem(CURVE_METHOD_STORAGE_KEY, JSON.stringify(curveMethodStore.getState()));
  } catch {
    // Not kept (private window): the choice holds until the app closes.
  }
}

/** Clear all local data: back to the defaults. */
export function resetCurveMethods(): void {
  curveMethodStore.setState({ ...DEFAULT_CURVE_METHODS });
  try {
    localStorage.removeItem(CURVE_METHOD_STORAGE_KEY);
  } catch {
    // nothing stored
  }
}
