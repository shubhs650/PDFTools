// E2E-only probe for the annotation layer (M3-05). Never part of a production
// build. Reads the annotation plugin's store and history, and the render stats
// of annotation tiles, without depending on DOM details.
import {
  PdfAnnotationBorderStyle,
  PdfAnnotationSubtype,
  uuidV4,
  type PdfSquareAnnoObject,
} from '@embedpdf/models';
import type { HistoryCapability } from '@embedpdf/plugin-history';
import {
  profileStore,
  requestProfile,
  saveProfile,
} from '../features/settings/profile/profileStore';
import { annotationCapability, annotationState } from '../features/annotate/selection';
import { capability, hostStore } from '../features/view/host';
import { diagnostics } from '../app/diagnostics';
import { ensurePage, rtts, snapStore } from '../features/measure/snapping';
import type { TestHook } from './hook';

function history(): HistoryCapability | null {
  const registry = hostStore.getState().registry;
  return registry ? capability<HistoryCapability>(registry, 'history') : null;
}

export function registerAnnotateProbe(hook: TestHook): void {
  hook.capabilities['annotate'] = {
    /** Annotations in the plugin's store: id, page, subtype, rect, author. */
    list: (docId: string) => {
      const st = annotationState(docId);
      if (!st) return null;
      return Object.values(st.byUid).map((t) => ({
        id: t.object.id,
        page: t.object.pageIndex,
        type: t.object.type,
        rect: t.object.rect,
        author: t.object.author ?? null,
        contents: t.object.contents ?? null,
        commit: t.commitState,
      }));
    },
    selected: (docId: string) =>
      annotationCapability()?.forDocument(docId).getSelectedAnnotationIds() ?? [],
    select: (docId: string, page: number, id: string) => {
      annotationCapability()?.forDocument(docId).selectAnnotation(page, id);
    },
    selectMany: (docId: string, ids: string[]) => {
      annotationCapability()?.forDocument(docId).setSelection(ids);
    },
    /** The full plugin objects (all fields), for property checks. */
    objects: (docId: string) => {
      const st = annotationState(docId);
      return st ? Object.values(st.byUid).map((t) => t.object) : null;
    },
    canUndo: (docId: string) => history()?.forDocument(docId).canUndo() ?? false,
    undo: (docId: string) => {
      history()?.forDocument(docId).undo();
    },
    redo: (docId: string) => {
      history()?.forDocument(docId).redo();
    },
    /** A plugin update, as a vertex drag or the Properties pane makes one (M3-16). */
    update: (docId: string, page: number, id: string, patch: Record<string, unknown>) => {
      annotationCapability()?.forDocument(docId).updateAnnotation(page, id, patch);
    },
    /**
     * Makes a square markup the way the M3-08+ tools do: the reviewer profile
     * first (M3-07), then the plugin's create. Resolves with its id.
     */
    createSquare: async (docId: string, page: number, x: number, y: number) => {
      await requestProfile();
      const annot: PdfSquareAnnoObject = {
        type: PdfAnnotationSubtype.SQUARE,
        id: uuidV4(),
        pageIndex: page,
        rect: { origin: { x, y }, size: { width: 120, height: 60 } },
        flags: ['print'],
        color: 'transparent',
        opacity: 1,
        strokeWidth: 2,
        strokeColor: '#0000ff',
        strokeStyle: PdfAnnotationBorderStyle.SOLID,
      };
      annotationCapability()?.forDocument(docId).createAnnotation(page, annot);
      return annot.id;
    },
    /** Snap round trips (ms) so far and the page index states (M3-18). */
    snap: () => ({
      rtts: [...rtts],
      pages: snapStore.getState().pages,
      errors: diagnostics().filter((d) => d.where.startsWith('snap.')),
    }),
    /** Starts a page's geometry extraction (the Work worker gets busy with it). */
    snapPrepare: (docId: string, page: number) => {
      void ensurePage(docId, page);
    },
    setProfile: (name: string) => saveProfile({ name, initials: '', discipline: '', company: '' }),
    profile: () => {
      const s = profileStore.getState();
      return { profile: s.profile, skipped: s.skipped, dialog: s.dialog };
    },
  };
}
