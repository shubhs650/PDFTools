// A link just drawn with the Link tool asks where it goes (M3-09). OK sets
// the target (the engine writes /A); Cancel removes the link again, since a
// link without a target does nothing.
import { createStore, useStore } from 'zustand';
import type { PdfLinkTarget } from '@embedpdf/models';
import { invalidateLinks } from '../../view/pageLinks';
import { annotationCapability } from '../selection';

interface LinkEditState {
  target: { docId: string; pageIndex: number; id: string } | null;
}

export const linkEditStore = createStore<LinkEditState>()(() => ({ target: null }));

export function useLinkEdit<T>(selector: (s: LinkEditState) => T): T {
  return useStore(linkEditStore, selector);
}

export function openLinkEdit(docId: string, pageIndex: number, id: string): void {
  linkEditStore.setState({ target: { docId, pageIndex, id } });
}

export function closeLinkEdit(target: PdfLinkTarget | null): void {
  const t = linkEditStore.getState().target;
  linkEditStore.setState({ target: null });
  if (!t) return;
  const scope = annotationCapability()?.forDocument(t.docId);
  if (target) scope?.updateAnnotation(t.pageIndex, t.id, { target });
  else scope?.deleteAnnotation(t.pageIndex, t.id);
  invalidateLinks(t.docId, t.pageIndex);
}
