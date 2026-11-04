// The comment just drawn is selected (M7-04, bug B9). While a drawing tool is
// on, DocumentView locks every comment (LockModeType.All) so a press on an
// existing one starts a new comment instead of picking that one up; the lock
// also kept the plugin from selecting the comment it had just made
// (selectAfterCreate), so the Properties pane, Delete and the comment menu
// could not act on it. Here the comment made by the tool on is exempt from the
// lock until it is deselected: it shows its handles, moves and resizes, and the
// next press on empty page space deselects it and starts the next comment (the
// tool stays on, as before). Freehand tools are left out: their next stroke
// usually starts inside the last one's box, which would move it instead.
import type { PluginRegistry } from '@embedpdf/core';
import type { PdfAnnotationObject } from '@embedpdf/models';
import type { AnnotationCapability } from '@embedpdf/plugin-annotation';
import { appStore } from '../../app/store/appStore';
import { capability } from '../view/host';
import { isDrawTool, type DrawTool } from './tools/drawModel';

/** Drawing tools whose new comment stays unselected. */
const NOT_SELECTED: ReadonlySet<DrawTool> = new Set([
  // Freehand: the next stroke begins inside the last one's box.
  'ink',
  'inkHighlighter',
  // Not comments: the link layer, the scale dialog and calibration own them.
  'link',
  'calibrate',
  'scaleViewport',
]);

/** Whether the comment `tool` makes is selected right after it is made. */
export const selectsAfterDraw = (tool: string): boolean =>
  isDrawTool(tool) && !NOT_SELECTED.has(tool);

interface InteractiveInternals {
  createAnnotation(pageIndex: number, annotation: PdfAnnotationObject, ...rest: unknown[]): void;
  isAnnotationInteractive(annotation: PdfAnnotationObject, documentId?: string): boolean;
}

/** Flags that keep a comment out of reach whatever the lock (as the plugin has them). */
const UNREACHABLE = ['hidden', 'noView', 'readOnly'] as const;

/**
 * The comment each document's drawing tool made last. `armed` until the
 * plugin's own select-after-create has selected it; after that it stays exempt
 * only while it is selected.
 */
const drawn = new Map<string, { id: string; armed: boolean }>();

/** Called once the plugin registry is up (DocumentHost); returns the uninstall. */
export function installSelectAfterDraw(registry: PluginRegistry): () => void {
  const plugin = registry.getPlugin('annotation') as unknown as InteractiveInternals | null;
  if (
    !plugin ||
    typeof plugin.createAnnotation !== 'function' ||
    typeof plugin.isAnnotationInteractive !== 'function'
  )
    return () => undefined;
  const create = plugin.createAnnotation.bind(plugin);
  const interactive = plugin.isAnnotationInteractive.bind(plugin);
  const cap = capability<AnnotationCapability>(registry, 'annotation');

  plugin.createAnnotation = (pageIndex, annotation, ...rest) => {
    const docId = rest[1];
    const tool = appStore.getState().tool;
    if (typeof docId === 'string' && selectsAfterDraw(tool))
      drawn.set(docId, { id: annotation.id, armed: true });
    create(pageIndex, annotation, ...rest);
  };
  plugin.isAnnotationInteractive = (annotation, documentId) => {
    if (interactive(annotation, documentId)) return true;
    for (const d of drawn.values())
      if (d.id === annotation.id)
        return !UNREACHABLE.some((f) => (annotation.flags ?? []).includes(f));
    return false;
  };

  const offState = cap.onStateChange(({ documentId, state }) => {
    const d = drawn.get(documentId);
    if (!d) return;
    if (state.selectedUids.includes(d.id)) d.armed = false;
    else if (!d.armed || !state.byUid[d.id]) drawn.delete(documentId);
  });
  // Another tool: the lock changes anyway, and nothing just drawn stays exempt.
  const offTool = appStore.subscribe((s, prev) => {
    if (s.tool !== prev.tool) drawn.clear();
  });
  return () => {
    offState();
    offTool();
    plugin.createAnnotation = create;
    plugin.isAnnotationInteractive = interactive;
  };
}
