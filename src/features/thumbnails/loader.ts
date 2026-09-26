// Thumbnail renders (M2-08, ADR-012 decision 2). Not the stock thumbnail
// plugin, which renders at the tiles' own priority: here one thumbnail is in
// flight at a time, the ones nearest the page in view go first, nothing
// starts while the user scrolls or zooms the document, and a heavy page (M1-17
// cost model) renders on the progressive path, which activity cancels between
// slices. Light pages use the engine's renderThumbnail (MEDIUM, below tiles).
// Results share the byte-bounded image cache with tiles and previews.
import { ignore, PdfErrorCode, type PdfDocumentObject } from '@embedpdf/models';
import { AbortError } from '../../engine/errors';
import { isHeavy } from '../../workers/render/costModel';
import { documentStore } from '../../app/store/documentStore';
import { onActivity, quietFor } from '../view/activity';
import { hasFirstPreview } from '../view/renderStats';
import { hostStore, renderEngine, tileCache } from '../view/host';
import { pageCost, progressivePreview } from '../view/progressivePreview';
import { ThumbnailQueue, type RenderThumb } from './queue';

export type { ThumbRequest } from './queue';

/** Thumbnails wait this long after the last scroll or zoom. */
export const QUIET_MS = 300;

function docOf(docId: string): PdfDocumentObject | null {
  const registry = hostStore.getState().registry;
  return registry?.getStore().getState().core.documents[docId]?.document ?? null;
}

/** The app's rendering step: renderThumbnail for light pages, progressive for heavy ones. */
export const renderThumb: RenderThumb = (r) => {
  const doc = docOf(r.docId);
  const page = doc?.pages[r.pageIndex];
  if (!doc || !page)
    return { promise: Promise.reject(new AbortError()), cancel: () => undefined, heavy: false };
  let cancel: () => void = () => undefined;
  let heavy = false;
  const promise = pageCost(r.docId, r.pageIndex)
    .catch(() => ({ objects: 0, segments: 0 }))
    .then((cost) => {
      const px = {
        width: Math.round(page.size.width * r.scale),
        height: Math.round(page.size.height * r.scale),
      };
      if (isHeavy({ ...cost, ...px })) {
        heavy = true;
        const job = progressivePreview(r.docId, r.pageIndex, r.scale);
        cancel = () => {
          job.cancel();
        };
        return job.promise;
      }
      const task = renderEngine().engine.renderThumbnail(doc, page, {
        scaleFactor: r.scale,
        dpr: 1,
      });
      cancel = () => {
        task.abort({ code: PdfErrorCode.Cancelled, message: 'thumbnail cancelled' });
      };
      return new Promise<Blob>((resolve, reject) => {
        task.wait(resolve, (e) => {
          if (e.type === 'abort') reject(new AbortError());
          else reject(new Error('thumbnail failed'));
        });
      });
    });
  promise.catch(ignore);
  return {
    promise,
    cancel: () => {
      cancel();
    },
    get heavy() {
      return heavy;
    },
  };
};

/**
 * Thumbnails start only once the document shows its first preview (they would
 * otherwise race it on the Render worker at open, §12 "first page < 1.5 s")
 * and after QUIET_MS without scrolling or zooming.
 */
const ready = (): boolean => {
  const docId = documentStore.getState().activeId;
  return quietFor(QUIET_MS) && (docId === null || hasFirstPreview(docId));
};

export const thumbnails = new ThumbnailQueue(renderThumb, ready, tileCache);
onActivity(() => {
  thumbnails.interrupt();
});
