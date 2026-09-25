// EmbedPDF plugin registrations (ADR-011 decision 1): one registry for all
// tabs, versions pinned to 2.15.1. Documents enter through the document
// manager's openDocumentBuffer from our open pipeline, never its file dialog,
// and never with per-document `permissions` overrides (rule 9). The viewer
// plugins (viewport, scroll, render, tiling, zoom…) join in M1-14.
import { createPluginRegistration } from '@embedpdf/core';
import { DocumentManagerPluginPackage } from '@embedpdf/plugin-document-manager';

/** Open documents at once; the next open is refused with a message. */
export const MAX_DOCUMENTS = 32;

export const PLUGINS = [
  createPluginRegistration(DocumentManagerPluginPackage, { maxDocuments: MAX_DOCUMENTS }),
];
