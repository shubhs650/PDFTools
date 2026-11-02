// Field Properties (M6-14, §7.10, ADR-021 D-39): the Properties pane while
// fields are designed (Select Fields or a field tool). One selected field:
// Field (type, name, tooltip, required, read only, multi-line, maximum
// length, several selections, default, export value), Options (a list's or
// dropdown's items) and Appearance (font, size, colours). No field selected:
// the current page's tab order and its fields in that order (select one to
// edit it). Every control has a visible label (rule 12); read-only without
// modify + annotate (rule 9).
import {
  PDF_FORM_FIELD_TYPE,
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
  type PdfWidgetAnnoObject,
} from '@embedpdf/models';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { documentStore, securityOf, useDocuments } from '../../app/store/documentStore';
import { msg, type MessageKey } from '../../i18n';
import { allows } from '../../model/permissions';
import type { TabOrder } from '../../model/formFacts';
import { annotationCapability, useAnnotationState } from '../annotate/selection';
import {
  CheckField,
  ColorField,
  InfoField,
  NumberField,
  SelectField,
  TextProp,
} from '../annotate/properties/fields';
import { GridSection } from '../annotate/properties/GridSection';
import { FONT_FAMILIES, fontFor, fontParts } from '../annotate/properties/model';
import {
  renameField,
  setDefault,
  setTabOrder,
  setTooltip,
  stagedDefault,
  stagedTooltip,
  updateField,
  updateLook,
} from './fieldActions';
import {
  hasFlag,
  kindOfType,
  MAX_LENGTH_LIMIT,
  optionsWith,
  parseOptions,
  rowsOf,
  TAB_ORDERS,
  tabOrderOf,
  withFlag,
  type FieldFlag,
} from './fieldModel';
import { tabOrder } from './fields';
import { formFactsOf, useForms } from './formStore';

/** A check box's on-state when the widget has none (PDF 32000-1 §12.7.4.2.3). */
const CHECKBOX_ON = 'Yes'; // i18n-ignore: a PDF name, not text
/** No border or fill (EmbedPDF's value). */
const NO_COLOR = 'transparent'; // i18n-ignore: a CSS keyword

const isWidget = (a: PdfAnnotationObject): a is PdfWidgetAnnoObject =>
  a.type === PdfAnnotationSubtype.WIDGET;

const KIND_KEYS = {
  text: msg('forms.props.kind.text'),
  checkbox: msg('forms.props.kind.checkbox'),
  radio: msg('forms.props.kind.radio'),
  list: msg('forms.props.kind.list'),
  combo: msg('forms.props.kind.combo'),
} as const;

const FONT_KEYS = {
  helvetica: msg('annotProps.font.helvetica'),
  times: msg('annotProps.font.times'),
  courier: msg('annotProps.font.courier'),
} as const;

const TAB_KEYS: Record<(typeof TAB_ORDERS)[number], MessageKey> = {
  R: msg('forms.tabOrder.R'),
  C: msg('forms.tabOrder.C'),
  S: msg('forms.tabOrder.S'),
  none: msg('forms.tabOrder.none'),
};

function useCanDesign(): boolean {
  return useDocuments((s) => {
    const meta = s.activeId ? s.docs[s.activeId]?.meta : undefined;
    if (!meta) return false;
    const sec = securityOf(meta);
    return allows(sec, 'modify') && allows(sec, 'annotate');
  });
}

/** The Properties pane's content while fields are designed. */
export function FieldDesignProperties({
  docId,
  sel,
}: {
  docId: string;
  sel: readonly PdfAnnotationObject[];
}) {
  const { t } = useTranslation();
  const widgets = sel.filter(isWidget);
  const one = widgets.length === 1 && sel.length === 1 ? widgets[0] : undefined;
  if (one) return <FieldProperties key={one.id} docId={docId} widget={one} />;
  if (sel.length > 0) return <p className="prop-empty">{t('forms.props.mixed')}</p>;
  return <TabOrderPanel docId={docId} />;
}

function FieldProperties({ docId, widget: w }: { docId: string; widget: PdfWidgetAnnoObject }) {
  const { t } = useTranslation();
  const canDesign = useCanDesign();
  // Staged keys re-render the pane when they change.
  useForms((s) => s.design[docId]);
  const [error, setError] = useState<MessageKey | null>(null);
  const [pending, setPending] = useState<{ of: PdfWidgetAnnoObject; flags: number } | null>(null);
  // A radio group's export values (its buttons), for its default.
  const group = useGroup(docId, w);
  const kind = kindOfType(w.field.type);
  if (!kind) return <p className="prop-empty">{t('forms.props.mixed')}</p>;
  const rows = rowsOf(kind);
  const disabled = !canDesign;
  const live = (): boolean => documentStore.getState().activeId === docId;
  // The new flags show at once; the widget's own replace them when its update lands.
  const flags = pending?.of === w ? pending.flags : w.field.flag;
  const flag = (f: FieldFlag) => (on: boolean) => {
    if (!live()) return;
    setPending({ of: w, flags: withFlag(flags, f, on) });
    void updateField(docId, w, (field) => ({ ...field, flag: withFlag(field.flag, f, on) }));
  };
  const options = 'options' in w.field ? w.field.options : [];
  const labels = options.map((o) => o.label);
  const tooltip = stagedTooltip(docId, w.field.name) ?? w.field.alternateName;
  const dv = stagedDefault(docId, w.field.name);
  const parts = fontParts(w.fontFamily);
  return (
    <form
      className="annot-props"
      data-testid="field-properties"
      aria-label={t('forms.props.title')}
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      <p className="prop-summary">{t('forms.props.title')}</p>
      {disabled ? <p className="prop-readonly">{t('forms.props.denied')}</p> : null}
      {error ? (
        <p className="prop-readonly" role="alert">
          {t(error)}
        </p>
      ) : null}
      <GridSection id="field" title={t('forms.props.section.field')}>
        <InfoField label={t('forms.props.type')} value={t(KIND_KEYS[kind])} />
        <TextProp
          label={kind === 'radio' ? t('forms.props.group') : t('forms.props.name')}
          value={w.field.name}
          disabled={disabled}
          onCommit={(name) => {
            if (!live()) return;
            void renameField(docId, w, name).then(setError);
          }}
        />
        <TextProp
          label={t('forms.props.tooltip')}
          value={tooltip === w.field.name ? '' : tooltip}
          disabled={disabled}
          onCommit={(text) => {
            if (live()) void setTooltip(docId, w, text);
          }}
        />
        <CheckField
          label={t('forms.props.required')}
          value={hasFlag(flags, 'required')}
          disabled={disabled}
          onCommit={flag('required')}
        />
        <CheckField
          label={t('forms.props.readOnly')}
          value={hasFlag(flags, 'readOnly')}
          disabled={disabled}
          onCommit={flag('readOnly')}
        />
        {rows.multiline ? (
          <CheckField
            label={t('forms.props.multiline')}
            value={hasFlag(flags, 'multiline')}
            disabled={disabled}
            onCommit={flag('multiline')}
          />
        ) : null}
        {rows.maxLength && w.field.type === PDF_FORM_FIELD_TYPE.TEXTFIELD ? (
          <NumberField
            label={t('forms.props.maxLength')}
            value={w.field.maxLen ?? 0}
            unit={t('forms.props.maxLengthHint')}
            min={0}
            max={MAX_LENGTH_LIMIT}
            disabled={disabled}
            onCommit={(n) => {
              if (live())
                void updateField(
                  docId,
                  w,
                  (field) => ({ ...field, maxLen: Math.round(n) }) as never,
                );
            }}
          />
        ) : null}
        {rows.multiSelect ? (
          <CheckField
            label={t('forms.props.multiSelect')}
            value={hasFlag(flags, 'multiSelect')}
            disabled={disabled}
            onCommit={flag('multiSelect')}
          />
        ) : null}
        {rows.defaultValue === 'text' ? (
          <TextProp
            label={t('forms.props.defaultValue')}
            value={dv ?? ''}
            disabled={disabled}
            onCommit={(v) => {
              if (live()) void setDefault(docId, w, v === '' ? null : v);
            }}
          />
        ) : null}
        {rows.defaultValue === 'toggle' && kind === 'checkbox' ? (
          <CheckField
            label={t('forms.props.defaultOn')}
            value={dv !== undefined && dv !== null}
            disabled={disabled}
            onCommit={(on) => {
              if (live()) void setDefault(docId, w, on ? (w.exportValue ?? CHECKBOX_ON) : null);
            }}
          />
        ) : null}
        {rows.defaultValue === 'toggle' && kind === 'radio' ? (
          <SelectField
            label={t('forms.props.defaultValue')}
            value={dv ?? ''}
            options={[
              { value: '', label: t('forms.props.defaultNone') },
              ...group.map((v) => ({ value: v, label: v })),
            ]}
            disabled={disabled}
            onCommit={(v) => {
              if (live()) void setDefault(docId, w, v === '' ? null : v);
            }}
          />
        ) : null}
        {rows.defaultValue === 'option' ? (
          <SelectField
            label={t('forms.props.defaultValue')}
            value={dv ?? ''}
            options={[
              { value: '', label: t('forms.props.defaultNone') },
              ...labels.map((v) => ({ value: v, label: v })),
            ]}
            disabled={disabled}
            onCommit={(v) => {
              if (live()) void setDefault(docId, w, v === '' ? null : v);
            }}
          />
        ) : null}
        {rows.exportValue ? (
          <>
            <InfoField label={t('forms.props.exportValue')} value={w.exportValue ?? ''} />
            <p className="prop-empty-hint">{t('forms.props.exportValueHint')}</p>
          </>
        ) : null}
      </GridSection>
      {rows.options ? (
        <GridSection id="options" title={t('forms.props.section.options')}>
          <TextProp
            label={t('forms.props.optionsList')}
            value={labels.join('\n')}
            multiline
            disabled={disabled}
            onCommit={(text) => {
              if (!live()) return;
              const next = parseOptions(text);
              const selected = options.filter((o) => o.isSelected).map((o) => o.label);
              void updateField(
                docId,
                w,
                (field) => ({ ...field, options: optionsWith(next, selected) }) as never,
              );
            }}
          />
        </GridSection>
      ) : null}
      <GridSection id="appearance" title={t('forms.props.section.appearance')}>
        {rows.font ? (
          <>
            <SelectField
              label={t('forms.props.font')}
              value={parts.family}
              options={FONT_FAMILIES.map((f) => ({ value: f, label: t(FONT_KEYS[f]) }))}
              disabled={disabled}
              onCommit={(f) => {
                if (live())
                  updateLook(docId, w, { fontFamily: fontFor(f, parts.bold, parts.italic) });
              }}
            />
            <NumberField
              label={t('forms.props.fontSize')}
              value={w.fontSize}
              unit={t('annotProps.pt')}
              min={4}
              max={144}
              digits={1}
              disabled={disabled}
              onCommit={(n) => {
                if (live()) updateLook(docId, w, { fontSize: n });
              }}
            />
            <ColorField
              label={t('forms.props.textColor')}
              value={w.fontColor}
              disabled={disabled}
              onCommit={(c) => {
                if (live()) updateLook(docId, w, { fontColor: c });
              }}
            />
          </>
        ) : null}
        <ColorField
          label={t('forms.props.borderColor')}
          value={w.strokeColor ?? NO_COLOR}
          allowNone
          disabled={disabled}
          onCommit={(c) => {
            if (live()) updateLook(docId, w, { strokeColor: c });
          }}
        />
        <ColorField
          label={t('forms.props.fillColor')}
          value={w.color ?? NO_COLOR}
          allowNone
          disabled={disabled}
          onCommit={(c) => {
            if (live()) updateLook(docId, w, { color: c });
          }}
        />
      </GridSection>
    </form>
  );
}

/** The export values of the radio group `w` belongs to (by its name). */
function useGroup(docId: string, w: PdfWidgetAnnoObject): string[] {
  const state = useAnnotationState(docId);
  if (!state || kindOfType(w.field.type) !== 'radio') return [];
  const out: string[] = [];
  for (const tr of Object.values(state.byUid)) {
    const o = tr.object;
    if (
      isWidget(o) &&
      o.field.name === w.field.name &&
      o.exportValue &&
      !out.includes(o.exportValue)
    )
      out.push(o.exportValue);
  }
  return out;
}

/**
 * The tab order panel: the current page's /Tabs and its fields in that order
 * (the order Tab follows when filling); a click selects the field.
 */
function TabOrderPanel({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const canDesign = useCanDesign();
  const page = useDocuments((s) => s.docs[docId]?.view.page ?? 0);
  const staged = useForms((s) => s.design[docId]?.tabs[page]);
  const state = useAnnotationState(docId);
  const [fileTabs, setFileTabs] = useState<TabOrder>(null);
  useEffect(() => {
    let live = true;
    formFactsOf(docId)
      .then((f) => {
        if (live) setFileTabs(f.tabs[page] ?? null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [docId, page]);
  const tabs = staged !== undefined ? staged : fileTabs;
  const widgets = (state?.pages[page] ?? [])
    .map((uid) => state?.byUid[uid]?.object)
    .filter((o): o is PdfWidgetAnnoObject => o !== undefined && isWidget(o));
  const ordered = tabOrder(widgets, tabs).flatMap((i) => (widgets[i] ? [widgets[i]] : []));
  return (
    <div className="annot-props" data-testid="tab-order-panel">
      <p className="prop-summary">{t('forms.tabOrder.title', { page: page + 1 })}</p>
      <p className="prop-empty-hint">{t('forms.tabOrder.hint')}</p>
      <div className="prop-grid">
        <SelectField
          label={t('forms.tabOrder.label')}
          value={tabOrderOf(tabs)}
          options={TAB_ORDERS.map((o) => ({ value: o, label: t(TAB_KEYS[o]) }))}
          disabled={!canDesign}
          onCommit={(o) => {
            void setTabOrder(docId, page, o === 'none' ? null : o);
          }}
        />
      </div>
      <h3 className="prop-section-title" id={`tab-order-${docId}`}>
        {t('forms.tabOrder.fields')}
      </h3>
      {ordered.length === 0 ? (
        <p className="prop-empty">{t('forms.tabOrder.noFields')}</p>
      ) : (
        <ol className="tab-order-list" aria-labelledby={`tab-order-${docId}`}>
          {ordered.map((w, i) => (
            <li key={w.id}>
              <button
                type="button"
                className="tab-order-item ui-focusable"
                onClick={() => {
                  annotationCapability()?.forDocument(docId).selectAnnotation(page, w.id);
                }}
              >
                {t('forms.tabOrder.item', { n: i + 1, name: w.field.name })}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
