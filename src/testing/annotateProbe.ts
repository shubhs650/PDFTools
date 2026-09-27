// E2E-only probe for the annotation layer (M3-05). Never part of a production
// build. Reads the annotation plugin's store and history, and the render stats
// of annotation tiles, without depending on DOM details.
import type { HistoryCapability } from '@embedpdf/plugin-history';
import { annotationCapability, annotationState } from '../features/annotate/selection';
import { capability, hostStore } from '../features/view/host';
import type { TestHook } from './hook';

function history(): HistoryCapability | null {
  const registry = hostStore.getState().registry;
  return registry ? capability<HistoryCapability>(registry, 'history') : null;
}

export function registerAnnotateProbe(hook: TestHook): void {
  hook.capabilities['annotate'] = {
    /** Annotations in the plugin's store: id, page, subtype, rect, author. */
    list: (docId: string) => {
      const st = annotationState(docId);
      if (!st) return null;
      return Object.values(st.byUid).map((t) => ({
        id: t.object.id,
        page: t.object.pageIndex,
        type: t.object.type,
        rect: t.object.rect,
        author: t.object.author ?? null,
        contents: t.object.contents ?? null,
        commit: t.commitState,
      }));
    },
    selected: (docId: string) =>
      annotationCapability()?.forDocument(docId).getSelectedAnnotationIds() ?? [],
    select: (docId: string, page: number, id: string) => {
      annotationCapability()?.forDocument(docId).selectAnnotation(page, id);
    },
    canUndo: (docId: string) => history()?.forDocument(docId).canUndo() ?? false,
  };
}
