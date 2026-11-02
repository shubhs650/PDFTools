// E2E-only probe for page operations (M4-09). Never part of a production build.
import { runPageOp, pagesBusy, pagesStore } from '../features/pages/pageOps';
import { selectionOf } from '../features/pages/selection';
import { hostStore, renderEngine } from '../features/view/host';
import type { PageOp } from '../engine/renderApi';
import { msg } from '../i18n';
import type { TestHook } from './hook';

export function registerPagesProbe(hook: TestHook): void {
  hook.capabilities['pages'] = {
    /** The viewer's page list: size (rounded), rotation, page object number. */
    info: (docId: string) => {
      const doc = hostStore.getState().registry?.getStore().getState().core.documents[
        docId
      ]?.document;
      return (doc?.pages ?? []).map((p) => ({
        w: Math.round(p.size.width),
        h: Math.round(p.size.height),
        rot: p.rotation,
        obj: p.objectNumber,
      }));
    },
    selection: (docId: string) => selectionOf(docId).selected,
    busy: () => pagesBusy(),
    version: (docId: string) => pagesStore.getState().version[docId] ?? 0,
    error: () => pagesStore.getState().error,
    /**
     * RGB of one page point (points, top-left origin) rendered by the Render
     * worker without annotations: page content only (M6-09 flatten).
     */
    pixel: async (docId: string, pageIndex: number, x: number, y: number) => {
      const doc = hostStore.getState().registry?.getStore().getState().core.documents[
        docId
      ]?.document;
      const page = doc?.pages[pageIndex];
      if (!doc || !page) throw new Error('no page');
      const raw = await renderEngine()
        .engine.renderPageRectRaw(
          doc,
          page,
          { origin: { x, y }, size: { width: 1, height: 1 } },
          { scaleFactor: 1, withAnnotations: false },
        )
        .toPromise();
      return [raw.data[0], raw.data[1], raw.data[2]];
    },
    /** A page operation as the commands run it (perf scenarios). */
    run: (docId: string, op: PageOp) => runPageOp(docId, op, msg('pages.rotating')),
  };
}
