// Length, Polylength, Perimeter and Area (M3-16, §7.4; one markup each since
// M14-03, D-73, D-74): EmbedPDF's line, polyline and polygon tools with a
// dimension intent (/IT) and our `measure` field, so the plugin previews,
// commits and undoes as usual and the Render worker draws the value into the
// markup's own appearance (workers/render/measureAppearance.ts). All four are
// placed by clicks (M13-10): Length with our own handler (two points, then the
// offset of its dimension line, dimensionTool.ts); Polylength, Perimeter and
// Area with our click-by-click polyline and polygon (vertexTool.ts). Their
// points live outside the handlers (gesture.ts, M14-02), so any view change
// keeps a measurement in progress. The live value shows next to the pointer
// (measureStore); the value, caption and keys follow on commit (measurements.ts).
// Each tool remembers its own style (Q31: toolDefaults.ts).
import type { PluginRegistry } from '@embedpdf/core';
import { PdfAnnotationSubtype, type PdfAnnotationObject } from '@embedpdf/models';
import type { AnnotationCapability } from '@embedpdf/plugin-annotation';
import {
  curveKind,
  isCurveKind,
  MEASURE_INTENT,
  measureKind,
  measurePoints,
  type MeasureKind,
} from '../../model/measurement';
import { isCurveTool, type CurveTool } from '../../model/measureCurve';
import {
  metaOf,
  mirror,
  toolFromShape,
  type MeasureMeta,
  type MeasureTool as Tool,
} from '../../model/measureMarkup';
import type { Pt } from '../../model/scale';
import type { DrawTool } from '../annotate/tools/drawModel';
import { wrapFactory } from '../annotate/tools/drawTools';
import { capability } from '../view/host';
import { curveHandlerFactory } from './curveTool';
import { dimensionHandlerFactory, withLeaderRect, type Patch } from './dimensionTool';
import { gestureAnchor, registeringDoc } from './gesture';
import { vertexHandlerFactory } from './vertexTool';

/** Each measuring tool's value kind (model/scale.ts). */
export const MEASURE_TOOLS = {
  measureLength: 'distance',
  measurePolylength: 'perimeter',
  measurePerimeter: 'perimeter',
  measureArea: 'area',
  measureAngle: 'angle',
  measureRadius: 'radius',
  measureDiameter: 'diameter',
} as const satisfies Partial<Record<DrawTool, MeasureKind>>;

export type MeasureTool = keyof typeof MEASURE_TOOLS;

export const isMeasureTool = (t: string): t is MeasureTool => t in MEASURE_TOOLS;

/** The plugin tool → the measuring tool it makes (the `measure` field's `tool`). */
export const TOOL_OF: Record<MeasureTool, Tool> = {
  measureLength: 'length',
  measurePolylength: 'polylength',
  measurePerimeter: 'perimeter',
  measureArea: 'area',
  measureAngle: 'angle',
  measureRadius: 'radius',
  measureDiameter: 'diameter',
};

/** The measuring tool → its plugin tool. */
export const PLUGIN_TOOL: Record<Tool, MeasureTool> = {
  length: 'measureLength',
  polylength: 'measurePolylength',
  perimeter: 'measurePerimeter',
  area: 'measureArea',
  angle: 'measureAngle',
  radius: 'measureRadius',
  diameter: 'measureDiameter',
};

/** Measure tab command → tool. */
export const MEASURE_COMMANDS: Record<string, MeasureTool> = {
  'measure.length': 'measureLength',
  'measure.polylength': 'measurePolylength',
  'measure.perimeter': 'measurePerimeter',
  'measure.area': 'measureArea',
  'measure.angle': 'measureAngle',
  'measure.radius': 'measureRadius',
  'measure.diameter': 'measureDiameter',
};

/** The plugin tool each measuring tool is built on (Angle, Radius, Diameter: a Stamp, M14-05). */
const BASE: Record<MeasureTool, string> = {
  measureLength: 'line',
  measurePolylength: 'polyline',
  measurePerimeter: 'polyline',
  measureArea: 'polygon',
  measureAngle: 'stamp',
  measureRadius: 'stamp',
  measureDiameter: 'stamp',
};

/**
 * A curve's transform (M14-05): a Stamp has no geometry of its own, so a move
 * (a drag, the arrow keys) carries the points in its `measure` field along
 * with its rect.
 */
export const curveTransform: Patch = (orig, ctx) => {
  const changes = ctx.changes as Record<string, unknown>;
  if (ctx.type !== 'move') return ctx.changes;
  const meta = metaOf(orig);
  const rect = changes['rect'] as { origin: Pt } | undefined;
  if (!meta?.pts || !rect) return ctx.changes;
  const dx = rect.origin.x - orig.rect.origin.x;
  const dy = rect.origin.y - orig.rect.origin.y;
  if (dx === 0 && dy === 0) return ctx.changes;
  return {
    ...ctx.changes,
    measure: { ...meta, pts: meta.pts.map((p) => ({ x: p.x + dx, y: p.y + dy })) },
  } as unknown as typeof ctx.changes;
};

interface PreviewData {
  linePoints?: { start: Pt; end: Pt };
  vertices?: Pt[];
  currentVertex?: Pt;
}

/** The plugin's preview → the points measured so far (the pointer last). */
export function previewPoints(data: PreviewData | undefined): Pt[] {
  if (!data) return [];
  if (data.linePoints) return [data.linePoints.start, data.linePoints.end];
  return [...(data.vertices ?? []), ...(data.currentVertex ? [data.currentVertex] : [])];
}

/** The measuring tool an annotation was made with, without a document (the plugin's tool match). */
function toolMatch(a: PdfAnnotationObject): Tool | null {
  const own = metaOf(a);
  if (own) return own.tool;
  const kind = measureKind(a) ?? curveKind(a);
  if (isCurveKind(kind)) return kind;
  return kind ? toolFromShape(kind, measurePoints(a).map(mirror)) : null;
}

const anchorFor = (id: MeasureTool) => (page: number) => {
  const where = { doc: registeringDoc(), tool: id, page };
  return () => gestureAnchor(where);
};

/**
 * Angle, Radius or Diameter (M14-05): a Stamp tool of ours. It moves (its
 * points with it) but never resizes or turns: its appearance is drawn from
 * its points. Placed by clicks, kept outside the handler (curveTool.ts).
 */
function curveTool(
  base: ReturnType<AnnotationCapability['getTool']> & object,
  id: MeasureTool,
  tool: CurveTool,
): Parameters<AnnotationCapability['addTool']>[0] {
  const measure: MeasureMeta = { tool };
  return {
    ...base,
    id,
    name: id,
    labelKey: `annotation.${id}`,
    categories: ['annotation', 'measure'],
    matchScore: (a: PdfAnnotationObject) => (toolMatch(a) === tool ? 30 : 0),
    interaction: {
      exclusive: false,
      cursor: 'crosshair',
      isDraggable: true,
      isResizable: false,
      isRotatable: false,
      lockAspectRatio: true,
    },
    behavior: { ...(base.behavior ?? {}), insertUpright: false },
    // The style (colour, width) comes from the tool's defaults (toolDefaults.ts).
    defaults: {
      type: PdfAnnotationSubtype.STAMP,
      strokeColor: '#E44234',
      strokeWidth: 1,
      opacity: 1,
      measure,
    },
    transform: curveTransform,
    pointerHandler: wrapFactory(id, curveHandlerFactory(tool, id), undefined, {
      anchor: anchorFor(id),
    }),
  };
}

/** Called once the plugin registry is up, before installDrawTools rewraps the base tools. */
export function installMeasureTools(registry: PluginRegistry): void {
  let cap: AnnotationCapability;
  try {
    cap = capability<AnnotationCapability>(registry, 'annotation');
  } catch {
    return;
  }
  for (const [id, kind] of Object.entries(MEASURE_TOOLS) as [MeasureTool, MeasureKind][]) {
    const base = cap.getTool(BASE[id]);
    if (!base) continue;
    const tool = TOOL_OF[id];
    if (isCurveTool(tool) || isCurveKind(kind)) {
      if (isCurveTool(tool)) cap.addTool(curveTool(base, id, tool));
      continue;
    }
    // Placed by clicks with the points kept outside the handler, so a view change
    // between two clicks keeps them (M13-10, M14-02): dimensionTool.ts, vertexTool.ts.
    const handler =
      tool === 'length'
        ? dimensionHandlerFactory
        : vertexHandlerFactory(tool === 'area' ? 'area' : tool, id);
    const measure: MeasureMeta = tool === 'length' ? { tool, cap: 'top' } : { tool };
    cap.addTool({
      ...base,
      id,
      name: id,
      labelKey: `annotation.${id}`,
      categories: ['annotation', 'measure'],
      // Above the base tool's score, so a measurement is edited as one.
      matchScore: (a: PdfAnnotationObject) => (toolMatch(a) === tool ? 30 : 0),
      // The style (colour, width, ends, an area's fill) comes from the tool's
      // defaults (toolDefaults.ts), applied by installDrawTools.
      defaults: { ...base.defaults, intent: MEASURE_INTENT[kind], measure },
      // No click-to-place default length: a measurement is always drawn. Its
      // leader lines stay inside its rect when a point is dragged (M13-10).
      ...(tool === 'length'
        ? {
            clickBehavior: { enabled: false, defaultLength: 0 },
            transform: withLeaderRect(base.transform as Patch | undefined),
          }
        : {}),
      // The live value comes from the gesture (gesture.ts); Shift locks from its last point.
      pointerHandler: wrapFactory(id, handler, undefined, { anchor: anchorFor(id) }),
    });
  }
}
