import { useEffect } from 'react';
import { documentStore, useDocuments } from '../../app/store/documentStore';
import { DocumentHost } from '../view/DocumentHost';
import { capability, useHost } from '../view/host';
import type { DocumentManagerCapability } from '@embedpdf/plugin-document-manager';
import { StartScreen } from './StartScreen';

/**
 * The document panel's content: the active document (the viewer arrives in
 * M1-14) or the start screen. Keeps EmbedPDF's active document in step with
 * our tab state, which is the source of truth.
 */
export function DocumentArea() {
  const activeId = useDocuments((s) => s.activeId);
  const registry = useHost((s) => s.registry);

  useEffect(() => {
    if (!registry) return;
    const dm = capability<DocumentManagerCapability>(registry, 'document-manager');
    const sync = (id: string | null): void => {
      if (id && dm.isDocumentOpen(id) && dm.getActiveDocumentId() !== id) dm.setActiveDocument(id);
    };
    sync(documentStore.getState().activeId);
    return documentStore.subscribe((s, prev) => {
      if (s.activeId !== prev.activeId) sync(s.activeId);
    });
  }, [registry]);

  return (
    <DocumentHost>
      {activeId ? (
        <div className="document-view" data-testid="document-view" data-doc-id={activeId} />
      ) : (
        <StartScreen />
      )}
    </DocumentHost>
  );
}
