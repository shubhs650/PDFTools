// EmbedPDF's drawing tools, as the Comment tab uses them (M3-09): our
// defaults, Shift-constrained drawing, Enter/Esc for click-by-click shapes, a
// Cloud tool (a polygon with a cloudy border, /BE), the note text asked right
// after a note is placed, and the Link dialog after a link is drawn. The plugin
// still draws, previews and commits; appearances are PDFium's (B7).
import type { PluginRegistry } from '@embedpdf/core';
import { PdfAnnotationSubtype, uuidV4, type PdfAnnotationObject } from '@embedpdf/models';
import type {
  AnnotationCapability,
  AnnotationTool,
  HandlerFactory,
} from '@embedpdf/plugin-annotation';
import { t } from '../../../i18n';
import { capability } from '../../view/host';
import { openContentsPrompt } from './contentsPrompt';
import { centred, constrain, VERTEX_TOOLS, type DrawTool, type Pt } from './drawModel';
import { openLinkEdit } from './linkEdit';

type Handlers = ReturnType<HandlerFactory<PdfAnnotationObject>['create']>;
type Evt = Parameters<NonNullable<Handlers['onClick']>>[1];

/** Handlers with a click-by-click shape in progress (polyline, polygon, cloud). */
const inProgress = new Set<{ finish: () => void; cancel: () => void }>();

const shift = (evt: unknown): boolean => (evt as { shiftKey?: boolean } | null)?.shiftKey === true;

/** Wraps a tool's pointer handler factory: Shift constrains from the anchor point. */
function wrapFactory(
  tool: DrawTool,
  factory: HandlerFactory<PdfAnnotationObject>,
): HandlerFactory<PdfAnnotationObject> {
  const vertices = VERTEX_TOOLS.has(tool);
  return {
    annotationType: factory.annotationType,
    create(context) {
      const h = factory.create(context);
      // Drag tools: where the drag started. Vertex tools: the last vertex placed.
      let anchor: Pt | null = null;
      const fix = (pos: Pt, evt: Evt): Pt => (shift(evt) ? constrain(tool, anchor, pos) : pos);
      const entry = {
        finish: () => {
          if (anchor) h.onDoubleClick?.(anchor, undefined as unknown as Evt, tool);
          anchor = null;
          inProgress.delete(entry);
        },
        cancel: () => {
          h.onPointerCancel?.(anchor ?? { x: 0, y: 0 }, undefined as unknown as Evt, tool);
          anchor = null;
          inProgress.delete(entry);
        },
      };
      const out: Handlers = { ...h };
      if (vertices) {
        out.onClick = (pos, evt, mode) => {
          const p = fix(pos, evt);
          h.onClick?.(p, evt, mode);
          anchor = p;
          inProgress.add(entry);
        };
        out.onPointerMove = (pos, evt, mode) => {
          h.onPointerMove?.(fix(pos, evt), evt, mode);
        };
        out.onDoubleClick = (pos, evt, mode) => {
          h.onDoubleClick?.(pos, evt, mode);
          anchor = null;
          inProgress.delete(entry);
        };
        out.onPointerCancel = (pos, evt, mode) => {
          h.onPointerCancel?.(pos, evt, mode);
          anchor = null;
          inProgress.delete(entry);
        };
      } else {
        out.onPointerDown = (pos, evt, mode) => {
          anchor = pos;
          h.onPointerDown?.(pos, evt, mode);
        };
        out.onPointerMove = (pos, evt, mode) => {
          h.onPointerMove?.(fix(pos, evt), evt, mode);
        };
        out.onPointerUp = (pos, evt, mode) => {
          h.onPointerUp?.(fix(pos, evt), evt, mode);
          anchor = null;
        };
      }
      return out;
    },
  };
}

/** Enter: finish the polyline/polygon being drawn. False when none is. */
export function finishDrawing(): boolean {
  const all = [...inProgress];
  for (const e of all) e.finish();
  return all.length > 0;
}

/** Esc: drop the polyline/polygon being drawn (the tool stays on). False when none is. */
export function cancelDrawing(): boolean {
  const all = [...inProgress];
  for (const e of all) e.cancel();
  return all.length > 0;
}

/** Tools whose placeholder text goes into the PDF: localized (rule 11). */
function textDefaults(): Record<string, unknown> {
  return { contents: t('annotate.freeText.placeholder') };
}

const REWRAPPED: readonly DrawTool[] = [
  'textComment',
  'freeText',
  'freeTextCallout',
  'line',
  'lineArrow',
  'polyline',
  'polygon',
  'square',
  'circle',
  'ink',
  'inkHighlighter',
  'link',
];

/** Called once the plugin registry is up (DocumentHost). */
export function installDrawTools(registry: PluginRegistry): () => void {
  let cap: AnnotationCapability;
  try {
    cap = capability<AnnotationCapability>(registry, 'annotation');
  } catch {
    return () => undefined;
  }
  const rewrap = (id: DrawTool, base: AnnotationTool, extra: Partial<AnnotationTool> = {}) => {
    const handler = base.pointerHandler;
    if (!handler) return;
    cap.addTool({
      ...base,
      ...extra,
      id,
      pointerHandler: wrapFactory(id, handler),
    });
  };
  for (const id of REWRAPPED) {
    const base = cap.getTool(id);
    if (!base) continue;
    if (id === 'freeText' || id === 'freeTextCallout') {
      rewrap(id, base, {
        defaults: { ...base.defaults, ...textDefaults() },
        ...(base.clickBehavior
          ? {
              clickBehavior: {
                ...base.clickBehavior,
                defaultContent: t('annotate.freeText.placeholder'),
              },
            }
          : {}),
      });
    } else rewrap(id, base);
  }
  const polygon = cap.getTool('polygon');
  if (polygon)
    rewrap('cloud', polygon, {
      name: 'Cloud',
      labelKey: 'annotation.cloud',
      defaults: { ...polygon.defaults, cloudyBorderIntensity: 2 },
      matchScore: (a: PdfAnnotationObject) =>
        a.type === PdfAnnotationSubtype.POLYGON && (a.cloudyBorderIntensity ?? 0) > 0 ? 20 : 0,
    });

  // What comes right after a tool made its annotation.
  return cap.onAnnotationEvent((e) => {
    if (e.type !== 'create') return;
    const a = e.annotation;
    if (a.type === PdfAnnotationSubtype.TEXT && !a.inReplyToId && !a.contents)
      openContentsPrompt('note', e.documentId, a.pageIndex, a.id);
    else if (a.type === PdfAnnotationSubtype.LINK && !a.target)
      openLinkEdit(e.documentId, a.pageIndex, a.id);
  });
}

/**
 * Keyboard creation (M3-Q6): a sticky note or text box at the centre of the
 * current page; its text is asked next (the note's by the create event above).
 */
export function placeAtCentre(
  registry: PluginRegistry,
  docId: string,
  pageIndex: number,
  tool: 'textComment' | 'freeText',
): string | null {
  const cap = capability<AnnotationCapability>(registry, 'annotation');
  const page = registry.getStore().getState().core.documents[docId]?.document?.pages[pageIndex];
  const base = cap.getTool(tool);
  if (!page || !base) return null;
  const size = tool === 'textComment' ? { width: 24, height: 24 } : { width: 200, height: 24 };
  const id = uuidV4();
  const annot = {
    ...base.defaults,
    id,
    pageIndex,
    rect: centred(page.size, size),
    flags: ['print'],
    created: new Date(),
    ...(tool === 'freeText' ? { contents: '' } : {}),
  } as PdfAnnotationObject;
  cap.forDocument(docId).createAnnotation(pageIndex, annot);
  cap.forDocument(docId).selectAnnotation(pageIndex, id);
  if (tool === 'freeText') openContentsPrompt('freeText', docId, pageIndex, id);
  return id;
}
