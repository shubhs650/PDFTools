import { PdfAnnotationLineEnding as LE } from '@embedpdf/models';
import { useTranslation } from 'react-i18next';
import { documentStore, securityOf, useDocuments } from '../../../app/store/documentStore';
import { msg, type MessageKey } from '../../../i18n';
import { allows } from '../../../model/permissions';
import { useSelectedAnnotations } from '../selection';
import { annotationTypeKey } from '../annotationTypes';
import { ColorField, NumberField, SelectField, TextProp } from './fields';
import { canBeCloudy, MIXED, readProps, type LineStyle, type Prop } from './model';
import { applyProp } from './style';

const ENDINGS: readonly { value: LE; key: MessageKey }[] = [
  { value: LE.None, key: msg('annotProps.ending.none') },
  { value: LE.OpenArrow, key: msg('annotProps.ending.openArrow') },
  { value: LE.ClosedArrow, key: msg('annotProps.ending.closedArrow') },
  { value: LE.Circle, key: msg('annotProps.ending.circle') },
  { value: LE.Square, key: msg('annotProps.ending.square') },
  { value: LE.Diamond, key: msg('annotProps.ending.diamond') },
  { value: LE.Butt, key: msg('annotProps.ending.butt') },
  { value: LE.Slash, key: msg('annotProps.ending.slash') },
];

/**
 * The Properties pane's content for the selected annotations (M3-10, §7.1):
 * the properties they share, "Mixed" where they differ; every change is one
 * undo step for the whole selection. Read-only without the annotate
 * permission (rule 9).
 */
export function AnnotationProperties() {
  const { t } = useTranslation();
  const docId = useDocuments((s) => s.activeId);
  const canEdit = useDocuments((s) => {
    const meta = s.activeId ? s.docs[s.activeId]?.meta : undefined;
    return meta ? allows(securityOf(meta), 'annotate') : false;
  });
  const sel = useSelectedAnnotations(docId);
  if (!docId || sel.length === 0) return <p className="prop-empty">{t('annotProps.none')}</p>;
  const props = readProps(sel);
  const who = (a: string | undefined): string =>
    a === undefined || a === '' ? t('annotate.noAuthor') : a;
  const set = (p: Prop) => (v: string | number) => {
    if (documentStore.getState().activeId === docId) applyProp(docId, sel, p, v);
  };
  const first = sel[0];
  const authors = new Set(sel.map((a) => a.author ?? ''));
  const styles: { value: LineStyle; label: string }[] = [
    { value: 'solid', label: t('annotProps.style.solid') },
    { value: 'dashed', label: t('annotProps.style.dashed') },
    ...(sel.every(canBeCloudy)
      ? [{ value: 'cloudy' as const, label: t('annotProps.style.cloudy') }]
      : []),
  ];
  const endings = ENDINGS.map((e) => ({ value: e.value, label: t(e.key) }));
  return (
    <form
      className="annot-props"
      data-testid="annotation-properties"
      aria-label={t('annotProps.label')}
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      <p className="prop-summary">
        {sel.length === 1 && first
          ? t('annotProps.one', {
              type: t(annotationTypeKey(first)),
              author: who(first.author),
            })
          : t('annotProps.many', { count: sel.length })}
      </p>
      {!canEdit ? <p className="prop-readonly">{t('annotProps.readOnly')}</p> : null}
      <fieldset disabled={!canEdit} className="prop-fields">
        {'stroke' in props ? (
          <ColorField
            label={t('annotProps.color')}
            value={props.stroke ?? MIXED}
            onCommit={set('stroke')}
          />
        ) : null}
        {'fill' in props ? (
          <ColorField
            label={t('annotProps.fill')}
            value={props.fill ?? MIXED}
            allowNone
            onCommit={set('fill')}
          />
        ) : null}
        {'fontColor' in props ? (
          <ColorField
            label={t('annotProps.fontColor')}
            value={props.fontColor ?? MIXED}
            onCommit={set('fontColor')}
          />
        ) : null}
        {'opacity' in props ? (
          <NumberField
            label={t('annotProps.opacity')}
            value={typeof props.opacity === 'number' ? props.opacity * 100 : MIXED}
            unit="%"
            min={0}
            max={100}
            onCommit={(v) => {
              set('opacity')(v / 100);
            }}
          />
        ) : null}
        {'width' in props ? (
          <NumberField
            label={t('annotProps.width')}
            value={props.width ?? MIXED}
            unit={t('annotProps.pt')}
            min={0}
            max={72}
            digits={1}
            onCommit={set('width')}
          />
        ) : null}
        {'fontSize' in props ? (
          <NumberField
            label={t('annotProps.fontSize')}
            value={props.fontSize ?? MIXED}
            unit={t('annotProps.pt')}
            min={4}
            max={144}
            digits={1}
            onCommit={set('fontSize')}
          />
        ) : null}
        {'style' in props ? (
          <SelectField
            label={t('annotProps.lineStyle')}
            value={props.style ?? MIXED}
            options={styles}
            onCommit={set('style')}
          />
        ) : null}
        {'lineStart' in props ? (
          <SelectField
            label={t('annotProps.lineStart')}
            value={props.lineStart ?? MIXED}
            options={endings}
            onCommit={set('lineStart')}
          />
        ) : null}
        {'lineEnd' in props ? (
          <SelectField
            label={t('annotProps.lineEnd')}
            value={props.lineEnd ?? MIXED}
            options={endings}
            onCommit={set('lineEnd')}
          />
        ) : null}
        {'subject' in props ? (
          <TextProp
            label={t('annotProps.subject')}
            value={props.subject ?? MIXED}
            onCommit={set('subject')}
          />
        ) : null}
        {'contents' in props ? (
          <TextProp
            label={t('annotProps.contents')}
            value={props.contents ?? MIXED}
            multiline
            onCommit={set('contents')}
          />
        ) : null}
      </fieldset>
      <p className="prop-author">
        {t('annotProps.author')}:{' '}
        {authors.size > 1
          ? t('annotProps.mixed')
          : [...authors][0]
            ? [...authors][0]
            : t('annotate.noAuthor')}
      </p>
    </form>
  );
}
