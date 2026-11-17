// The pages of a document as the thumbnails need them (M2-08): size and the page's own
// rotation, read from the engine's document; a new list after a page operation (M4-09).
// Shared by the Thumbnails pane and the file tab's hover card (M11-03).
import { useMemo } from 'react';
import { usePages as usePageOps } from '../pages/pageOps';
import { useHost } from '../view/host';

export interface PageInfo {
  width: number;
  height: number;
  /** Quarter turns of the page's own /Rotate (EmbedPDF normalizes page space). */
  rotation: number;
}

export function usePages(documentId: string | null): PageInfo[] {
  const registry = useHost((s) => s.registry);
  // Page operations replace the page list (M4-09).
  const version = usePageOps((s) => (documentId ? (s.version[documentId] ?? 0) : 0));
  return useMemo(() => {
    if (!registry || !documentId) return [];
    const doc = registry.getStore().getState().core.documents[documentId]?.document;
    return (doc?.pages ?? []).map((p) => ({
      width: p.size.width,
      height: p.size.height,
      rotation: p.rotation,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version: the page list changed in place
  }, [registry, documentId, version]);
}
