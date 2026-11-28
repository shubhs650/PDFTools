// Measurement state on the main thread (M3-16): the shape being drawn, for the
// live value next to the pointer. Plain arithmetic only (rule 1): the value is
// computed from the plugin's preview points and the page's scale.
import { createStore, useStore } from 'zustand';
import type { CurveMethod } from '../../model/measureCurve';
import type { MeasureKind } from '../../model/measurement';
import type { QuantityMeta } from '../../model/measureQuantity';
import type { MeasureMeta } from '../../model/measureMarkup';
import type { Pt } from '../../model/scale';

export interface LiveMeasure {
  page: number;
  kind: MeasureKind;
  /** Points so far, the pointer last (EmbedPDF page points, top-left origin). */
  pts: Pt[];
  /** Where the value shows, when not at the last point (a Distance's offset: the pointer). */
  at?: Pt;
  /** A Distance's leader lines while its offset is set (M13-10), with its colour and width. */
  leaders?: [Pt, Pt][];
  color?: string;
  width?: number;
  /**
   * An Angle, Radius or Diameter being placed (M14-05): its own preview is
   * drawn here (a Stamp has none in the plugin), by the method it is picked with.
   */
  method?: CurveMethod;
  /** An Area's or Volume's own units, and a Volume's depth (M14-06): the live value is its volume. */
  q?: QuantityMeta;
  /** The count the next click places (M14-07): its group, number and look; `pts` its centre. */
  count?: MeasureMeta;
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
