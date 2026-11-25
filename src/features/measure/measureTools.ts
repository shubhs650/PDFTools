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
import type { PdfAnnotationObject } from '@embedpdf/models';
import type { AnnotationCapability } from '@embedpdf/plugin-annotation';
import {
  MEASURE_INTENT,
  measureKind,
  measurePoints,
  type MeasureKind,
} from '../../model/measurement';
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
import { dimensionHandlerFactory, withLeaderRect, type Patch } from './dimensionTool';
import { gestureAnchor, registeringDoc } from './gesture';
import { vertexHandlerFactory } from './vertexTool';

/** Each measuring tool's value kind (model/scale.ts). */
export const MEASURE_TOOLS = {
  measureLength: 'distance',
  measurePolylength: 'perimeter',
  measurePerimeter: 'perimeter',
  measureArea: 'area',
} as const satisfies Partial<Record<DrawTool, MeasureKind>>;

export type MeasureTool = keyof typeof MEASURE_TOOLS;

export const isMeasureTool = (t: string): t is MeasureTool => t in MEASURE_TOOLS;

/** The plugin tool → the measuring tool it makes (the `measure` field's `tool`). */
export const TOOL_OF: Record<MeasureTool, Tool> = {
  measureLength: 'length',
  measurePolylength: 'polylength',
  measurePerimeter: 'perimeter',
  measureArea: 'area',
};

/** The measuring tool → its plugin tool. */
export const PLUGIN_TOOL: Record<Tool, MeasureTool> = {
  length: 'measureLength',
  polylength: 'measurePolylength',
  perimeter: 'measurePerimeter',
  area: 'measureArea',
};

/** Measure tab command → tool. */
export const MEASURE_COMMANDS: Record<string, MeasureTool> = {
  'measure.length': 'measureLength',
  'measure.polylength': 'measurePolylength',
  'measure.perimeter': 'measurePerimeter',
  'measure.area': 'measureArea',
};

const BASE: Record<MeasureTool, string> = {
  measureLength: 'line',
  measurePolylength: 'polyline',
  measurePerimeter: 'polyline',
  measureArea: 'polygon',
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
  const kind = measureKind(a);
  return kind ? toolFromShape(kind, measurePoints(a).map(mirror)) : null;
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
      pointerHandler: wrapFactory(id, handler, undefined, {
        anchor: (page) => {
          const where = { doc: registeringDoc(), tool: id, page };
          return () => gestureAnchor(where);
        },
      }),
    });
  }
}
