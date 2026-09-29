// Distance, Perimeter and Area (M3-16, §7.4, ADR-007): EmbedPDF's line,
// polyline and polygon tools with a dimension intent (/IT), so PDFium draws
// the geometry (B7) and the plugin previews, commits and undoes as usual. The
// plugin's previews feed the live value next to the pointer (measureStore);
// the value, label and measure keys follow on commit (measurements.ts).
import type { PluginRegistry } from '@embedpdf/core';
import { PdfAnnotationLineEnding, type PdfAnnotationObject } from '@embedpdf/models';
import type { AnnotationCapability } from '@embedpdf/plugin-annotation';
import { MEASURE_INTENT, measureKind, type MeasureKind } from '../../model/measurement';
import type { Pt } from '../../model/scale';
import type { DrawTool } from '../annotate/tools/drawModel';
import { wrapFactory, type HandlerContext } from '../annotate/tools/drawTools';
import { capability } from '../view/host';
import { setLive } from './measureStore';

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

function watching(kind: MeasureKind) {
  return (context: HandlerContext): HandlerContext => ({
    ...context,
    onPreview: (state) => {
      context.onPreview(state);
      setLive(
        state
          ? {
              page: context.pageIndex,
              kind,
              pts: previewPoints(state.data as PreviewData | undefined),
            }
          : null,
      );
    },
    onCommit: (annotation, ctx) => {
      setLive(null);
      context.onCommit(annotation, ctx);
    },
  });
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
    const handler = base?.pointerHandler;
    if (!base || !handler) continue;
    const ends =
      kind === 'area'
        ? {}
        : {
            lineEndings: {
              start: PdfAnnotationLineEnding.Butt,
              end: PdfAnnotationLineEnding.Butt,
            },
          };
    cap.addTool({
      ...base,
      id,
      name: id,
      labelKey: `annotation.${id}`,
      categories: ['annotation', 'measure'],
      // Above the base tool's score, so a measurement is edited as one.
      matchScore: (a: PdfAnnotationObject) => (measureKind(a) === kind ? 30 : 0),
      defaults: { ...base.defaults, ...STYLE, ...ends, intent: MEASURE_INTENT[kind] },
      // No click-to-place default length: a measurement is always drawn.
      ...(kind === 'distance' ? { clickBehavior: { enabled: false, defaultLength: 0 } } : {}),
      pointerHandler: wrapFactory(id, handler, watching(kind)),
    });
  }
}
