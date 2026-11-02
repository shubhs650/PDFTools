// Form fields on the annotation layer (M6-14): with Select Fields or a field
// tool on, each widget is a box with its field name, which the annotation
// plugin selects, moves and resizes (Field Properties then edits it). In the
// other tools a widget has no box here: the form layer fills it (M2-14).
// Drawing a new field previews as a dashed box. Colours are tokens (rule 11).
import {
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
  type PdfWidgetAnnoObject,
} from '@embedpdf/models';
import { createRenderer } from '@embedpdf/plugin-annotation/react';
import { FieldBox } from './FieldBox';

const isWidget = (a: PdfAnnotationObject): a is PdfWidgetAnnoObject =>
  a.type === PdfAnnotationSubtype.WIDGET;

export const FIELD_RENDERER = createRenderer<PdfWidgetAnnoObject, unknown>({
  id: 'formFieldDesign',
  matches: isWidget,
  render: ({ currentObject, isSelected, onClick }) => (
    <FieldBox widget={currentObject} isSelected={isSelected} onClick={onClick} />
  ),
  matchesPreview: (p) => p.type === PdfAnnotationSubtype.WIDGET,
  renderPreview: ({ bounds, scale }) => (
    <div
      className="field-design field-design-preview"
      style={{ width: bounds.size.width * scale, height: bounds.size.height * scale }}
    />
  ),
  interactionDefaults: { isDraggable: true, isResizable: true, isRotatable: false },
  useAppearanceStream: false,
});
