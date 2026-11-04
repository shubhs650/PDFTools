import { documentStore, selectActive } from '../../app/store/documentStore';

/**
 * The focus back on a document's view (the active one by default), so Delete,
 * the clipboard keys and the arrows act on its comments (M7-02, M7-03).
 */
export function focusDocumentView(docId?: string): void {
  const id = docId ?? selectActive(documentStore.getState())?.meta.id;
  if (!id) return;
  document
    .querySelector<HTMLElement>(`[data-testid="document-view"][data-doc-id="${CSS.escape(id)}"]`)
    ?.focus({ preventScroll: true });
}
