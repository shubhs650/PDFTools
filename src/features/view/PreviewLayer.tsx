import { useDocumentState } from '@embedpdf/core/react';
import { ignore, PdfErrorCode } from '@embedpdf/models';
import { useRenderCapability } from '@embedpdf/plugin-render/react';
import { useEffect, useRef, useState } from 'react';
import { isAbortError } from '../../engine/errors';
import { isHeavy } from '../../workers/render/costModel';
import { previewScale } from './preview';
import { pageCost, progressivePreview } from './progressivePreview';

/**
 * Bounded base image of one page (ADR-011 decision 3): drawn at once from the
 * cache or a small render, then covered by sharp tiles. The previous image
 * stays until its replacement arrives, so a zoom never shows a blank page.
 * Pages the cost model predicts at > 100 ms go to the Render worker's
 * progressive path (M1-17), which a zoom or scroll cancels between slices.
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
    if (!render || !size || scaleFactor <= 0) return;
    const show = (blob: Blob): void => {
      const next = URL.createObjectURL(blob);
      if (current.current) URL.revokeObjectURL(current.current);
      current.current = next;
      setUrl(next);
    };
    let cancel: () => void = () => undefined;
    let live = true;
    void pageCost(documentId, pageIndex)
      .catch(() => ({ objects: 0, segments: 0 }))
      .then((cost) => {
        if (!live) return;
        const px = {
          width: Math.round(size.width * scaleFactor),
          height: Math.round(size.height * scaleFactor),
        };
        if (isHeavy({ ...cost, ...px })) {
          const job = progressivePreview(documentId, pageIndex, scaleFactor);
          cancel = () => {
            job.cancel();
          };
          job.promise.then(
            (blob) => {
              if (live) show(blob);
            },
            (err: unknown) => {
              if (!isAbortError(err)) throw err;
            },
          );
          return;
        }
        const task = render.forDocument(documentId).renderPage({
          pageIndex,
          options: { scaleFactor, dpr: 1 },
        });
        let settled = false;
        task.wait((blob) => {
          settled = true;
          if (live) show(blob);
        }, ignore);
        cancel = () => {
          if (!settled) task.abort({ code: PdfErrorCode.Cancelled, message: 'preview superseded' });
        };
      });
    return () => {
      live = false;
      cancel();
    };
  }, [render, documentId, pageIndex, scaleFactor, refresh, size]);

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
