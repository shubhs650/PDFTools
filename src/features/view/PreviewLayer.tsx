import { useDocumentState } from '@embedpdf/core/react';
import { ignore, PdfErrorCode } from '@embedpdf/models';
import { useRenderCapability } from '@embedpdf/plugin-render/react';
import { useEffect, useRef, useState } from 'react';
import { previewScale } from './preview';

/**
 * Bounded base image of one page (ADR-011 decision 3): drawn at once from the
 * cache or a small render, then covered by sharp tiles. The previous image
 * stays until its replacement arrives, so a zoom never shows a blank page.
 * M1-17 routes heavy pages to the progressive path from here.
 */
export function PreviewLayer({ documentId, pageIndex }: { documentId: string; pageIndex: number }) {
  const { provides: render } = useRenderCapability();
  const doc = useDocumentState(documentId);
  const size = doc?.document?.pages[pageIndex]?.size;
  const scaleFactor = size
    ? previewScale(size, doc.scale, typeof window === 'undefined' ? 1 : window.devicePixelRatio)
    : 0;
  const refresh = doc?.pageRefreshVersions[pageIndex] ?? 0;
  const [url, setUrl] = useState<string | null>(null);
  const current = useRef<string | null>(null);

  useEffect(() => {
    if (!render || scaleFactor <= 0) return;
    const task = render.forDocument(documentId).renderPage({
      pageIndex,
      options: { scaleFactor, dpr: 1 },
    });
    let settled = false;
    task.wait((blob) => {
      settled = true;
      const next = URL.createObjectURL(blob);
      if (current.current) URL.revokeObjectURL(current.current);
      current.current = next;
      setUrl(next);
    }, ignore);
    return () => {
      if (!settled) task.abort({ code: PdfErrorCode.Cancelled, message: 'preview superseded' });
    };
  }, [render, documentId, pageIndex, scaleFactor, refresh]);

  useEffect(
    () => () => {
      if (current.current) URL.revokeObjectURL(current.current);
      current.current = null;
    },
    [],
  );

  if (!url) return null;
  return <img className="page-preview" src={url} alt="" draggable={false} />;
}
