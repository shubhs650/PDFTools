import { useEffect, useState } from 'react';
import { isAbortError } from '../../engine/errors';
import { LoadingPlaceholder } from '../../ui/components';
import { thumbnails } from './loader';
import type { PageInfo } from './pageInfo';

/**
 * One page's thumbnail (M2-08): requested from the thumbnail queue (Render worker,
 * rule 1), a shimmer until it arrives (O5), turned by CSS like the viewer's pages.
 * Used by the Thumbnails pane and the file tab's hover card (M11-03).
 */
export function ThumbImage({
  documentId,
  pageIndex,
  page,
  width,
  priority,
  className = 'thumb-img',
}: {
  documentId: string;
  pageIndex: number;
  page: PageInfo;
  width: number;
  priority: number;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  // A render that failed leaves the plain page, not a shimmer that never ends (O5).
  const [failed, setFailed] = useState(false);
  const turned = page.rotation % 2 === 1;
  // Rendered unrotated (both render paths), turned by CSS like the viewer's pages.
  const renderWidth = turned ? (width * page.width) / page.height : width;
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio;
  const scale = (renderWidth * dpr) / page.width;

  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;
    const job = thumbnails.request({ docId: documentId, pageIndex, scale, priority });
    job.promise.then(
      (blob) => {
        if (!live) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      },
      (err: unknown) => {
        if (live && !isAbortError(err)) setFailed(true);
      },
    );
    return () => {
      live = false;
      job.cancel();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- priority changes go through reprioritize(), not a new request
  }, [documentId, pageIndex, scale]);

  if (!url) return failed ? null : <LoadingPlaceholder />;
  const h = (renderWidth * page.height) / page.width;
  return (
    <img
      className={className}
      src={url}
      alt=""
      draggable={false}
      style={{
        width: renderWidth,
        height: h,
        transform: page.rotation ? `rotate(${String(page.rotation * 90)}deg)` : undefined,
      }}
    />
  );
}
