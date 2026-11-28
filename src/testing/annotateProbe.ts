import { currentGesture } from '../features/measure/gesture';
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
import { loupeStats } from '../features/view/loupe/loupeModel';
import { loupeStore } from '../features/measure/loupePointer';
import { lastCrs } from '../features/crs/crsExport';
import { lastMeasureExport } from '../features/measure/export/measureExport';
import { lastTemplateCrs } from '../features/crs/templates/templateExportFlow';
import { lastAnnotationExport } from '../features/annotate/export/annotationExport';
import { placeDynamicStamp } from '../features/stamps/stampTools';
import { MEASURE_INTENT, type MeasureKind } from '../model/measurement';
import type { CurveTool } from '../model/measureCurve';
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
import { fromBase64, toBase64 } from '../model/base64';
import { settingsOf, type CrsTemplate } from '../model/crs/template';
import {
  addCrsTemplate,
  appStatusWords,
  crsTemplateStore,
  exportTemplateFile,
  importTemplateFile,
  inspectWorkbook,
  loadCrsTemplates,
} from '../features/crs/templates/crsTemplateStore';
import {
  buildTemplateCrs,
  type DocDetails,
  type TemplateExportOptions,
} from '../features/crs/templates/templateExport';
import type { TestHook } from './hook';

/** A CRS template from base64 and settings, not stored (M13-07 probes). */
function probeTemplate(b64: string, settings: unknown): CrsTemplate {
  const bytes = fromBase64(b64);
  const s = settingsOf(settings, appStatusWords());
  if (!bytes || !s) throw new Error('bad probe template');
  return {
    ...s,
    id: 'probe',
    name: 'Probe',
    fileName: 'probe.xlsx',
    kind: 'xlsx',
    workbook: bytes.slice().buffer,
    created: 0,
    modified: 0,
  };
}

const PROBE_DETAILS = {
  docNumber: 'PA-1200-ME-DWG-0042',
  revision: 'B',
  title: 'Pump skid',
  reviewer: 'Ana de Vries',
  reviewDate: '24/11/2026',
};

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
    /** The measurement in progress (M14-02): its document, tool, page and points. */
    gesture: () => currentGesture(),
    /** The loupe's requests to the Render worker and pictures shown so far (M13-02). */
    loupe: () => ({ ...loupeStats }),
    /** Where the loupe's pointer is: page and page points, unturned (M13-02·O1). */
    loupePointer: () => {
      const p = loupeStore.getState().pointer;
      return p ? { docId: p.docId, page: p.page, x: p.pos.x, y: p.pos.y } : null;
    },
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
    /** The last measurements export made (M14-10): name, whether it was attached, base64. */
    lastMeasureExport: () => {
      const f = lastMeasureExport;
      return f ? { name: f.name, attached: f.attached, b64: toBase64(f.bytes) } : null;
    },
    /** The last CRS file made from a project template by the dialog (M13-08): name, sheets, base64. */
    lastTemplateCrs: () => {
      const f = lastTemplateCrs;
      return f ? { name: f.name, sheets: f.sheets, b64: toBase64(f.bytes) } : null;
    },
    /**
     * M13-07: Export CRS into a project template through the Work worker; the
     * file as base64, the sheet names and how many progress reports came.
     * `cancelAfter` aborts after that many reports (the result is then the error's code).
     */
    crsTemplateExport: async (
      docIds: string[],
      b64: string,
      settings: unknown,
      o: TemplateExportOptions,
      cancelAfter = -1,
      details: Partial<DocDetails>[] = [],
    ) => {
      const ac = new AbortController();
      let reports = 0;
      try {
        const out = await buildTemplateCrs(
          probeTemplate(b64, settings),
          docIds.map((docId, i) => ({ docId, details: { ...PROBE_DETAILS, ...details[i] } })),
          o,
          ac.signal,
          () => {
            reports++;
            if (reports === cancelAfter) ac.abort();
          },
        );
        return { b64: toBase64(out.bytes), names: out.names, reports };
      } catch (err) {
        return {
          error: (err as { code?: string; name?: string }).code ?? (err as Error).name,
          reports,
        };
      }
    },
    /**
     * M13-07: import a workbook (inspected in the Work worker), keep it on the
     * device, export it as a template file and import that again.
     */
    crsTemplateRoundTrip: async (b64: string, settings: unknown) => {
      const tpl = probeTemplate(b64, settings);
      const inspection = await inspectWorkbook(tpl.workbook, {
        sheet: tpl.sheet,
        startRow: tpl.startRow,
        columns: tpl.columns.flatMap((c) => (c.on && c.col !== null ? [c.col] : [])),
        lastPreDrawn: null,
      });
      const saved = await addCrsTemplate({
        name: 'Project CRS',
        fileName: 'project.xlsx',
        kind: 'xlsx',
        workbook: tpl.workbook,
        settings: tpl,
        sheet: tpl.sheet,
        startRow: tpl.startRow,
      });
      crsTemplateStore.setState({ loaded: false, templates: [] });
      await loadCrsTemplates();
      const file = await exportTemplateFile(saved.id);
      if (!file) return null;
      const back = await importTemplateFile(file.bytes);
      const bad = await importTemplateFile(new TextEncoder().encode('{"format":"x"}').buffer);
      return {
        inspection,
        fileName: file.name,
        names: crsTemplateStore.getState().templates.map((x) => x.name),
        same:
          back.ok &&
          back.template.workbook.byteLength === saved.workbook.byteLength &&
          JSON.stringify(back.template.columns) === JSON.stringify(saved.columns),
        bad,
      };
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
      kind: Exclude<MeasureKind, CurveTool>,
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
