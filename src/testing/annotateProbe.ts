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
import { lastCrs } from '../features/crs/crsExport';
import { lastAnnotationExport } from '../features/annotate/export/annotationExport';
import { placeDynamicStamp } from '../features/stamps/stampTools';
import { MEASURE_INTENT, type MeasureKind } from '../model/measurement';
import { isStyleTool, type StyleProps } from '../features/annotate/tools/toolDefaults';
import {
  defaultsFor,
  setToolDefaults,
  toolDefaultsStore,
} from '../features/annotate/tools/toolDefaultsStore';
import {
  commentStylesStore,
  loadCommentStyles,
} from '../features/annotate/tools/commentStylesStore';
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
    /** Recorded errors whose place starts with `prefix` (codes and stacks only, rule 10). */
    errors: (prefix: string) => diagnostics().filter((d) => d.where.startsWith(prefix)),
    /** The last CRS file made (M3-19): name and bytes as base64. */
    lastCrs: () => {
      const f = lastCrs;
      if (!f) return null;
      let bin = '';
      for (const b of f.bytes) bin += String.fromCharCode(b);
      return { name: f.name, b64: btoa(bin) };
    },
    /** The last annotation export made (M4-08): name and bytes as base64. */
    lastAnnotationExport: async () => {
      const f = lastAnnotationExport;
      if (!f) return null;
      const bytes = new Uint8Array(await f.blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000)
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { name: f.name, b64: btoa(bin) };
    },
    /**
     * A measurement as the Measure tools make one (M3-16): the plugin's line,
     * polyline or polygon with its dimension intent; value, label and keys follow.
     */
    measure: async (
      docId: string,
      page: number,
      kind: MeasureKind,
      pts: { x: number; y: number }[],
    ) => {
      await requestProfile();
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const rect = {
        origin: { x: Math.min(...xs) - 4, y: Math.min(...ys) - 4 },
        size: {
          width: Math.max(...xs) - Math.min(...xs) + 8,
          height: Math.max(...ys) - Math.min(...ys) + 8,
        },
      };
      const type =
        kind === 'distance'
          ? PdfAnnotationSubtype.LINE
          : kind === 'perimeter'
            ? PdfAnnotationSubtype.POLYLINE
            : PdfAnnotationSubtype.POLYGON;
      const geo =
        kind === 'distance' ? { linePoints: { start: pts[0], end: pts[1] } } : { vertices: pts };
      const annot = {
        type,
        id: uuidV4(),
        pageIndex: page,
        rect,
        flags: ['print'],
        color: 'transparent',
        opacity: 1,
        strokeWidth: 1,
        strokeColor: '#E44234',
        strokeStyle: PdfAnnotationBorderStyle.SOLID,
        intent: MEASURE_INTENT[kind],
        ...geo,
      } as unknown as PdfSquareAnnoObject;
      annotationCapability()?.forDocument(docId).createAnnotation(page, annot);
      return annot.id;
    },
    /**
     * Any plugin annotation from plain data (dates as ISO strings), as the
     * tools create them (interop pack, M3-20). Resolves with its id.
     */
    create: async (docId: string, page: number, obj: Record<string, unknown>) => {
      await requestProfile();
      const annot = {
        flags: ['print'],
        opacity: 1,
        ...obj,
        id: typeof obj['id'] === 'string' ? obj['id'] : uuidV4(),
        pageIndex: page,
        created: new Date(typeof obj['created'] === 'string' ? obj['created'] : Date.now()),
      } as unknown as PdfSquareAnnoObject;
      annotationCapability()?.forDocument(docId).createAnnotation(page, annot);
      return annot.id;
    },
    /** A dynamic stamp (M3-14) with the active scheme's first code, at a point. */
    stamp: (docId: string, page: number, x: number, y: number) =>
      placeDynamicStamp(docId, page, { x, y }),
    /** Turns a plugin tool on (tools without a ribbon button yet, e.g. the typewriter). */
    setTool: (docId: string, toolId: string) => {
      annotationCapability()?.forDocument(docId).setActiveTool(toolId);
    },
    /** A tool's defaults as the plugin will apply them to the next comment. */
    toolDefaults: (toolId: string) => annotationCapability()?.getTool(toolId)?.defaults ?? null,
    /** The user's own default style for a tool (M6-03; the Properties pane sets it in M6-06). */
    setToolDefaults: async (toolId: string, props: StyleProps) => {
      if (isStyleTool(toolId)) await setToolDefaults(toolId, props);
    },
    toolDefaultsLoaded: () => toolDefaultsStore.getState().loaded,
    /** What a new comment of a style tool gets now (shipped + user's defaults, M6-03/07). */
    styleOf: (toolId: string) => (isStyleTool(toolId) ? defaultsFor(toolId) : null),
    /** The user's own palette styles (M6-07), loaded first. */
    commentStyles: async () => {
      await loadCommentStyles();
      return commentStylesStore.getState().styles;
    },
    setProfile: (name: string) => saveProfile({ name, initials: '', discipline: '', company: '' }),
    profile: () => {
      const s = profileStore.getState();
      return { profile: s.profile, skipped: s.skipped, dialog: s.dialog };
    },
  };
}
