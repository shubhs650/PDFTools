// The annotation plugin's layer for one page (M3-05, ADR-014 decision 3): it
// hit-tests, selects, shows handles and live previews. Markups themselves are
// drawn by the annotation tiles underneath, so an annotation's body is shown
// here only while it is selected (then the tiles leave it out). Unselected
// bodies stay in the DOM, invisible, so a click on the shape still selects it.
import { PdfAnnotationSubtype, type PdfAnnotationObject } from '@embedpdf/models';
import { AnnotationLayer as PluginLayer } from '@embedpdf/plugin-annotation/react';
import type { CustomAnnotationRenderer } from '@embedpdf/plugin-annotation/react';

/** Links and form fields have their own layers (M2-10, M2-14): no body or hit area here. */
const OWN_LAYER = new Set([PdfAnnotationSubtype.LINK, PdfAnnotationSubtype.WIDGET]);

const renderBody: CustomAnnotationRenderer<PdfAnnotationObject> = ({
  annotation,
  children,
  isSelected,
}) =>
  OWN_LAYER.has(annotation.type) ? (
    <></>
  ) : (
    <div className="annotation-body" data-selected={isSelected || undefined}>
      {children}
    </div>
  );

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
  return (
    <PluginLayer
      documentId={documentId}
      pageIndex={pageIndex}
      scale={scale}
      className="annotation-layer"
      selectionOutline={OUTLINE}
      customAnnotationRenderer={renderBody}
    />
  );
}
