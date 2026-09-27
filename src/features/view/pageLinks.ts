// Link annotations per page (M2-10, ADR-012 decision 3: one engine call per
// page at MEDIUM priority, below tiles), cached until the document closes.
import {
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
  type PdfLinkAnnoObject,
  type PdfLinkTarget,
} from '@embedpdf/models';
import { documentStore } from '../../app/store/documentStore';
import { hostStore, renderEngine } from './host';

export interface PageLink {
  x: number;
  y: number;
  width: number;
  height: number;
  target: PdfLinkTarget | undefined;
}

const cache = new Map<string, Promise<PageLink[]>>();
/** Links load once a page has stayed mounted this long (a fast scroll asks for none). */
export const SETTLE_MS = 200;

export function linksOf(docId: string, pageIndex: number): Promise<PageLink[]> {
  const key = `${docId}|${String(pageIndex)}`;
  let p = cache.get(key);
  if (!p) {
    const doc = hostStore.getState().registry?.getStore().getState().core.documents[
      docId
    ]?.document;
    const page = doc?.pages[pageIndex];
    if (!doc || !page) return Promise.resolve([]);
    p = new Promise<PageLink[]>((resolve, reject) => {
      renderEngine()
        .engine.getPageAnnotations(doc, page)
        .wait(
          (annots: PdfAnnotationObject[]) => {
            resolve(
              annots
                .filter((a): a is PdfLinkAnnoObject => a.type === PdfAnnotationSubtype.LINK)
                .map((a) => ({
                  x: a.rect.origin.x,
                  y: a.rect.origin.y,
                  width: a.rect.size.width,
                  height: a.rect.size.height,
                  target: a.target,
                })),
            );
          },
          () => {
            reject(new Error('links'));
          },
        );
    });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** Forget a closed document's links. */
export function dropLinks(docId: string): void {
  for (const key of cache.keys()) if (key.startsWith(`${docId}|`)) cache.delete(key);
}

documentStore.subscribe((s, prev) => {
  if (s.docs === prev.docs) return;
  for (const id of Object.keys(prev.docs)) if (!(id in s.docs)) dropLinks(id);
});
