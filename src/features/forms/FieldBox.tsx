// A form field's box while fields are designed (M6-14): see fieldDesign.tsx.
import type { PdfWidgetAnnoObject } from '@embedpdf/models';
import type { AnnotationRendererProps } from '@embedpdf/plugin-annotation/react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store/appStore';
import { isDesignTool, kindOfType } from './fieldModel';

const KIND_KEYS = {
  text: 'forms.props.kind.text',
  checkbox: 'forms.props.kind.checkbox',
  radio: 'forms.props.kind.radio',
  list: 'forms.props.kind.list',
  combo: 'forms.props.kind.combo',
} as const;

export function FieldBox({
  widget,
  isSelected,
  onClick,
}: {
  widget: PdfWidgetAnnoObject;
  isSelected: boolean;
  onClick?: AnnotationRendererProps['onClick'];
}) {
  const { t } = useTranslation();
  const design = useApp((s) => isDesignTool(s.tool));
  if (!design) return <></>;
  const kind = kindOfType(widget.field.type);
  const toggle = kind === 'checkbox' || kind === 'radio';
  return (
    <div
      className="field-design"
      data-field-design={widget.field.name}
      data-kind={kind ?? 'other'}
      data-selected={isSelected || undefined}
      title={kind ? `${widget.field.name} (${t(KIND_KEYS[kind])})` : widget.field.name}
      style={{ pointerEvents: !onClick || isSelected ? 'none' : 'auto' }}
      onPointerDown={onClick}
    >
      {toggle ? null : <span className="field-design-name">{widget.field.name}</span>}
    </div>
  );
}
