// EmbedPDF plugin registrations (ADR-011 decision 1): one registry for all
// tabs, versions pinned to 2.15.1. Documents enter through the document
// manager's openDocumentBuffer from our open pipeline, never its file dialog,
// and never with per-document `permissions` overrides (rule 9).
import { createPluginRegistration } from '@embedpdf/core';
import { DocumentManagerPluginPackage } from '@embedpdf/plugin-document-manager';
import { RenderPluginPackage } from '@embedpdf/plugin-render';
import { ScrollPluginPackage } from '@embedpdf/plugin-scroll';
import { TilingPluginPackage } from '@embedpdf/plugin-tiling';
import { ViewportPluginPackage } from '@embedpdf/plugin-viewport';
import { ZoomMode, ZoomPluginPackage } from '@embedpdf/plugin-zoom';

/** Open documents at once; the next open is refused with a message. */
export const MAX_DOCUMENTS = 32;

/** Gap between pages and around them, in CSS px. */
export const PAGE_GAP = 10;

/** Tile edge in CSS px (ADR-004 decision 3, ADR-011 decision 2). */
export const TILE_SIZE = 256;

/** §5: 1 %–6400 % (ADR-011 decision 5). */
export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 64;

export const PLUGINS = [
  createPluginRegistration(DocumentManagerPluginPackage, { maxDocuments: MAX_DOCUMENTS }),
  createPluginRegistration(ViewportPluginPackage, { viewportGap: PAGE_GAP }),
  createPluginRegistration(ScrollPluginPackage, { defaultPageGap: PAGE_GAP }),
  createPluginRegistration(RenderPluginPackage, { defaultImageType: 'image/png' }),
  createPluginRegistration(TilingPluginPackage, {
    tileSize: TILE_SIZE,
    overlapPx: 2.5,
    extraRings: 0,
    defaultImageType: 'image/png',
  }),
  createPluginRegistration(ZoomPluginPackage, {
    defaultZoomLevel: ZoomMode.FitWidth,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
  }),
];
