// Tool Properties (M6-06, ADR-021 D-37): while a comment tool is on, the
// Properties pane edits that tool's defaults (M6-03 store) instead of a
// selection; "Make current properties default" copies a comment's style into
// its tool's defaults.
import type { PdfAnnotationObject } from '@embedpdf/models';
import { msg, t, type MessageKey } from '../../../i18n';
import { annotationCapability } from '../selection';
import { isStyleTool, type StyleProps, type StyleTool } from '../tools/toolDefaults';
import { defaultsFor, setToolDefaults } from '../tools/toolDefaultsStore';
import { announceTransfer } from '../transfer/transferAnnounce';
import { has, patchFor, toolStyleOf, TOOL_PROPS, type Plain, type Prop } from './model';

/** The tool's name in "‹Tool› Tool Properties" and announcements. */
export const TOOL_NAME_KEYS: Record<StyleTool, MessageKey> = {
  freeText: msg('annotProps.toolName.freeText'),
  typewriter: msg('annotProps.toolName.typewriter'),
  freeTextCallout: msg('annotProps.toolName.freeTextCallout'),
  line: msg('annotProps.toolName.line'),
  lineArrow: msg('annotProps.toolName.lineArrow'),
  polyline: msg('annotProps.toolName.polyline'),
  polygon: msg('annotProps.toolName.polygon'),
  square: msg('annotProps.toolName.square'),
  circle: msg('annotProps.toolName.circle'),
  cloud: msg('annotProps.toolName.cloud'),
  ink: msg('annotProps.toolName.ink'),
};

/**
 * What a new comment of `tool` looks like now, as an annotation object the
 * grid reads like a selection (the plugin's tool defaults with ours on top).
 */
export function toolSample(tool: StyleTool): PdfAnnotationObject | null {
  const base = annotationCapability()?.getTool(tool)?.defaults as
    Record<string, unknown> | undefined;
  if (!base || typeof base['type'] !== 'number') return null;
  return {
    ...base,
    ...defaultsFor(tool),
    id: `tool:${tool}`,
    pageIndex: 0,
    rect: { origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } },
  } as unknown as PdfAnnotationObject;
}

/** The properties a tool's defaults show in the grid. */
export const toolPropsOf = (sample: PdfAnnotationObject): Prop[] =>
  TOOL_PROPS.filter((p) => has(sample, p));

/** A Tool Properties change: the tool's defaults patch, stored (one change, no undo step). */
export function setToolProp(tool: StyleTool, p: Prop, v: Plain): Promise<void> {
  const sample = toolSample(tool);
  const patch = sample ? patchFor(sample, p, v) : null;
  if (!patch) return Promise.resolve();
  const props = patch as StyleProps & Record<string, unknown>;
  // The pencil's color is also its deprecated `color` alias (M6-03).
  if (tool === 'ink' && typeof props.strokeColor === 'string') props.color = props.strokeColor;
  return setToolDefaults(tool, props);
}

/** The style tool a selection's comments were made with (one tool for all), or null. */
export function defaultToolOf(sel: readonly PdfAnnotationObject[]): StyleTool | null {
  const cap = annotationCapability();
  if (!cap || sel.length === 0) return null;
  const ids = new Set(sel.map((a) => cap.findToolForAnnotation(a)?.id ?? ''));
  const [only] = [...ids];
  return ids.size === 1 && only && isStyleTool(only) ? only : null;
}

/** "Make current properties default": the first selected comment's style becomes its tool's. */
export async function makeCurrentDefault(
  docId: string,
  sel: readonly PdfAnnotationObject[],
): Promise<void> {
  const tool = defaultToolOf(sel);
  const first = sel[0];
  if (!tool || !first) return;
  await setToolDefaults(tool, toolStyleOf(first));
  announceTransfer(docId, t('annotProps.madeDefault', { tool: t(TOOL_NAME_KEYS[tool]) }));
}
