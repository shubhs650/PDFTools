import { useEffect } from 'react';
import { documentStore, useDocuments } from '../../app/store/documentStore';
import { PermissionBanner } from '../protect/PermissionBanner';
import { XfaBanner } from '../forms/XfaBanner';
import { SignatureBanner } from '../signatures/SignatureBanner';
import { FindBar } from '../search/FindBar';
import { ScalePrompt } from '../measure/ScalePrompt';
import { DocumentHost } from '../view/DocumentHost';
import { DocumentView } from '../view/DocumentView';
import { capability, tileCache, useHost } from '../view/host';
import type { DocumentManagerCapability } from '@embedpdf/plugin-document-manager';
import { SessionPrompt } from '../session/SessionPrompt';
import { StartScreen } from './StartScreen';
import { CompareTab } from '../compare/CompareTab';

/**
 * The document panel's content: the selected tab (a document, or a comparison, M12-08)
 * or the start screen. Keeps EmbedPDF's active document in step with our tab state,
 * which is the source of truth.
 */
export function DocumentArea() {
  const activeTab = useDocuments((s) => s.activeTab);
  const isDocument = useDocuments((s) => s.activeTab !== null && s.docs[s.activeTab] !== undefined);
  const activeId = isDocument ? activeTab : null;
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

  const comparison = activeTab !== null && !isDocument ? activeTab : null;
  // A comparison's result shows its documents in live windows (M12-12): inside the host.
  const result = useDocuments((s) =>
    comparison !== null ? s.comparisons[comparison]?.stage === 'result' : false,
  );
  return (
    <>
      {/* The input window is outside the engine's host: the host wraps its children once
          the engine starts (on the first open), which would remount the input window and
          drop its focus. */}
      {comparison !== null && !result && (
        <div className="document-stack">
          <SessionPrompt variant="bar" />
          <CompareTab id={comparison} />
        </div>
      )}
      <DocumentHost>
        {comparison !== null ? (
          result ? (
            <div className="document-stack">
              <SessionPrompt variant="bar" />
              <CompareTab id={comparison} />
            </div>
          ) : null
        ) : activeId ? (
          <div className="document-stack">
            <SessionPrompt variant="bar" />
            <PermissionBanner documentId={activeId} />
            <SignatureBanner documentId={activeId} />
            <XfaBanner documentId={activeId} />
            <FindBar />
            <div className="document-stack-view">
              <DocumentView key={activeId} documentId={activeId} />
              {/* The no-scale question floats over the page (M14-02): nothing moves under the pointer. */}
              <ScalePrompt documentId={activeId} />
            </div>
          </div>
        ) : (
          <StartScreen />
        )}
      </DocumentHost>
    </>
  );
}
