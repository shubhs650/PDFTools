// The annotation plugin's layer for one page (M3-05, ADR-014 decision 3): it
// hit-tests, selects, shows handles and live previews. Markups themselves are
// drawn by the annotation tiles underneath, so an annotation's body is shown
// here only while it is selected (then the tiles leave it out). Unselected
// bodies stay in the DOM, invisible, so a click on the shape still selects it.
import { PdfAnnotationSubtype, type PdfAnnotationObject } from '@embedpdf/models';
import {
  AnnotationLayer as PluginLayer,
  createRenderer,
  type CustomAnnotationRenderer,
} from '@embedpdf/plugin-annotation/react';
import { useLayoutEffect, type PointerEvent, type ReactNode } from 'react';
import { ATTACH_DEFAULT_COLOR } from '../../model/attachFile';
import { saveAttachmentById } from '../attachments/attachFile';
import { FIELD_RENDERER } from '../forms/fieldDesign';
import { TEXT_BODY_ATTR, textBodyUnmounted, useEditEpoch } from './textEdit';
import { pressTextComment, type PageGeometry } from './textPointer';

/**
 * A comment's body. A text box, typewriter or callout is marked so its
 * editor is found (textEdit.ts, M7-02), and its text is written if the body
 * unmounts while it is being edited.
 */
function Body({
  annotation,
  isSelected,
  geometry,
  children,
}: {
  annotation: PdfAnnotationObject;
  isSelected: boolean;
  geometry: PageGeometry;
  children: ReactNode;
}) {
  const text = annotation.type === PdfAnnotationSubtype.FREETEXT;
  const { id } = annotation;
  useLayoutEffect(
    () =>
      text
        ? () => {
            textBodyUnmounted(id);
          }
        : undefined,
    [text, id],
  );
  return (
    <div
      className="annotation-body"
      data-selected={isSelected || undefined}
      {...(text
        ? {
            [TEXT_BODY_ATTR]: '',
            'data-annotation-id': id,
            'data-page-index': annotation.pageIndex,
            // A press selects it and, dragged, moves it (M7-03, B5); once
            // selected, the plugin's frame over it takes the presses.
            ...(isSelected
              ? {}
              : {
                  onPointerDownCapture: (e: PointerEvent<HTMLDivElement>) => {
                    pressTextComment(e, annotation, geometry);
                  },
                }),
          }
        : {})}
    >
      {children}
    </div>
  );
}

const renderBody: CustomAnnotationRenderer<PdfAnnotationObject> = ({
  annotation,
  children,
  isSelected,
  scale,
  rotation,
  pageWidth,
  pageHeight,
}) =>
  // Form fields: the field box (fieldDesign.tsx), which is empty unless fields
  // are designed; the form layer fills them (M2-14, M6-14).
  annotation.type === PdfAnnotationSubtype.WIDGET ? (
    <>{children}</>
  ) : // Links have their own layer (M2-10); replies (/IRT notes, M3-12) are
  // shown in the thread, never on the page.
  annotation.type === PdfAnnotationSubtype.LINK ||
    (annotation.type === PdfAnnotationSubtype.TEXT && annotation.inReplyToId) ? (
    <></>
  ) : (
    <Body
      annotation={annotation}
      isSelected={isSelected}
      geometry={{ scale, rotation, pageWidth, pageHeight }}
    >
      {children}
    </Body>
  );

/**
 * File attachments (M6-10): the plugin has no renderer for the subtype, so it
 * would neither hit-test nor select them. This one gives the paperclip a hit
 * area (the tiles, or the plugin's appearance image while selected, draw it);
 * it moves and resizes like a note icon, and a double-click is Save
 * Attachment… (its own Render call does the move, ADR-022 decision 1).
 */
const PAPERCLIP_SVG =
  'M13 5L13 14C13 16.2 11.2 18 9 18C6.8 18 5 16.2 5 14L5 6C5 3.8 6.8 2 9 2C11.2 2 13 3.8 13 6' +
  'L13 13C13 14.1 12.1 15 11 15C9.9 15 9 14.1 9 13L9 7';

const colorOf = (a: PdfAnnotationObject): string => {
  const o = a as { strokeColor?: unknown; color?: unknown };
  const c = typeof o.strokeColor === 'string' ? o.strokeColor : o.color;
  return typeof c === 'string' ? c : ATTACH_DEFAULT_COLOR;
};

const FILE_ATTACHMENT = createRenderer({
  id: 'fileAttachment',
  matches: (a): a is PdfAnnotationObject => a.type === PdfAnnotationSubtype.FILEATTACHMENT,
  render: ({ currentObject, isSelected, onClick, appearanceActive }) => (
    <div
      className="file-attachment-hit"
      style={{
        pointerEvents: !onClick || isSelected ? 'none' : 'auto',
        cursor: isSelected ? 'move' : 'pointer',
      }}
      onPointerDown={onClick}
    >
      {appearanceActive ? null : (
        // Until the plugin has the appearance (just created): the same paperclip.
        <svg viewBox="0 0 20 20" width="100%" height="100%" aria-hidden="true">
          <path
            d={PAPERCLIP_SVG}
            transform="matrix(1 0 0 -1 0 20)"
            fill="none"
            stroke={colorOf(currentObject)}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  ),
  interactionDefaults: {
    isDraggable: true,
    isResizable: true,
    isRotatable: false,
    lockAspectRatio: true,
  },
  onDoubleClick: (id) => {
    saveAttachmentById(id);
  },
});

// Form fields (M6-14): boxes to select, move and resize with Select Fields.
const RENDERERS = [FILE_ATTACHMENT, FIELD_RENDERER];

/** The selection outline in the focus colour (a token, rules 11–12: no literal colours). */
const OUTLINE = { color: 'var(--color-focus)', width: 2 };

export function AnnotationLayer({
  documentId,
  pageIndex,
  scale,
}: {
  documentId: string;
  pageIndex: number;
  scale: number;
}) {
  // Remounted when a text comment's editing has to end (textEdit.ts).
  const epoch = useEditEpoch(documentId, pageIndex);
  return (
    <PluginLayer
      key={epoch}
      documentId={documentId}
      pageIndex={pageIndex}
      scale={scale}
      className="annotation-layer"
      selectionOutline={OUTLINE}
      customAnnotationRenderer={renderBody}
      annotationRenderers={RENDERERS}
    />
  );
}
