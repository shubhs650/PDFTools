// Executor methods that change a document (M1-20, M1-22). Shared by the Render
// worker's save tracker (dirty set, permission check, rule 9) and the main
// thread's hosted engine (the tab's dirty mark).

export const ANNOTATION_METHODS = new Set([
  'createPageAnnotation',
  'updatePageAnnotation',
  'removePageAnnotation',
]);
export const FORM_METHODS = new Set([
  'setFormFieldValue',
  'setFormFieldState',
  'renameWidgetField',
  'shareWidgetField',
  'regenerateWidgetAppearances',
]);
/** Other document changes: allowed with bit 4; not tracked, so the next save keeps all. */
export const OTHER_MUTATIONS = new Set([
  'setMetadata',
  'deletePage',
  'importPages',
  'flattenAnnotation',
  'flattenPage',
  'redactTextInRects',
  'applyRedaction',
  'applyAllRedactions',
  'addAttachment',
  'removeAttachment',
  'setBookmarks',
  'deleteBookmarks',
  'setDocumentEncryption',
  'removeEncryption',
]);

/** `PdfAnnotationSubtype.WIDGET` (kept literal: this module has no imports). */
const WIDGET = 20;

/** Changes to a form's structure, not its values (M6-14, ADR-022 d4). */
const FIELD_STRUCTURE_METHODS = new Set(['renameWidgetField', 'shareWidgetField']);

/**
 * Creating, renaming, sharing, changing and deleting form fields (M6-14,
 * ADR-022 decision 4): ISO 32000-1 table 22 asks for bit 4 (modify) and bit 6
 * (annotate), not only "fill in forms". `args` are the executor call's
 * (document, page, annotation, …).
 */
export function isFieldDesign(method: string, args: readonly unknown[]): boolean {
  if (FIELD_STRUCTURE_METHODS.has(method)) return true;
  if (!ANNOTATION_METHODS.has(method)) return false;
  const annot = args[2] as { type?: unknown } | undefined;
  return annot?.type === WIDGET;
}

export const isMutation = (method: string): boolean =>
  ANNOTATION_METHODS.has(method) || FORM_METHODS.has(method) || OTHER_MUTATIONS.has(method);
