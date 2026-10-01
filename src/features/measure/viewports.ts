// Scale viewports (M3-17, §7.4, ADR-007): "Detail A 1:5" regions of a page
// with their own scale, written as page /VP entries (/BBox, /Name, /Measure)
// in the single Ctrl+S revision. Drawn with a rectangle tool (then the dialog),
// or added, edited and deleted from the Properties pane (keyboard path).
// Every change is one undo step. Boxes are PDF user space.
import type { PluginRegistry } from '@embedpdf/core';
import { PdfAnnotationSubtype, type PdfAnnotationObject } from '@embedpdf/models';
import type {
  AnnotationCapability,
  AnnotationTool,
  HandlerFactory,
} from '@embedpdf/plugin-annotation';
import type { HistoryCapability } from '@embedpdf/plugin-history';
import { createStore, useStore } from 'zustand';
import { appStore } from '../../app/store/appStore';
import { documentStore } from '../../app/store/documentStore';
import { t } from '../../i18n';
import type { PdfJson } from '../../model/pdf/wire';
import { viewportToPdf, type PageViewport, type Pt, type Scale } from '../../model/scale';
import {
  nextViewportName,
  normBox,
  withEntry,
  withoutEntry,
  type Box,
} from '../../model/scaleViewport';
import { capability, hostStore } from '../view/host';
import { entriesOf, loadScales, readEntries, scaleOf, scaleStore, setEntries } from './scaleStore';

/** A viewport being added (index undefined) or edited, for the dialog. */
export interface ViewportEdit {
  docId: string;
  page: number;
  index?: number;
  name: string;
  bbox: Box;
  scale: Scale | null;
}

interface ViewportState {
  editing: ViewportEdit | null;
  /** The rectangle being drawn (page points, top-left origin). */
  draft: { page: number; a: Pt; b: Pt } | null;
}

export const viewportStore = createStore<ViewportState>()(() => ({ editing: null, draft: null }));

export function useViewports<T>(selector: (s: ViewportState) => T): T {
  return useStore(viewportStore, selector);
}

/** A page's frame: its height and crop-box origin (EmbedPDF points ↔ user space). */
export function frameOf(docId: string, page: number) {
  const registry = hostStore.getState().registry;
  const p = registry?.getStore().getState().core.documents[docId]?.document?.pages[page];
  const crop = p?.boxes?.crop;
  return {
    width: p?.size.width ?? 612,
    height: p?.size.height ?? 792,
    originX: crop?.left ?? 0,
    originY: crop?.bottom ?? 0,
  };
}

/** EmbedPDF points (top-left origin) → a user-space box. */
export function boxFromPoints(docId: string, page: number, a: Pt, b: Pt): Box {
  const f = frameOf(docId, page);
  const y = (v: number): number => f.originY + f.height - v;
  return normBox([f.originX + a.x, y(a.y), f.originX + b.x, y(b.y)]);
}

/** A user-space box → EmbedPDF points (left, top, width, height). */
export function rectOfBox(docId: string, page: number, box: Box) {
  const f = frameOf(docId, page);
  const [x1, y1, x2, y2] = normBox(box);
  return {
    left: x1 - f.originX,
    top: f.originY + f.height - y2,
    width: x2 - x1,
    height: y2 - y1,
  };
}

function history(docId: string) {
  const registry = hostStore.getState().registry;
  if (!registry) return null;
  try {
    return capability<HistoryCapability>(registry, 'history').forDocument(docId);
  } catch {
    return null;
  }
}

/** Replaces the page's /VP list as one undo step. */
function change(docId: string, page: number, after: PdfJson[]): void {
  const before = entriesOf(scaleStore.getState(), docId, page);
  const run = (list: PdfJson[]): void => {
    void setEntries(docId, new Map([[page, list]]));
  };
  const h = history(docId);
  if (!h) run(after);
  else
    h.register(
      {
        execute: () => {
          run(after);
        },
        undo: () => {
          run(before);
        },
      },
      'viewports',
    );
}

/** Saves the dialog's viewport (added, or replacing the one at its index). */
export function saveViewport(e: ViewportEdit, scale: Scale): void {
  const list = entriesOf(scaleStore.getState(), e.docId, e.page);
  const entry = viewportToPdf({ name: e.name, bbox: normBox(e.bbox), scale });
  change(e.docId, e.page, withEntry(list, entry, e.index));
}

export function deleteViewport(docId: string, page: number, index: number): void {
  change(docId, page, withoutEntry(entriesOf(scaleStore.getState(), docId, page), index));
}

/** Opens the dialog for a new viewport over `bbox` (the page's scale as a start). */
export async function addViewport(docId: string, page: number, bbox: Box): Promise<void> {
  await loadScales(docId);
  const st = scaleStore.getState();
  const list = readEntries(entriesOf(st, docId, page)).filter((v): v is PageViewport => v !== null);
  viewportStore.setState({
    editing: {
      docId,
      page,
      name: nextViewportName(list, t('viewport.baseName')),
      bbox,
      scale: scaleOf(st, docId, page),
    },
  });
}

export function editViewport(docId: string, page: number, index: number): void {
  const v = readEntries(entriesOf(scaleStore.getState(), docId, page))[index];
  if (!v) return;
  viewportStore.setState({
    editing: { docId, page, index, name: v.name, bbox: normBox(v.bbox), scale: v.scale },
  });
}

export function closeViewportDialog(): void {
  viewportStore.setState({ editing: null });
}

/** The part of the page a new viewport starts with from the keyboard: its middle half. */
export function defaultBox(docId: string, page: number): Box {
  const f = frameOf(docId, page);
  const w = scaleStore.getState().docs[docId];
  const media = w && typeof w !== 'string' ? w.pages[page]?.mediaBox : undefined;
  const [x1, y1, x2, y2] = media ?? [f.originX, f.originY, f.originX + 612, f.originY + f.height];
  const dx = (x2 - x1) / 4;
  const dy = (y2 - y1) / 4;
  return [x1 + dx, y1 + dy, x2 - dx, y2 - dy].map((n) => Math.round(n)) as Box;
}

// ---- the rectangle tool --------------------------------------------------------

/** Smaller than this (points) is a click, not a viewport. */
const MIN_SIZE = 4;

const handler: HandlerFactory<PdfAnnotationObject> = {
  annotationType: PdfAnnotationSubtype.SQUARE,
  create(context) {
    let start: Pt | null = null;
    const page = context.pageIndex;
    return {
      onPointerDown: (pos) => {
        start = { ...pos };
        viewportStore.setState({ draft: { page, a: start, b: start } });
      },
      onPointerMove: (pos) => {
        if (start) viewportStore.setState({ draft: { page, a: start, b: { ...pos } } });
      },
      onPointerUp: (pos) => {
        const a = start;
        start = null;
        viewportStore.setState({ draft: null });
        if (!a || Math.abs(pos.x - a.x) < MIN_SIZE || Math.abs(pos.y - a.y) < MIN_SIZE) return;
        const docId = documentStore.getState().activeId;
        if (!docId) return;
        appStore.getState().setTool('select');
        void addViewport(docId, page, boxFromPoints(docId, page, a, pos));
      },
      onPointerCancel: () => {
        start = null;
        viewportStore.setState({ draft: null });
      },
    };
  },
};

/** Called once the plugin registry is up (DocumentHost). */
export function installViewportTool(registry: PluginRegistry): void {
  try {
    capability<AnnotationCapability>(registry, 'annotation').addTool({
      id: 'scaleViewport',
      name: 'scaleViewport',
      labelKey: 'annotation.scaleViewport',
      categories: ['measure'],
      matchScore: () => 0,
      interaction: {
        exclusive: false,
        cursor: 'crosshair',
        isDraggable: false,
        isResizable: false,
      },
      defaults: { type: PdfAnnotationSubtype.SQUARE },
      pointerHandler: handler,
    } as unknown as AnnotationTool);
  } catch {
    // The annotation plugin is always registered (plugins.ts).
  }
}
