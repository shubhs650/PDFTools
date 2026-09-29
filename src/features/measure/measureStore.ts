// Measurement state on the main thread (M3-16): the shape being drawn, for the
// live value next to the pointer. Plain arithmetic only (rule 1): the value is
// computed from the plugin's preview points and the page's scale.
import { createStore, useStore } from 'zustand';
import type { MeasureKind } from '../../model/measurement';
import type { Pt } from '../../model/scale';

export interface LiveMeasure {
  page: number;
  kind: MeasureKind;
  /** Points so far, the pointer last (EmbedPDF page points, top-left origin). */
  pts: Pt[];
}

interface MeasureState {
  live: LiveMeasure | null;
}

export const measureStore = createStore<MeasureState>()(() => ({ live: null }));

export function useMeasure<T>(selector: (s: MeasureState) => T): T {
  return useStore(measureStore, selector);
}

export function setLive(live: LiveMeasure | null): void {
  const cur = measureStore.getState().live;
  if (cur === live) return;
  measureStore.setState({ live });
}
