// Read only comments stay reachable (M6-06, ADR-021 D-38 f). EmbedPDF's
// plugin treats an annotation with the /F ReadOnly bit as not interactive:
// it can't be selected anywhere, so once the Properties pane set Read only
// nobody could clear it again. Here a Read only comment is selectable (the
// pane and the comment menu can show and clear its flags) but fixed, like a
// Locked one: never moved, resized, rotated or its text edited. Hidden and
// NoView annotations stay out of reach, as before. A hook on the plugin
// instance, like authoring.ts.
import type { PluginRegistry } from '@embedpdf/core';
import type { PdfAnnotationObject } from '@embedpdf/models';

interface AnnotationPluginInternals {
  isAnnotationInteractive(a: PdfAnnotationObject, documentId: string): boolean;
  isAnnotationStructurallyLocked(a: PdfAnnotationObject, documentId: string): boolean;
  isAnnotationContentLocked(a: PdfAnnotationObject, documentId: string): boolean;
}

const readOnly = (a: PdfAnnotationObject): boolean => a.flags?.includes('readOnly') ?? false;

/** `a` without its ReadOnly bit (what the plugin's own checks then see). */
export const withoutReadOnly = (a: PdfAnnotationObject): PdfAnnotationObject =>
  readOnly(a) ? { ...a, flags: (a.flags ?? []).filter((f) => f !== 'readOnly') } : a;

/** Called once the plugin registry is up (DocumentHost). */
export function installFlagPolicy(registry: PluginRegistry): void {
  const plugin = registry.getPlugin('annotation') as unknown as AnnotationPluginInternals | null;
  if (!plugin || typeof plugin.isAnnotationInteractive !== 'function') return;
  const interactive = plugin.isAnnotationInteractive.bind(plugin);
  const structural = plugin.isAnnotationStructurallyLocked.bind(plugin);
  const content = plugin.isAnnotationContentLocked.bind(plugin);
  plugin.isAnnotationInteractive = (a, doc) => interactive(withoutReadOnly(a), doc);
  plugin.isAnnotationStructurallyLocked = (a, doc) => readOnly(a) || structural(a, doc);
  plugin.isAnnotationContentLocked = (a, doc) => readOnly(a) || content(a, doc);
}
