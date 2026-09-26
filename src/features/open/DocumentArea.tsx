import { useEffect } from 'react';
import { documentStore, useDocuments } from '../../app/store/documentStore';
import { PermissionBanner } from '../protect/PermissionBanner';
import { XfaBanner } from '../forms/XfaBanner';
import { SignatureBanner } from '../signatures/SignatureBanner';
import { FindBar } from '../search/FindBar';
import { DocumentHost } from '../view/DocumentHost';
import { DocumentView } from '../view/DocumentView';
import { capability, tileCache, useHost } from '../view/host';
import type { DocumentManagerCapability } from '@embedpdf/plugin-document-manager';
import { StartScreen } from './StartScreen';

/**
 * The document panel's content: the active document or the start screen. Keeps EmbedPDF's active document in step with
 * our tab state, which is the source of truth.
 */
export function DocumentArea() {
  const activeId = useDocuments((s) => s.activeId);
  const registry = useHost((s) => s.registry);

  useEffect(() => {
    if (!registry) return;
    const dm = capability<DocumentManagerCapability>(registry, 'document-manager');
    const sync = (id: string | null): void => {
      tileCache.setActive(id);
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
        <div className="document-stack">
          <PermissionBanner documentId={activeId} />
          <SignatureBanner documentId={activeId} />
          <XfaBanner documentId={activeId} />
          <FindBar />
          <div className="document-stack-view">
            <DocumentView key={activeId} documentId={activeId} />
          </div>
        </div>
      ) : (
        <StartScreen />
      )}
    </DocumentHost>
  );
}
