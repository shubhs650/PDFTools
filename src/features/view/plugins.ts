// EmbedPDF plugin registrations (ADR-011 decision 1): one registry for all
// tabs, versions pinned to 2.15.1. Documents enter through the document
// manager's openDocumentBuffer from our open pipeline, never its file dialog,
// and never with per-document `permissions` overrides (rule 9).
import { createPluginRegistration } from '@embedpdf/core';
import { AnnotationPluginPackage } from '@embedpdf/plugin-annotation/react';
import { HistoryPluginPackage } from '@embedpdf/plugin-history';
import { DocumentManagerPluginPackage } from '@embedpdf/plugin-document-manager';
import { InteractionManagerPluginPackage } from '@embedpdf/plugin-interaction-manager/react';
import { RenderPluginPackage } from '@embedpdf/plugin-render';
import { RotatePluginPackage } from '@embedpdf/plugin-rotate';
import { ScrollPluginPackage } from '@embedpdf/plugin-scroll';
import { SelectionPluginPackage } from '@embedpdf/plugin-selection/react';
import { SpreadPluginPackage } from '@embedpdf/plugin-spread';
import { TilingPluginPackage } from '@embedpdf/plugin-tiling';
import { ViewportPluginPackage } from '@embedpdf/plugin-viewport';
import { ZoomMode, ZoomPluginPackage } from '@embedpdf/plugin-zoom';
import { PdfAnnotationSubtype } from '@embedpdf/models';
import { SignatureMode, SignaturePluginPackage } from '@embedpdf/plugin-signature';
import { SIGNATURE_PLACE_SIZE } from '../../model/visualSignature';
import { MARKUP_TOOLS } from '../annotate/tools/markupModel';
import { markupSelectionHandler } from '../annotate/tools/textMarkup';
import { redactSelectionHandler, REDACT_TEXT_TOOL } from '../redact/markTools';

/** Open documents at once; the next open is refused with a message. */
export const MAX_DOCUMENTS = 32;

/** Gap between pages and around them, in CSS px. */
export const PAGE_GAP = 10;

/** Tile edge in CSS px (ADR-004 decision 3, ADR-011 decision 2). */
export const TILE_SIZE = 256;

/** §5: 1 %–6400 % (ADR-011 decision 5). */
export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 64;

/** Pages whose text geometry the selection plugin keeps (it loads visible pages only). */
export const SELECTION_PAGES = 30;

/** Interaction modes: Select (EmbedPDF's default, with text selection) and Hand. */
export const POINTER_MODE = 'pointerMode';
export const HAND_MODE = 'handMode';

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
  createPluginRegistration(SpreadPluginPackage, {}),
  createPluginRegistration(RotatePluginPackage, {}),
  createPluginRegistration(ZoomPluginPackage, {
    defaultZoomLevel: ZoomMode.FitWidth,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
  }),
  // Text selection (M2-04, ADR-012 decision 1): pointer events per page, text
  // geometry from the Work worker (RoutedPdfEngine). The React package adds the
  // clipboard writer.
  createPluginRegistration(InteractionManagerPluginPackage, {}),
  createPluginRegistration(SelectionPluginPackage, { maxCachedGeometries: SELECTION_PAGES }),
  // Annotations (M3-05, ADR-014): the plugin's store, tools, selection and
  // handles, with per-document undo from plugin-history. Its annotations load
  // from the Work worker and are drawn by our annotation tiles (RoutedPdfEngine,
  // AnnotationTileLayer). URI links never open by themselves: the link layer
  // asks first (M2-10, rule 4).
  createPluginRegistration(HistoryPluginPackage, {}),
  createPluginRegistration(AnnotationPluginPackage, {
    autoCommit: true,
    autoOpenLinks: false,
    selectAfterCreate: true,
    // Text markups are made by our handler (M3-08): our defaults, the
    // reviewer profile first, the text in /Contents only if copying is allowed.
    tools: [
      ...MARKUP_TOOLS.map((id) => ({ id, selectionHandler: markupSelectionHandler(id) })),
      // Redaction marks from text selections (M4-16).
      {
        id: REDACT_TEXT_TOOL,
        name: 'Mark for Redaction',
        categories: ['annotation', 'redaction'],
        // Never claims existing annotations (their tool is the default one).
        matchScore: () => 0,
        interaction: {
          exclusive: false,
          textSelection: true,
          isDraggable: false,
          isResizable: false,
          isRotatable: false,
          isGroupDraggable: false,
          isGroupResizable: false,
        },
        defaults: { type: PdfAnnotationSubtype.REDACT },
        selectionHandler: redactSelectionHandler,
      },
    ],
  }),
  // Visual signatures (M6-13, ADR-021 D-40 b, ADR-022 d3): signature and
  // initials entries, placed by the plugin's Ink and Stamp tools. Entries come
  // from our dialog and IndexedDB store (sign/), never from the plugin's own UI.
  createPluginRegistration(SignaturePluginPackage, {
    mode: SignatureMode.SignatureAndInitials,
    defaultSize: { ...SIGNATURE_PLACE_SIZE },
  }),
];
