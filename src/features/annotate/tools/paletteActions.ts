// Picking a style from a tool's palette (M6-07, D-37): with comments of that
// tool's group selected, they are restyled (one plugin batch update, so one
// undo step); otherwise the style becomes the tool's and the tool turns on,
// as its button would. Locked and read-only comments are left alone (M6-06).
import { PdfAnnotationSubtype, type PdfAnnotationObject } from '@embedpdf/models';
import { runCommand } from '../../../app/commands/dispatch';
import { appStore } from '../../../app/store/appStore';
import { documentStore, selectActive } from '../../../app/store/documentStore';
import { t } from '../../../i18n';
import { isFixed } from '../properties/model';
import { TOOL_NAME_KEYS } from '../properties/toolProperties';
import { annotationCapability } from '../selection';
import { announceTransfer } from '../transfer/transferAnnounce';
import { sameGroup } from './stylePalette';
import { isStyleTool, type StyleProps, type StyleTool } from './toolDefaults';
import { setToolDefaults } from './toolDefaultsStore';

const ALIASED: ReadonlySet<PdfAnnotationSubtype> = new Set([
  PdfAnnotationSubtype.INK,
  PdfAnnotationSubtype.HIGHLIGHT,
]);

const activeId = (): string | null => selectActive(documentStore.getState())?.meta.id ?? null;

/** The selected comments a style of `tool` restyles: same group, not locked or read only. */
export function restyleTargets(docId: string, tool: StyleTool): PdfAnnotationObject[] {
  const cap = annotationCapability();
  if (!cap) return [];
  let sel: PdfAnnotationObject[];
  try {
    sel = cap
      .forDocument(docId)
      .getSelectedAnnotations()
      .map((x) => x.object);
  } catch {
    return [];
  }
  return sel.filter((a) => {
    const id = cap.findToolForAnnotation(a)?.id ?? '';
    return isStyleTool(id) && sameGroup(id, tool) && !isFixed(a);
  });
}

/** The patch a style makes on one comment (the pencil keeps its `color` alias in step). */
export function stylePatchFor(a: PdfAnnotationObject, props: StyleProps): Record<string, unknown> {
  const patch: Record<string, unknown> = { ...props };
  // Ink and text markups keep /C in both fields.
  if (props.strokeColor && !('color' in props) && ALIASED.has(a.type))
    patch['color'] = props.strokeColor;
  return patch;
}

/**
 * Applies a palette style: restyles the selected comments of `tool`'s group,
 * or sets `tool`'s style and turns it on (`command` is its ribbon command).
 */
export async function pickStyle(
  tool: StyleTool,
  command: string,
  props: StyleProps,
  name: string,
): Promise<void> {
  const docId = activeId();
  const targets = docId ? restyleTargets(docId, tool) : [];
  if (docId && targets.length > 0) {
    annotationCapability()
      ?.forDocument(docId)
      .updateAnnotations(
        targets.map((a) => ({
          pageIndex: a.pageIndex,
          id: a.id,
          patch: stylePatchFor(a, props),
        })),
      );
    announceTransfer(docId, t('stylePalette.applied', { name, count: targets.length }));
    return;
  }
  await setToolDefaults(tool, props);
  if (docId)
    announceTransfer(docId, t('stylePalette.toolSet', { name, tool: t(TOOL_NAME_KEYS[tool]) }));
  if (appStore.getState().tool !== tool) await runCommand(command);
}
