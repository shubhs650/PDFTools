// "Update old measurements" (M14-03, Q38): each Triya PDF 1.1.0 measurement
// and its grouped text box become one markup, its caption drawn in its own
// appearance, all in one undo step. The bar above the document offers it
// (OldMeasurementsBar); the command is in Tell Me and the menus too.
import type { AnnotationCapability } from '@embedpdf/plugin-annotation';
import type { PdfAnnotationObject } from '@embedpdf/models';
import { createStore, useStore } from 'zustand';
import { oldPairs, type OldPair } from '../../model/measureUpgrade';
import type { MeasureMeta } from '../../model/measureMarkup';
import { joinStep } from '../annotate/historyJoin';
import { capability, hostStore } from '../view/host';
import { kindOf, toolOf } from './measurements';

/** The pairs of a document's annotations. */
export const pairsOf = (docId: string, annots: readonly PdfAnnotationObject[]): OldPair[] =>
  oldPairs(annots, (a) => kindOf(docId, a) !== null);

/** How many measurements the last update in each document converted (the bar says so). */
export const upgradeStore = createStore<{ done: Record<string, number> }>()(() => ({ done: {} }));

export const useUpgraded = (docId: string): number | undefined =>
  useStore(upgradeStore, (s) => s.done[docId]);

/** Converts every pair in the document; returns how many. */
export function upgradeOldMeasurements(docId: string): number {
  const registry = hostStore.getState().registry;
  if (!registry) return 0;
  const scope = capability<AnnotationCapability>(registry, 'annotation').forDocument(docId);
  const pairs = pairsOf(
    docId,
    scope.getAnnotations().map((ta) => ta.object),
  );
  let first = true;
  const step = (fn: () => void) => {
    if (first) {
      first = false;
      fn();
    } else joinStep(fn);
  };
  for (const { measure, label } of pairs) {
    const tool = toolOf(docId, measure);
    if (!tool) continue;
    const meta: MeasureMeta = tool === 'length' ? { tool, cap: 'top' } : { tool };
    step(() => {
      scope.updateAnnotation(measure.pageIndex, measure.id, {
        measure: meta,
      } as Partial<PdfAnnotationObject>);
    });
    step(() => {
      scope.deleteAnnotation(label.pageIndex, label.id);
    });
  }
  const n = pairs.length;
  if (n > 0) upgradeStore.setState((s) => ({ done: { ...s.done, [docId]: n } }));
  return n;
}
