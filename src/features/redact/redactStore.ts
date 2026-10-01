// Pending redaction marks (M4-16): the /Redact annotations of a document, read
// from the annotation plugin's store (cached per state), and the Pending
// Redactions panel's open state.
import { PdfAnnotationSubtype, type PdfRedactAnnoObject } from '@embedpdf/models';
import type { AnnotationDocumentState } from '@embedpdf/plugin-annotation';
import { useEffect, useState } from 'react';
import { createStore, useStore } from 'zustand';
import { useAnnotationMap, objectsOf } from '../annotate/comments/commentsStore';
import { annotationCapability } from '../annotate/selection';
import { useHost } from '../view/host';

type ByUid = NonNullable<ReturnType<typeof useAnnotationMap>>;

const cache = new WeakMap<ByUid, PdfRedactAnnoObject[]>();

/** The marks in page order, then top to bottom. */
export function marksOf(byUid: ByUid): PdfRedactAnnoObject[] {
  let m = cache.get(byUid);
  if (!m) {
    m = objectsOf(byUid)
      .filter((a): a is PdfRedactAnnoObject => a.type === PdfAnnotationSubtype.REDACT)
      .sort(
        (a, b) =>
          a.pageIndex - b.pageIndex ||
          a.rect.origin.y - b.rect.origin.y ||
          a.rect.origin.x - b.rect.origin.x,
      );
    cache.set(byUid, m);
  }
  return m;
}

const EMPTY: PdfRedactAnnoObject[] = [];

export function useMarks(docId: string | null): PdfRedactAnnoObject[] {
  const byUid = useAnnotationMap(docId);
  return byUid ? marksOf(byUid) : EMPTY;
}

const NONE: readonly string[] = [];

/** The ids of the selected annotations of `docId` (the plugin's selection). */
export function useSelectedIds(docId: string | null): readonly string[] {
  const registry = useHost((st) => st.registry);
  const [ids, setIds] = useState<readonly string[]>(NONE);
  useEffect(() => {
    if (!registry || !docId) return;
    const scope = annotationCapability()?.forDocument(docId);
    if (!scope) return;
    const update = (st: AnnotationDocumentState): void => {
      const uids = st.selectedUids;
      setIds((prev) =>
        prev.length === uids.length && prev.every((x, i) => x === uids[i]) ? prev : uids,
      );
    };
    try {
      update(scope.getState());
    } catch {
      // The document's state appears with its first change.
    }
    return scope.onStateChange(update);
  }, [registry, docId]);
  return ids;
}

interface PanelState {
  /** The Pending Redactions panel is open (for the active document). */
  open: boolean;
  announcement: string | null;
}

export const redactPanelStore = createStore<PanelState>()(() => ({
  open: false,
  announcement: null,
}));

export function useRedactPanel<T>(selector: (s: PanelState) => T): T {
  return useStore(redactPanelStore, selector);
}

export function setRedactPanel(open: boolean): void {
  redactPanelStore.setState({ open });
}
