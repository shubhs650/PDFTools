// Who wrote an annotation (M3-07, D-03, D-16, M3-Q7): new annotations get the
// reviewer profile's name as /T (anonymous when skipped); an edit never
// changes the author. EmbedPDF's plugin reads its author from its config on
// every create and puts it into every update patch too, so a resize of
// someone else's markup would re-author it. Both hooks go on the plugin
// instance; the Render worker keeps the file's /T independently (annotIds.ts).
import type { PdfAnnotationObject } from '@embedpdf/models';
import type { PluginRegistry } from '@embedpdf/core';
import { t } from '../../i18n';
import { profileStore } from '../settings/profile/profileStore';

interface AnnotationPluginInternals {
  config: { annotationAuthor?: string };
  buildPatch: (
    original: PdfAnnotationObject,
    patch: Partial<PdfAnnotationObject>,
  ) => Partial<PdfAnnotationObject>;
}

/** The author of new annotations: the profile's name, or the localized "Anonymous". */
export function currentAuthor(): string {
  return profileStore.getState().profile?.name ?? t('annotate.anonymous');
}

/** Keeps `original`'s author in an update patch (no author key when it has none). */
export function keepOriginalAuthor<P extends { author?: string | undefined }>(
  original: { author?: string | undefined },
  patch: P,
): P {
  const out: P = { ...patch };
  if (original.author === undefined) delete out.author;
  else out.author = original.author;
  return out;
}

/** Called once the plugin registry is up (DocumentHost); returns the unsubscribe. */
export function installAuthoring(registry: PluginRegistry): () => void {
  const plugin = registry.getPlugin('annotation') as unknown as AnnotationPluginInternals | null;
  if (!plugin || typeof plugin.buildPatch !== 'function') return () => undefined;
  const build = plugin.buildPatch.bind(plugin);
  plugin.buildPatch = (original, patch) => build(original, keepOriginalAuthor(original, patch));
  const apply = (): void => {
    plugin.config.annotationAuthor = currentAuthor();
  };
  apply();
  return profileStore.subscribe(apply);
}
