// A document's outline (M2-10, ADR-012 decision 3): one engine call
// (500 entries in ~11 ms), cached until the document closes.
import type { PdfBookmarkObject } from '@embedpdf/models';
import { documentStore } from '../../app/store/documentStore';
import { hostStore, renderEngine } from '../view/host';

const cache = new Map<string, Promise<PdfBookmarkObject[]>>();

export function outlineOf(docId: string): Promise<PdfBookmarkObject[]> {
  let p = cache.get(docId);
  if (!p) {
    const doc = hostStore.getState().registry?.getStore().getState().core.documents[
      docId
    ]?.document;
    if (!doc) return Promise.reject(new Error('no document'));
    p = new Promise<PdfBookmarkObject[]>((resolve, reject) => {
      renderEngine()
        .engine.getBookmarks(doc)
        .wait(
          (r: { bookmarks: PdfBookmarkObject[] }) => {
            resolve(r.bookmarks);
          },
          () => {
            reject(new Error('bookmarks'));
          },
        );
    });
    p.catch(() => cache.delete(docId));
    cache.set(docId, p);
  }
  return p;
}

documentStore.subscribe((s, prev) => {
  if (s.docs === prev.docs) return;
  for (const id of Object.keys(prev.docs)) if (!(id in s.docs)) cache.delete(id);
});
