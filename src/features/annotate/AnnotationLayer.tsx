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
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { libraryFamily } from '../../model/fonts/library';
import { cssFontStack, registerCommentFonts } from './fonts/commentFonts';
import { documentStore, securityOf, useDocuments } from '../../app/store/documentStore';
import { allows } from '../../model/permissions';
import { ATTACH_DEFAULT_COLOR } from '../../model/attachFile';
import { saveAttachmentById } from '../attachments/attachFile';
import { FIELD_RENDERER } from '../forms/fieldDesign';
import { TEXT_BODY_ATTR, textBodyUnmounted, useEditEpoch } from './textEdit';
import { pressComment, type PageGeometry } from './textPointer';
import { isTextMarkup } from './pointerModes';
import { annotationCapability } from './selection';
import { SelectedMeasure } from '../measure/SelectedMeasure';
import { withFileCurve } from '../measure/measurements';
import { isSummary } from '../measure/summary/summary';
import { SummaryPreview } from '../measure/summary/SummaryPreview';
import { useEditPreview } from '../measure/pointEdit';
import { metaOf } from '../../model/measureMarkup';
import { isCurveTool } from '../../model/measureCurve';

const readLibraryFont = (a: PdfAnnotationObject): string | undefined => {
  const v = (a as unknown as { libraryFont?: unknown }).libraryFont;
  return typeof v === 'string' ? v : undefined;
};

/**
 * A comment's body, marked with its id and page. A text box, typewriter or
 * callout is marked so its editor is found (textEdit.ts, M7-02), and its text
 * is written if the body unmounts while it is being edited. A text markup is
 * marked so Select Text lets presses through to the text under it (M11-06).
 */
function Body({
  documentId,
  annotation,
  isSelected,
  geometry,
  movable,
  children,
}: {
  documentId: string;
  annotation: PdfAnnotationObject;
  isSelected: boolean;
  geometry: PageGeometry;
  /** A press and drag would move it: the move cursor (M11-06, D-51). */
  movable: boolean;
  children: ReactNode;
}) {
  const text = annotation.type === PdfAnnotationSubtype.FREETEXT;
  const markup = isTextMarkup(annotation);
  const { id } = annotation;
  // A measurement whose point is being dragged: its preview is drawn instead (M14-04).
  const editing = useEditPreview(isSelected ? documentId : null, id) !== null;
  // An Angle, Radius or Diameter (a Stamp, M14-05): drawn by SelectedMeasure while
  // selected, not by the plugin's image of it (app.css).
  const shown = isSelected ? withFileCurve(documentId, annotation) : annotation;
  const curve = isMeasureCurve(shown);
  // A text comment in a library font (M11-07, D-52): its editor draws that face.
  const lib = text ? libraryFamily(readLibraryFont(annotation)) : undefined;
  const font = lib?.group ? lib.id : undefined;
  useEffect(() => {
    if (font) registerCommentFonts();
  }, [font]);
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
      data-measure-editing={editing || undefined}
      data-measure-curve={curve || undefined}
      // Which comment a Shift or Ctrl press is on (commentSelection.ts, M7-04).
      data-annotation-id={id}
      data-page-index={annotation.pageIndex}
      data-markup={markup || undefined}
      data-movable={(movable && !markup) || undefined}
      data-comment-font={font}
      style={font ? ({ '--comment-font': cssFontStack(font) } as CSSProperties) : undefined}
      {...(text ? { [TEXT_BODY_ATTR]: '' } : {})}
      // A press selects it and, dragged, moves it in every pointer mode
      // (M7-03 B5 for text comments, M11-06 D-51 for all); once selected,
      // the plugin's frame over it takes the presses. Markups never move.
      {...(isSelected || markup
        ? {}
        : {
            onPointerDownCapture: (e: PointerEvent<HTMLDivElement>) => {
              pressComment(e, annotation, geometry);
            },
          })}
    >
      {children}
      {/* A selected measurement's caption and fill (M14-03): the plugin draws only its points. */}
      {isSelected ? <SelectedMeasure annotation={shown} scale={geometry.scale} /> : null}
    </div>
  );
}

/** An Angle, Radius or Diameter: a Stamp with a curve's `measure` field. */
function isMeasureCurve(a: PdfAnnotationObject): boolean {
  if (a.type !== PdfAnnotationSubtype.STAMP) return false;
  const meta = metaOf(a);
  return !!meta && isCurveTool(meta.tool);
}

/**
 * Whether a comment may move: the document allows annotating (rule 9) and the
 * comment is not locked or read only (M6-06).
 */
function canMove(docId: string, annotation: PdfAnnotationObject): boolean {
  const meta = documentStore.getState().docs[docId]?.meta;
  if (!meta || !allows(securityOf(meta), 'annotate')) return false;
  try {
    return !annotationCapability()?.forDocument(docId).isAnnotationStructurallyLocked(annotation);
  } catch {
    return false;
  }
}

const bodyRenderer =
  (docId: string): CustomAnnotationRenderer<PdfAnnotationObject> =>
  ({ annotation, children, isSelected, scale, rotation, pageWidth, pageHeight }) =>
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
        documentId={docId}
        annotation={annotation}
        isSelected={isSelected}
        geometry={{ scale, rotation, pageWidth, pageHeight }}
        movable={canMove(docId, annotation)}
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

/**
 * The measurement summary (M14-10, D-76): a table drawn in its appearance, not
 * a text box to type in. This renderer gives it a hit area (the plugin's
 * appearance image draws it, or SummaryPreview until the plugin has that
 * image), so it selects, moves and deletes as one item; it never opens the text editor and is never resized
 * (Triya PDF sizes it to its rows).
 */
const SUMMARY = createRenderer({
  id: 'measureSummary',
  matches: (a): a is PdfAnnotationObject => isSummary(a),
  render: ({ currentObject, isSelected, onClick, appearanceActive }) => (
    <div
      className="file-attachment-hit"
      data-measure-summary=""
      style={{
        pointerEvents: !onClick || isSelected ? 'none' : 'auto',
        cursor: isSelected ? 'move' : 'pointer',
      }}
      onPointerDown={onClick}
    >
      {appearanceActive ? null : <SummaryPreview annotation={currentObject} />}
    </div>
  ),
  interactionDefaults: {
    isDraggable: true,
    isResizable: false,
    isRotatable: false,
    lockAspectRatio: true,
  },
  onDoubleClick: () => undefined,
});

// Form fields (M6-14): boxes to select, move and resize with Select Fields.
const RENDERERS = [FILE_ATTACHMENT, SUMMARY, FIELD_RENDERER];

/** The selection outline in the focus colour (a token, rules 11–12: no literal colours). */
const OUTLINE = { color: 'var(--color-focus)', width: 2 };

type VertexUI = NonNullable<Parameters<typeof PluginLayer>[0]['vertexUI']>;
type VertexProps = Parameters<NonNullable<VertexUI['component']>>[0];

/**
 * The plugin's vertex handles, except on a measurement: its points have our
 * own handles, which snap, lock with Shift and show the loupe (M14-04,
 * MeasureEditor.tsx). Only one annotation shows vertices at a time (a single
 * selection), so the selection says whose they are.
 */
const vertexUIFor = (docId: string): VertexUI => ({
  component: ({ key, backgroundColor, ...p }: VertexProps) => {
    const sel = annotationCapability()?.forDocument(docId).getSelectedAnnotations() ?? [];
    const one = sel.length === 1 ? sel[0]?.object : undefined;
    if (one && metaOf(one)) return <span key={key} hidden />;
    return <div key={key} {...p} style={{ ...p.style, backgroundColor }} />;
  },
});

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
  // Read only or protected: no move cursor (the security comes with the document).
  const annotate = useDocuments((s) => {
    const meta = s.docs[documentId]?.meta;
    return meta ? allows(securityOf(meta), 'annotate') : false;
  });
  const renderBody = useMemo(() => bodyRenderer(documentId), [documentId, annotate]); // eslint-disable-line react-hooks/exhaustive-deps
  const vertexUI = useMemo(() => vertexUIFor(documentId), [documentId]);
  return (
    <PluginLayer
      key={epoch}
      documentId={documentId}
      pageIndex={pageIndex}
      scale={scale}
      className="annotation-layer"
      selectionOutline={OUTLINE}
      customAnnotationRenderer={renderBody}
      vertexUI={vertexUI}
      annotationRenderers={RENDERERS}
    />
  );
}
