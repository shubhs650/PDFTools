// The annotation plugin's state, read from React and from commands (M3-05).
import type { AnnotationCapability, AnnotationDocumentState } from '@embedpdf/plugin-annotation';
import { useEffect, useState } from 'react';
import { capability, hostStore, useHost } from '../view/host';

export function annotationCapability(): AnnotationCapability | null {
  const registry = hostStore.getState().registry;
  if (!registry) return null;
  try {
    return capability<AnnotationCapability>(registry, 'annotation');
  } catch {
    return null;
  }
}

/** The document's annotation state, or null before the plugin has it. */
export function annotationState(documentId: string): AnnotationDocumentState | null {
  try {
    return annotationCapability()?.forDocument(documentId).getState() ?? null;
  } catch {
    return null;
  }
}

/** Ids of the selected annotations on one page (they are left out of annotation tiles). */
export function selectedIdsOnPage(state: AnnotationDocumentState | null, pageIndex: number) {
  if (!state) return [];
  return state.selectedUids
    .map((uid) => state.byUid[uid]?.object)
    .filter((o) => o?.pageIndex === pageIndex)
    .map((o) => o?.id ?? '')
    .filter(Boolean)
    .sort();
}

const same = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

export function useSelectedIds(documentId: string, pageIndex: number): string[] {
  const registry = useHost((s) => s.registry);
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    if (!registry) return;
    const scope = annotationCapability()?.forDocument(documentId);
    if (!scope) return;
    const update = (state: AnnotationDocumentState): void => {
      const next = selectedIdsOnPage(state, pageIndex);
      setIds((prev) => (same(prev, next) ? prev : next));
    };
    try {
      update(scope.getState());
    } catch {
      // The document's state appears with its first change.
    }
    return scope.onStateChange(update);
  }, [registry, documentId, pageIndex]);
  return ids;
}
