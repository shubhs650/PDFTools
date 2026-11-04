// The annotation plugin's state, read from React and from commands (M3-05).
import type { PdfAnnotationObject } from '@embedpdf/models';
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

/** The selected annotations of a document, as objects (Properties pane, M3-10). */
export function useSelectedAnnotations(documentId: string | null): PdfAnnotationObject[] {
  const registry = useHost((s) => s.registry);
  // Tagged with its document, so a switch of tabs never shows the previous one's.
  const [state, setState] = useState<{ doc: string | null; objs: PdfAnnotationObject[] }>({
    doc: null,
    objs: [],
  });
  useEffect(() => {
    if (!registry || !documentId) return;
    const scope = annotationCapability()?.forDocument(documentId);
    if (!scope) return;
    const update = (state: AnnotationDocumentState): void => {
      const next = state.selectedUids
        .map((uid) => state.byUid[uid]?.object)
        .filter((o): o is PdfAnnotationObject => o !== undefined);
      setState((prev) =>
        prev.doc === documentId &&
        prev.objs.length === next.length &&
        prev.objs.every((o, i) => o === next[i])
          ? prev
          : { doc: documentId, objs: next },
      );
    };
    try {
      update(scope.getState());
    } catch {
      // The document's state appears with its first change.
    }
    return scope.onStateChange(update);
  }, [registry, documentId]);
  return state.doc === documentId ? state.objs : [];
}

/** A document's whole annotation state, live (Field Properties' tab order panel, M6-14). */
export function useAnnotationState(documentId: string): AnnotationDocumentState | null {
  const registry = useHost((s) => s.registry);
  const [state, setState] = useState<{ doc: string; st: AnnotationDocumentState } | null>(null);
  useEffect(() => {
    if (!registry) return;
    const scope = annotationCapability()?.forDocument(documentId);
    if (!scope) return;
    const update = (st: AnnotationDocumentState): void => {
      setState({ doc: documentId, st });
    };
    try {
      update(scope.getState());
    } catch {
      // The document's state appears with its first change.
    }
    return scope.onStateChange(update);
  }, [registry, documentId]);
  return state?.doc === documentId ? state.st : null;
}

/**
 * Resolves once a document's annotation edits have reached the Render worker
 * (M7-02: Ctrl+S right after a text edit). The plugin commits on its own, but
 * a change made while an earlier commit is still running waits for it, and a
 * save sent meanwhile would go out without it. Gives up on a failed commit or
 * after `timeoutMs`.
 */
export async function annotationsSettled(documentId: string, timeoutMs = 3000): Promise<void> {
  const scope = annotationCapability()?.forDocument(documentId);
  if (!scope) return;
  const until = performance.now() + timeoutMs;
  while (performance.now() < until) {
    try {
      if (!scope.getState().hasPendingChanges) return;
      // Resolves at once while another commit runs; the loop then waits for it.
      await scope.commit().toPromise();
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}
