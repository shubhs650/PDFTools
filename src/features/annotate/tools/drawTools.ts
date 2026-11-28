// EmbedPDF's drawing tools, as the Comment tab uses them (M3-09): our
// defaults (per-tool styles, M6-03 D-37: toolDefaults.ts), a Typewriter tool
// (a text box with /IT /FreeTextTypeWriter), Shift-constrained drawing, Enter/Esc for click-by-click shapes, a
// Cloud tool (a polygon with a cloudy border, /BE), the note text asked right
// after a note is placed, and the Link dialog after a link is drawn. The plugin
// still draws, previews and commits; appearances are PDFium's (B7).
import type { PluginRegistry } from '@embedpdf/core';
import {
  PdfAnnotationSubtype,
  PdfBlendMode,
  uuidV4,
  type PdfAnnotationObject,
} from '@embedpdf/models';
import type {
  AnnotationCapability,
  AnnotationTool,
  HandlerFactory,
} from '@embedpdf/plugin-annotation';
import { appStore } from '../../../app/store/appStore';
import { documentStore } from '../../../app/store/documentStore';
import { t } from '../../../i18n';
import { capability } from '../../view/host';
import { dropPopups, openNotePopup, saveOpenPopup } from '../notes/notePopupStore';
import {
  calloutBounds,
  calloutFromDrag,
  calloutJoin,
  centred,
  constrain,
  isAngled,
  TEXT_COMMENT_CATEGORY,
  VERTEX_TOOLS,
  type DrawTool,
  type Pt,
} from './drawModel';
import { openLinkEdit } from './linkEdit';
import {
  defaultsPatch,
  HIGHLIGHT_OPACITY,
  HIGHLIGHT_YELLOW,
  isStyleTool,
  type StyleTool,
} from './toolDefaults';
import { defaultsFor, loadToolDefaults, toolDefaultsStore } from './toolDefaultsStore';

type Handlers = ReturnType<HandlerFactory<PdfAnnotationObject>['create']>;
export type HandlerContext = Parameters<HandlerFactory<PdfAnnotationObject>['create']>[0];
type Evt = Parameters<NonNullable<Handlers['onClick']>>[1];

/** Handlers with a click-by-click shape in progress (polyline, polygon, cloud). */
const inProgress = new Set<{ finish: () => void; cancel: () => void }>();

const shift = (evt: unknown): boolean => (evt as { shiftKey?: boolean } | null)?.shiftKey === true;

/** Tools whose points snap to the page's geometry (M3-18): shapes and measurements. */
const SNAPS: ReadonlySet<DrawTool> = new Set([
  'line',
  'lineArrow',
  'polyline',
  'polygon',
  'cloud',
  'square',
  'highlightArea',
  'circle',
  'measureLength',
  'measurePolylength',
  'measurePerimeter',
  'measureArea',
  'measureVolume',
  'measureCutout',
  'measureAngle',
  'measureRadius',
  'measureDiameter',
]);

type Snapper = (page: number, pos: Pt, evt: unknown) => Pt;
let snapper: Snapper | null = null;

/**
 * Shift with snapping on (M14-02, D-78): `pos` is already locked to 0°, 45°
 * or 90° from `anchor`; the answer is where that direction meets a drawn line
 * near it, else `pos`.
 */
type LockedSnapper = (page: number, anchor: Pt, pos: Pt, evt: unknown) => Pt;
let lockedSnapper: LockedSnapper | null = null;

/** Snapping (measure/snapping.ts) hooks in here; null turns it off. */
export function setSnapper(fn: Snapper | null, locked: LockedSnapper | null = null): void {
  snapper = fn;
  lockedSnapper = fn ? locked : null;
}

/** Drawings kept outside the handlers (a measurement in progress, M14-02): Enter and Esc reach them. */
interface DrawingProvider {
  finish: () => boolean;
  cancel: () => boolean;
}
const providers = new Set<DrawingProvider>();

export function addDrawingProvider(p: DrawingProvider): () => void {
  providers.add(p);
  return () => {
    providers.delete(p);
  };
}

/** How a tool's handler is wrapped (M14-02). */
export interface WrapOptions {
  /**
   * The tool keeps its points outside the handler (measure/gesture.ts): the
   * anchor for Shift comes from there, and Enter and Esc reach it as a provider.
   */
  anchor?: (pageIndex: number) => () => Pt | null;
}

type PointerTap = (tool: DrawTool, page: number, pos: Pt, evt: unknown) => void;
let tap: PointerTap | null = null;

/** The Measure loupe (M13-02, D-68) follows the pointer of the tools it serves from here. */
export function setPointerTap(fn: PointerTap | null): void {
  tap = fn;
}

/**
 * Wraps a tool's pointer handler factory: Shift constrains from the anchor
 * point; otherwise points snap to the page's geometry when snapping is on
 * (M3-18). `adapt` may wrap the plugin's handler context (the measurement
 * tools watch its previews, M3-16).
 */
export function wrapFactory(
  tool: DrawTool,
  factory: HandlerFactory<PdfAnnotationObject>,
  adapt?: (context: HandlerContext) => HandlerContext,
  opts: WrapOptions = {},
): HandlerFactory<PdfAnnotationObject> {
  const vertices = VERTEX_TOOLS.has(tool);
  return {
    annotationType: factory.annotationType,
    create(context) {
      const h = factory.create(adapt ? adapt(context) : context);
      if (tool === 'freeTextCallout') return calloutHandlers(h, context);
      // Drag tools: where the drag started. Vertex tools: the last vertex placed.
      let anchor: Pt | null = null;
      // Asked once per handler, while the plugin makes it (it knows the document then).
      const kept = opts.anchor?.(context.pageIndex);
      const anchorNow = (): Pt | null => (kept ? kept() : anchor);
      const snaps = SNAPS.has(tool);
      const fix = (pos: Pt, evt: Evt): Pt => {
        tap?.(tool, context.pageIndex, pos, evt);
        if (shift(evt)) {
          const from = anchorNow();
          const locked = constrain(tool, from, pos);
          // Shift locks the angle and still snaps (M14-02, D-78, Q25): where the
          // locked direction meets a drawn line. Alt: no snap for that click.
          return from && snaps && lockedSnapper && isAngled(tool)
            ? lockedSnapper(context.pageIndex, from, locked, evt)
            : locked;
        }
        return snaps && snapper ? snapper(context.pageIndex, pos, evt) : pos;
      };
      if (kept) {
        // A measurement kept outside the handler (M14-02): nothing to track here.
        return {
          ...h,
          onClick: (pos, evt, mode) => {
            h.onClick?.(fix(pos, evt), evt, mode);
          },
          onPointerDown: (pos, evt, mode) => {
            h.onPointerDown?.(fix(pos, evt), evt, mode);
          },
          onPointerUp: (pos, evt, mode) => {
            h.onPointerUp?.(fix(pos, evt), evt, mode);
          },
          onPointerMove: (pos, evt, mode) => {
            h.onPointerMove?.(fix(pos, evt), evt, mode);
          },
        };
      }
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
        // Distance by clicks (M13-10) says when nothing is half placed any more.
        const drawing = (h as { drawing?: () => boolean }).drawing;
        out.onClick = (pos, evt, mode) => {
          const p = fix(pos, evt);
          h.onClick?.(p, evt, mode);
          anchor = p;
          if (drawing && !drawing()) {
            anchor = null;
            inProgress.delete(entry);
          } else inProgress.add(entry);
        };
        if (drawing) {
          // Its press-and-drag (the second point on release) snaps too.
          out.onPointerDown = (pos, evt, mode) => {
            h.onPointerDown?.(fix(pos, evt), evt, mode);
          };
          out.onPointerUp = (pos, evt, mode) => {
            h.onPointerUp?.(fix(pos, evt), evt, mode);
            if (drawing()) inProgress.add(entry);
          };
        }
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
          const p = shift(evt) ? pos : fix(pos, evt);
          anchor = p;
          h.onPointerDown?.(p, evt, mode);
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

/** The plugin's callout tool counts a press and release this close (page points) as a click. */
const CALLOUT_CLICK = 5;

/**
 * The Callout tool (M7-03, ADR-023 D-43 f; B11). The plugin's callout takes
 * three clicks (arrow tip, knee, then the box). A drag from the arrow tip to
 * where the box goes makes one too (the desktop-editor gesture): the knee is
 * placed automatically (`calloutFromDrag`), and the plugin is handed the three
 * clicks, so its own commit makes the callout (and opens its editor). The
 * three-click route is unchanged. `phase` follows the plugin's own steps.
 */
function calloutHandlers(h: Handlers, context: HandlerContext): Handlers {
  let phase: 'arrow' | 'knee' | 'textbox' = 'arrow';
  let down: Pt | null = null;
  // Where the press was before snapping (a click is told from a drag by it).
  let downRaw: Pt | null = null;
  let dragging = false;
  const onPage = (p: Pt): Pt => ({
    x: Math.min(Math.max(p.x, 0), context.pageSize.width),
    y: Math.min(Math.max(p.y, 0), context.pageSize.height),
  });
  // The loupe follows the pointer (M13-02·O2); the arrow tip and the knee snap
  // to the page's geometry when snapping is on, as Line and Arrow do. The box
  // does not.
  const placing = (): boolean => phase === 'knee' || (phase === 'arrow' && !dragging);
  const at = (pos: Pt, evt: Evt): Pt => {
    tap?.('freeTextCallout', context.pageIndex, pos, evt);
    const p = onPage(pos);
    return placing() && snapper ? onPage(snapper(context.pageIndex, p, evt)) : p;
  };
  const isClick = (a: Pt, b: Pt): boolean =>
    Math.abs(a.x - b.x) < CALLOUT_CLICK && Math.abs(a.y - b.y) < CALLOUT_CLICK;
  const preview = (tip: Pt, end: Pt) => {
    const defaults = context.getTool()?.defaults as Record<string, unknown> | undefined;
    const placed = calloutFromDrag(tip, end, context.pageSize);
    const strokeWidth = typeof defaults?.['strokeWidth'] === 'number' ? defaults['strokeWidth'] : 1;
    const bounds = calloutBounds(tip, placed, strokeWidth);
    context.onPreview({
      type: PdfAnnotationSubtype.FREETEXT,
      bounds,
      data: {
        ...defaults,
        rect: bounds,
        // Where the line meets the box: the plugin's own rule picks the same side.
        calloutLine: [tip, placed.knee, calloutJoin(placed)],
        textBox: placed.box,
      },
    });
  };
  return {
    ...h,
    onPointerDown: (pos, evt, mode) => {
      dragging = false;
      downRaw = onPage(pos);
      const p = at(pos, evt);
      down = p;
      h.onPointerDown?.(p, evt, mode);
    },
    onPointerMove: (pos, evt, mode) => {
      if (phase === 'arrow' && down) {
        const raw = onPage(pos);
        tap?.('freeTextCallout', context.pageIndex, pos, evt);
        if (!dragging && downRaw && !isClick(downRaw, raw)) dragging = true;
        if (dragging) preview(down, raw);
        return;
      }
      h.onPointerMove?.(at(pos, evt), evt, mode);
    },
    onPointerUp: (pos, evt, mode) => {
      const raw = onPage(pos);
      const from = down;
      // A click places the (snapped) point it pressed: the plugin takes the release.
      const p = placing() && from && downRaw && isClick(downRaw, raw) ? from : at(pos, evt);
      down = null;
      downRaw = null;
      if (phase === 'arrow' && from && dragging) {
        dragging = false;
        // The plugin's three clicks: the tip (already pressed), the knee, the box.
        const { knee, box } = calloutFromDrag(from, p, context.pageSize);
        const far = { x: box.origin.x + box.size.width, y: box.origin.y + box.size.height };
        h.onPointerUp?.(from, evt, mode);
        h.onPointerDown?.(knee, evt, mode);
        h.onPointerUp?.(knee, evt, mode);
        h.onPointerDown?.(box.origin, evt, mode);
        h.onPointerUp?.(far, evt, mode);
        return;
      }
      h.onPointerUp?.(p, evt, mode);
      if (phase === 'arrow') {
        if (from && isClick(from, p)) phase = 'knee';
      } else if (phase === 'knee') {
        if (from && isClick(from, p)) phase = 'textbox';
      } else phase = 'arrow';
    },
    onPointerCancel: (pos, evt, mode) => {
      phase = 'arrow';
      down = null;
      downRaw = null;
      dragging = false;
      h.onPointerCancel?.(pos, evt, mode);
    },
  };
}

/** Enter: finish the polyline/polygon being drawn. False when none is. */
export function finishDrawing(): boolean {
  const all = [...inProgress];
  for (const e of all) e.finish();
  let any = all.length > 0;
  for (const p of providers) if (p.finish()) any = true;
  return any;
}

/** Esc: drop the polyline/polygon being drawn (the tool stays on). False when none is. */
export function cancelDrawing(): boolean {
  const all = [...inProgress];
  for (const e of all) e.cancel();
  let any = all.length > 0;
  for (const p of providers) if (p.cancel()) any = true;
  return any;
}

/** Tools whose placeholder text goes into the PDF: localized (rule 11). */
function textDefaults(): Record<string, unknown> {
  return { contents: t('annotate.freeText.placeholder') };
}

/** Tools of measureTools.ts with a style of their own (M14-03, Q31). */
const MEASURE_STYLE_TOOLS = [
  'measureLength',
  'measurePolylength',
  'measurePerimeter',
  'measureArea',
  'measureVolume',
  'measureAngle',
  'measureRadius',
  'measureDiameter',
  'measureCount',
] as const satisfies readonly StyleTool[];

/** The plugin's own tools we rewrap under the same id. */
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

/**
 * Highlight Area (M6-08): a Square annotation filled yellow, no border, whose
 * appearance PDFium draws with /BM /Multiply (so the text shows through).
 */
export const HIGHLIGHT_AREA_DEFAULTS = {
  color: HIGHLIGHT_YELLOW,
  strokeColor: HIGHLIGHT_YELLOW,
  strokeWidth: 0,
  opacity: HIGHLIGHT_OPACITY,
  blendMode: PdfBlendMode.Multiply,
} as const;

/** The intent that makes a free text annotation a typewriter (PDF 32000-1 §12.5.6.6). */
export const TYPEWRITER_INTENT = 'FreeTextTypeWriter';

/** Called once the plugin registry is up (DocumentHost). */
export function installDrawTools(registry: PluginRegistry): () => void {
  let cap: AnnotationCapability;
  try {
    cap = capability<AnnotationCapability>(registry, 'annotation');
  } catch {
    return () => undefined;
  }
  // Each styled tool's defaults without our style, and what was last applied.
  const bases = new Map<StyleTool, Record<string, unknown>>();
  const applied = new Map<StyleTool, Record<string, unknown>>();
  const styled = (id: DrawTool, defaults: Record<string, unknown>): Record<string, unknown> => {
    if (!isStyleTool(id)) return defaults;
    bases.set(id, defaults);
    const full = { ...defaults, ...defaultsFor(id) };
    applied.set(id, full);
    return full;
  };
  const rewrap = (id: DrawTool, base: AnnotationTool, extra: Partial<AnnotationTool> = {}) => {
    const handler = base.pointerHandler;
    if (!handler) return;
    const defaults = styled(id, { ...base.defaults, ...extra.defaults });
    cap.addTool({
      ...base,
      ...extra,
      id,
      defaults,
      pointerHandler: wrapFactory(id, handler),
    });
  };
  // The plugin's own text box and rectangle, before they are rewrapped, for the
  // typewriter and the highlight area.
  const freeTextBase = cap.getTool('freeText');
  const squareBase = cap.getTool('square');
  // Text comments: "Type here" is the tool's default contents, so the plugin's
  // editor selects it when it opens on a new one (typing replaces it, M7-02);
  // the category keeps them selectable while a text tool is on (DocumentView).
  const textExtra = (base: AnnotationTool): Partial<AnnotationTool> => ({
    defaults: { ...base.defaults, ...textDefaults() },
    categories: [...(base.categories ?? []), TEXT_COMMENT_CATEGORY],
    behavior: { ...base.behavior, editAfterCreate: true, selectAfterCreate: true },
    ...(base.clickBehavior
      ? {
          clickBehavior: {
            ...base.clickBehavior,
            defaultContent: t('annotate.freeText.placeholder'),
          },
        }
      : {}),
  });
  for (const id of REWRAPPED) {
    const base = cap.getTool(id);
    if (!base) continue;
    if (id === 'freeText' || id === 'freeTextCallout') rewrap(id, base, textExtra(base));
    else rewrap(id, base);
  }
  if (freeTextBase) {
    const extra = textExtra(freeTextBase);
    rewrap('typewriter', freeTextBase, {
      ...extra,
      name: 'Typewriter',
      labelKey: 'annotation.typewriter',
      defaults: { ...extra.defaults, intent: TYPEWRITER_INTENT },
      matchScore: (a: PdfAnnotationObject) =>
        a.type === PdfAnnotationSubtype.FREETEXT && a.intent === TYPEWRITER_INTENT ? 10 : 0,
    });
  }
  if (squareBase)
    rewrap('highlightArea', squareBase, {
      name: 'Highlight Area',
      labelKey: 'annotation.highlightArea',
      defaults: { ...squareBase.defaults, ...HIGHLIGHT_AREA_DEFAULTS },
      matchScore: (a: PdfAnnotationObject) =>
        a.type === PdfAnnotationSubtype.SQUARE && a.blendMode === PdfBlendMode.Multiply ? 10 : 0,
    });
  const polygon = cap.getTool('polygon');
  if (polygon)
    rewrap('cloud', polygon, {
      name: 'Cloud',
      labelKey: 'annotation.cloud',
      defaults: { ...polygon.defaults, cloudyBorderIntensity: 2 },
      matchScore: (a: PdfAnnotationObject) =>
        a.type === PdfAnnotationSubtype.POLYGON && (a.cloudyBorderIntensity ?? 0) > 0 ? 20 : 0,
    });

  // The measuring tools (installMeasureTools) remember their own style too (M14-03, Q31).
  for (const id of MEASURE_STYLE_TOOLS) {
    const tool = cap.getTool(id);
    if (tool) cap.setToolDefaults(id, styled(id, { ...tool.defaults }));
  }

  // The user's own defaults: once loaded, and whenever they change (M6-06/07).
  const reapply = () => {
    for (const [id, base] of bases) {
      const full = { ...base, ...defaultsFor(id) };
      cap.setToolDefaults(id, defaultsPatch(applied.get(id) ?? {}, full));
      applied.set(id, full);
    }
  };
  const stopDefaults = toolDefaultsStore.subscribe(reapply);
  void loadToolDefaults();

  // What comes right after a tool made its annotation.
  const stopEvents = cap.onAnnotationEvent((e) => {
    if (e.type === 'delete') {
      // A deleted (or undone) note's window closes (M7-06).
      if (e.annotation.type === PdfAnnotationSubtype.TEXT)
        dropPopups(e.documentId, [e.annotation.id]);
      return;
    }
    if (e.type !== 'create') return;
    const a = e.annotation;
    if (a.type === PdfAnnotationSubtype.TEXT && !a.inReplyToId) {
      // A new sticky note opens its window, the caret in it (M7-06, D-44); the
      // window goes into the file once the note itself is there.
      if (!e.committed && !a.contents) openNotePopup(e.documentId, a, { focus: true, save: false });
      else if (e.committed) saveOpenPopup(e.documentId, a);
    } else if (a.type === PdfAnnotationSubtype.LINK && !a.target)
      openLinkEdit(e.documentId, a.pageIndex, a.id);
  });
  // Another tool or another tab while a polyline, polygon, cloud, perimeter or area is
  // half drawn: it is dropped as Esc drops it, so no preview is left on the page that
  // looks like a comment but is never saved (pre-release audit bugs 3 and 8).
  const stopTool = appStore.subscribe((s, prev) => {
    if (s.tool !== prev.tool) cancelDrawing();
  });
  const stopTab = documentStore.subscribe((s, prev) => {
    if (s.activeId !== prev.activeId) cancelDrawing();
  });
  return () => {
    stopDefaults();
    stopEvents();
    stopTool();
    stopTab();
  };
}

/**
 * Resolves once a page's annotation layer is in the document (or after
 * `timeoutMs`): it is what starts editing a new text comment, and it mounts a
 * moment after the page itself.
 */
export function annotationLayerReady(
  docId: string,
  pageIndex: number,
  timeoutMs = 3000,
): Promise<void> {
  const selector = `[data-doc-id="${CSS.escape(docId)}"] [data-page="${String(pageIndex)}"] .annotation-layer`;
  const until = performance.now() + timeoutMs;
  return new Promise((resolve) => {
    const check = (): void => {
      if (document.querySelector(selector) || performance.now() > until) resolve();
      else requestAnimationFrame(check);
    };
    check();
  });
}

interface CreateInternals {
  createAnnotation(
    pageIndex: number,
    annotation: PdfAnnotationObject,
    ctx: undefined,
    documentId: string,
    options: { editAfterCreate: boolean },
  ): void;
}

/**
 * Keyboard creation (M3-Q6): a sticky note, text box or typewriter at the
 * centre of the current page. The note's window opens next (the create event
 * above); a text box or typewriter opens its editor with "Type here" selected,
 * as after a click (M7-02).
 */
export function placeAtCentre(
  registry: PluginRegistry,
  docId: string,
  pageIndex: number,
  tool: 'textComment' | 'freeText' | 'typewriter',
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
  } as PdfAnnotationObject;
  const plugin = registry.getPlugin('annotation') as unknown as CreateInternals | null;
  if (tool !== 'textComment' && plugin && typeof plugin.createAnnotation === 'function')
    plugin.createAnnotation(pageIndex, annot, undefined, docId, { editAfterCreate: true });
  else cap.forDocument(docId).createAnnotation(pageIndex, annot);
  cap.forDocument(docId).selectAnnotation(pageIndex, id);
  return id;
}
