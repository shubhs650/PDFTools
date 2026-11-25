// Distance, Perimeter and Area (M3-16, §7.4, ADR-007): EmbedPDF's line,
// polyline and polygon tools with a dimension intent (/IT), so PDFium draws
// the geometry (B7) and the plugin previews, commits and undoes as usual. All
// three are placed by clicks (M13-10): Distance with our own handler (two
// points, then the offset of its dimension line, dimensionTool.ts); Perimeter
// and Area with our click-by-click polyline and polygon (vertexTool.ts). Their
// points live outside the handlers (gesture.ts, M14-02), so any view change
// keeps a measurement in progress. The live value shows next to the pointer
// (measureStore); the value, label and measure keys follow on commit
// (measurements.ts).
import type { PluginRegistry } from '@embedpdf/core';
import { PdfAnnotationLineEnding, type PdfAnnotationObject } from '@embedpdf/models';
import type { AnnotationCapability } from '@embedpdf/plugin-annotation';
import { MEASURE_INTENT, measureKind, type MeasureKind } from '../../model/measurement';
import type { Pt } from '../../model/scale';
import type { DrawTool } from '../annotate/tools/drawModel';
import { wrapFactory } from '../annotate/tools/drawTools';
import { capability } from '../view/host';
import { dimensionHandlerFactory, withLeaderRect, type Patch } from './dimensionTool';
import { gestureAnchor, registeringDoc } from './gesture';
import { vertexHandlerFactory } from './vertexTool';

export const MEASURE_TOOLS = {
  measureDistance: 'distance',
  measurePerimeter: 'perimeter',
  measureArea: 'area',
} as const satisfies Partial<Record<DrawTool, MeasureKind>>;

export type MeasureTool = keyof typeof MEASURE_TOOLS;

/** Measure tab command → tool. */
export const MEASURE_COMMANDS: Record<string, MeasureTool> = {
  'measure.distance': 'measureDistance',
  'measure.perimeter': 'measurePerimeter',
  'measure.area': 'measureArea',
};

const BASE: Record<MeasureTool, string> = {
  measureDistance: 'line',
  measurePerimeter: 'polyline',
  measureArea: 'polygon',
};

/** Thin lines with ticks at the ends, like a dimension line. */
const STYLE = { strokeWidth: 1, strokeColor: '#E44234', color: 'transparent', opacity: 1 };

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
    // Placed by clicks with the points kept outside the handler, so a view change
    // between two clicks keeps them (M13-10, M14-02): dimensionTool.ts, vertexTool.ts.
    const handler = kind === 'distance' ? dimensionHandlerFactory : vertexHandlerFactory(kind, id);
    if (!base) continue;
    // A distance is drawn like a dimension line, an open arrow at each end (owner,
    // 2026-11-24, M13-04); a perimeter keeps plain (butt) ends.
    const end =
      kind === 'distance' ? PdfAnnotationLineEnding.OpenArrow : PdfAnnotationLineEnding.Butt;
    const ends = kind === 'area' ? {} : { lineEndings: { start: end, end } };
    cap.addTool({
      ...base,
      id,
      name: id,
      labelKey: `annotation.${id}`,
      categories: ['annotation', 'measure'],
      // Above the base tool's score, so a measurement is edited as one.
      matchScore: (a: PdfAnnotationObject) => (measureKind(a) === kind ? 30 : 0),
      defaults: { ...base.defaults, ...STYLE, ...ends, intent: MEASURE_INTENT[kind] },
      // No click-to-place default length: a measurement is always drawn. Its
      // leader lines stay inside its rect when a point is dragged (M13-10).
      ...(kind === 'distance'
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
