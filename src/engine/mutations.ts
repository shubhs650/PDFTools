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

export const isMutation = (method: string): boolean =>
  ANNOTATION_METHODS.has(method) || FORM_METHODS.has(method) || OTHER_MUTATIONS.has(method);
