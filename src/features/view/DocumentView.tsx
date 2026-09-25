import type { DocumentManagerCapability } from '@embedpdf/plugin-document-manager';
import { Scroller, type PageLayout } from '@embedpdf/plugin-scroll/react';
import type { ScrollCapability } from '@embedpdf/plugin-scroll';
import { TilingLayer } from '@embedpdf/plugin-tiling/react';
import { Viewport } from '@embedpdf/plugin-viewport/react';
import { useEffect } from 'react';
import { documentStore, useDocuments } from '../../app/store/documentStore';
import { capability, useHost } from './host';
import { PreviewLayer } from './PreviewLayer';
import { setViewFocus } from './tileScheduler';

const VIEW_TEST_ID = 'document-view';
const REGION = 'region';

function Page({ documentId, layout }: { documentId: string; layout: PageLayout }) {
  return (
    <div
      className="page"
      data-page={layout.pageIndex}
      style={{ width: layout.width, height: layout.height }}
    >
      <PreviewLayer documentId={documentId} pageIndex={layout.pageIndex} />
      <TilingLayer documentId={documentId} pageIndex={layout.pageIndex} className="page-tiles" />
    </div>
  );
}

/**
 * The active document (§5, D-09): EmbedPDF's virtual scroller; each page is a
 * bounded preview under 256 px tiles (ADR-011). The scroll container is
 * focusable and named, so the keyboard reaches it (rule 12).
 */
export function DocumentView({ documentId }: { documentId: string }) {
  const name = useDocuments((s) => s.docs[documentId]?.meta.name ?? '');
  const registry = useHost((s) => s.registry);
  const ready = useDocuments((s) => s.docs[documentId] !== undefined);

  useEffect(() => {
    if (!registry) return;
    const dm = capability<DocumentManagerCapability>(registry, 'document-manager');
    if (!dm.isDocumentOpen(documentId)) return;
    const scroll = capability<ScrollCapability>(registry, 'scroll').forDocument(documentId);
    setViewFocus(documentId, documentStore.getState().docs[documentId]?.view.page ?? 0);
    return scroll.onPageChange((e) => {
      const page = e.pageNumber - 1;
      setViewFocus(documentId, page);
      documentStore.getState().setView(documentId, { page });
    });
  }, [registry, documentId]);

  if (!ready) return null;
  return (
    <Viewport
      documentId={documentId}
      className="viewport ui-focusable"
      data-testid={VIEW_TEST_ID}
      data-doc-id={documentId}
      role={REGION}
      aria-label={name}
      tabIndex={0}
    >
      <Scroller
        documentId={documentId}
        renderPage={(layout) => <Page documentId={documentId} layout={layout} />}
      />
    </Viewport>
  );
}
