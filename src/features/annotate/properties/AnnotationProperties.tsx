import { PdfAnnotationLineEnding as LE } from '@embedpdf/models';
import { useTranslation } from 'react-i18next';
import { Fragment, useId, useState, type ReactNode } from 'react';
import { useApp } from '../../../app/store/appStore';
import { documentStore, securityOf, useDocuments } from '../../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../../i18n';
import { allows } from '../../../model/permissions';
import { Button } from '../../../ui/components';
import { useSelectedAnnotations } from '../selection';
import { annotationTypeKey } from '../annotationTypes';
import { objectsOf, useAnnotationMap } from '../comments/commentsStore';
import { reviewHistory, type HistoryEntry } from '../comments/thread';
import { STATUS_KEYS } from '../comments/statusLabels';
import { isStyleTool, type StyleTool } from '../tools/toolDefaults';
import { resetToolDefaults, useToolDefaults } from '../tools/toolDefaultsStore';
import { CheckField, ColorField, InfoField, NumberField, SelectField, TextProp } from './fields';
import { marksOf, setFlag, setMarked } from './flagActions';
import { GridSection } from './GridSection';
import {
  canBeCloudy,
  FONT_FAMILIES,
  gateOf,
  MIXED,
  readFlag,
  readProps,
  SECTION_PROPS,
  type Flag,
  type Gate,
  type LineStyle,
  type Plain,
  type Prop,
  type Value,
} from './model';
import { applyProp } from './style';
import { isDesignTool } from '../../forms/fieldModel';
import { FieldDesignProperties } from '../../forms/FieldProperties';
import { setToolProp, TOOL_NAME_KEYS, toolPropsOf, toolSample } from './toolProperties';
import type { PdfAnnotationObject } from '@embedpdf/models';

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

/** PDF blend modes (PDF 32000-1 §11.3.5), in PdfBlendMode order. */
const BLENDS: readonly MessageKey[] = [
  msg('annotProps.blend.normal'),
  msg('annotProps.blend.multiply'),
  msg('annotProps.blend.screen'),
  msg('annotProps.blend.overlay'),
  msg('annotProps.blend.darken'),
  msg('annotProps.blend.lighten'),
  msg('annotProps.blend.colorDodge'),
  msg('annotProps.blend.colorBurn'),
  msg('annotProps.blend.hardLight'),
  msg('annotProps.blend.softLight'),
  msg('annotProps.blend.difference'),
  msg('annotProps.blend.exclusion'),
  msg('annotProps.blend.hue'),
  msg('annotProps.blend.saturation'),
  msg('annotProps.blend.color'),
  msg('annotProps.blend.luminosity'),
];

const FONT_KEYS: Record<(typeof FONT_FAMILIES)[number], MessageKey> = {
  helvetica: msg('annotProps.font.helvetica'),
  times: msg('annotProps.font.times'),
  courier: msg('annotProps.font.courier'),
};
const ALIGN_KEYS: readonly MessageKey[] = [
  msg('annotProps.align.left'),
  msg('annotProps.align.center'),
  msg('annotProps.align.right'),
];
const VALIGN_KEYS: readonly MessageKey[] = [
  msg('annotProps.valign.top'),
  msg('annotProps.valign.middle'),
  msg('annotProps.valign.bottom'),
];

/**
 * The Properties pane (M3-10, M6-06 property grid, ADR-021 D-37 / D-38 f):
 * with a comment tool on, that tool's defaults; otherwise the selected
 * comments — General (subject, text, author, name, dates, flags, review mark
 * and history), Style and Text — "Mixed" where they differ. Every change to
 * a selection is one undo step; read-only without the annotate permission
 * (rule 9); a Locked or Read only comment changes only Read only, Locked
 * and its mark.
 */
export function AnnotationProperties() {
  const docId = useDocuments((s) => s.activeId);
  const tool = useApp((s) => s.tool);
  const sel = useSelectedAnnotations(docId);
  // Form fields (M6-14): Field Properties, or the page's tab order.
  if (docId && isDesignTool(tool)) return <FieldDesignProperties docId={docId} sel={sel} />;
  if (docId && isStyleTool(tool)) return <ToolProperties tool={tool} />;
  if (!docId || sel.length === 0) return <Empty />;
  return <SelectionProperties docId={docId} sel={sel} />;
}

function Empty() {
  const { t } = useTranslation();
  return <p className="prop-empty">{t('annotProps.none')}</p>;
}

function useCanEdit(): boolean {
  return useDocuments((s) => {
    const meta = s.activeId ? s.docs[s.activeId]?.meta : undefined;
    return meta ? allows(securityOf(meta), 'annotate') : false;
  });
}

/** The Style and Text rows for `props` (a selection's or a tool's). */
export function StyleAndText({
  props,
  cloudy,
  disabled,
  set,
}: {
  props: Partial<Record<Prop, Value>>;
  cloudy: boolean;
  disabled: boolean;
  set: (p: Prop) => (v: Plain) => void;
}) {
  const { t } = useTranslation();
  const styles: { value: LineStyle; label: string }[] = [
    { value: 'solid', label: t('annotProps.style.solid') },
    { value: 'dashed', label: t('annotProps.style.dashed') },
    ...(cloudy ? [{ value: 'cloudy' as const, label: t('annotProps.style.cloudy') }] : []),
  ];
  const endings = ENDINGS.map((e) => ({ value: e.value, label: t(e.key) }));
  const v = (p: Prop): Value => props[p] ?? MIXED;
  const rows: Record<Prop, () => ReactNode> = {
    fill: () => (
      <ColorField
        label={t('annotProps.fill')}
        value={v('fill')}
        allowNone
        disabled={disabled}
        onCommit={set('fill')}
      />
    ),
    stroke: () => (
      <ColorField
        label={t('annotProps.color')}
        value={v('stroke')}
        disabled={disabled}
        onCommit={set('stroke')}
      />
    ),
    border: () => (
      <ColorField
        label={t('annotProps.borderColor')}
        value={v('border')}
        disabled={disabled}
        onCommit={set('border')}
      />
    ),
    style: () => (
      <SelectField
        label={t('annotProps.lineStyle')}
        value={v('style')}
        options={styles}
        disabled={disabled}
        onCommit={set('style')}
      />
    ),
    width: () => (
      <NumberField
        label={t('annotProps.width')}
        value={v('width')}
        unit={t('annotProps.pt')}
        min={0}
        max={72}
        digits={1}
        disabled={disabled}
        onCommit={set('width')}
      />
    ),
    opacity: () => {
      const o = v('opacity');
      return (
        <NumberField
          label={t('annotProps.opacity')}
          value={typeof o === 'number' ? o * 100 : MIXED}
          unit="%"
          min={0}
          max={100}
          disabled={disabled}
          onCommit={(n) => {
            set('opacity')(n / 100);
          }}
        />
      );
    },
    blendMode: () => (
      <SelectField
        label={t('annotProps.blendMode')}
        value={v('blendMode')}
        options={BLENDS.map((k, i) => ({ value: i, label: t(k) }))}
        disabled={disabled}
        onCommit={set('blendMode')}
      />
    ),
    rotation: () => (
      <NumberField
        label={t('annotProps.rotation')}
        value={v('rotation')}
        unit="°"
        min={0}
        max={359}
        disabled={disabled}
        onCommit={set('rotation')}
      />
    ),
    lineStart: () => (
      <SelectField
        label={t('annotProps.lineStart')}
        value={v('lineStart')}
        options={endings}
        disabled={disabled}
        onCommit={set('lineStart')}
      />
    ),
    lineEnd: () => (
      <SelectField
        label={t('annotProps.lineEnd')}
        value={v('lineEnd')}
        options={endings}
        disabled={disabled}
        onCommit={set('lineEnd')}
      />
    ),
    fontFamily: () => (
      <SelectField
        label={t('annotProps.font.label')}
        value={v('fontFamily')}
        options={FONT_FAMILIES.map((f) => ({ value: f, label: t(FONT_KEYS[f]) }))}
        disabled={disabled}
        onCommit={set('fontFamily')}
      />
    ),
    bold: () => (
      <CheckField
        label={t('annotProps.bold')}
        value={v('bold')}
        disabled={disabled}
        onCommit={set('bold')}
      />
    ),
    italic: () => (
      <CheckField
        label={t('annotProps.italic')}
        value={v('italic')}
        disabled={disabled}
        onCommit={set('italic')}
      />
    ),
    fontSize: () => (
      <NumberField
        label={t('annotProps.fontSize')}
        value={v('fontSize')}
        unit={t('annotProps.pt')}
        min={4}
        max={144}
        digits={1}
        disabled={disabled}
        onCommit={set('fontSize')}
      />
    ),
    fontColor: () => (
      <ColorField
        label={t('annotProps.fontColor')}
        value={v('fontColor')}
        disabled={disabled}
        onCommit={set('fontColor')}
      />
    ),
    textAlign: () => (
      <SelectField
        label={t('annotProps.textAlign')}
        value={v('textAlign')}
        options={ALIGN_KEYS.map((k, i) => ({ value: i, label: t(k) }))}
        disabled={disabled}
        onCommit={set('textAlign')}
      />
    ),
    verticalAlign: () => (
      <SelectField
        label={t('annotProps.verticalAlign')}
        value={v('verticalAlign')}
        options={VALIGN_KEYS.map((k, i) => ({ value: i, label: t(k) }))}
        disabled={disabled}
        onCommit={set('verticalAlign')}
      />
    ),
    subject: () => null,
    contents: () => null,
  };
  const section = (id: 'style' | 'text', title: MessageKey) => {
    const shown = SECTION_PROPS[id].filter((p) => p in props);
    if (shown.length === 0) return null;
    return (
      <GridSection id={id} title={t(title)}>
        {shown.map((p) => (
          <Fragment key={p}>{rows[p]()}</Fragment>
        ))}
      </GridSection>
    );
  };
  return (
    <>
      {section('style', msg('annotProps.section.style'))}
      {section('text', msg('annotProps.section.text'))}
    </>
  );
}

function SelectionProperties({ docId, sel }: { docId: string; sel: PdfAnnotationObject[] }) {
  const { t } = useTranslation();
  const canEdit = useCanEdit();
  const byUid = useAnnotationMap(docId);
  const props = readProps(sel);
  const gate: Gate = gateOf(sel);
  const first = sel[0];
  const one = sel.length === 1 ? first : undefined;
  const who = (a: string | undefined): string =>
    a === undefined || a === '' ? t('annotate.noAuthor') : a;
  const live = (): boolean => documentStore.getState().activeId === docId;
  const set = (p: Prop) => (v: Plain) => {
    if (live()) applyProp(docId, sel, p, v);
  };
  const flag = (f: Flag) => (on: boolean) => {
    if (live()) setFlag(docId, sel, f, on);
  };
  const locked = !canEdit || gate !== 'open';
  const authors = new Set(sel.map((a) => a.author ?? ''));
  const author = authors.size > 1 ? t('annotProps.mixed') : who([...authors][0]);
  const date = (d: Date | undefined): string => (d ? format.dateTime(d) : '');
  const all = byUid ? objectsOf(byUid) : [];
  const marks = marksOf(docId, sel);
  const marked: Value = marks.every(Boolean) ? true : marks.some(Boolean) ? MIXED : false;
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
        {one
          ? t('annotProps.one', { type: t(annotationTypeKey(one)), author: who(one.author) })
          : t('annotProps.many', { count: sel.length })}
      </p>
      {!canEdit ? <p className="prop-readonly">{t('annotProps.readOnly')}</p> : null}
      {canEdit && gate !== 'open' ? (
        <p className="prop-readonly" role="status">
          {t(gate === 'locked' ? msg('annotProps.noteLocked') : msg('annotProps.noteReadOnly'))}
        </p>
      ) : null}
      <GridSection id="general" title={t('annotProps.section.general')}>
        {'subject' in props ? (
          <TextProp
            label={t('annotProps.subject')}
            value={props.subject ?? MIXED}
            disabled={locked}
            onCommit={set('subject')}
          />
        ) : null}
        {'contents' in props ? (
          <TextProp
            label={t('annotProps.contents')}
            value={props.contents ?? MIXED}
            multiline
            disabled={locked}
            onCommit={set('contents')}
          />
        ) : null}
        <InfoField label={t('annotProps.author')} value={author} />
        {one ? <InfoField label={t('annotProps.name')} value={one.id} /> : null}
        {one ? <InfoField label={t('annotProps.created')} value={date(one.created)} /> : null}
        {one ? <InfoField label={t('annotProps.modified')} value={date(one.modified)} /> : null}
        <CheckField
          label={t('annotProps.flag.readOnly')}
          value={readFlag(sel, 'readOnly')}
          disabled={!canEdit}
          onCommit={flag('readOnly')}
        />
        <CheckField
          label={t('annotProps.flag.print')}
          value={readFlag(sel, 'print')}
          disabled={locked}
          onCommit={flag('print')}
        />
        <CheckField
          label={t('annotProps.flag.locked')}
          value={readFlag(sel, 'locked')}
          disabled={!canEdit}
          onCommit={flag('locked')}
        />
        <CheckField
          label={t('annotProps.flag.marked')}
          value={marked}
          disabled={!canEdit}
          onCommit={(on) => {
            if (live()) void setMarked(docId, sel, on);
          }}
        />
        {one ? <History entries={reviewHistory(all, one.id)} /> : null}
      </GridSection>
      <StyleAndText props={props} cloudy={sel.every(canBeCloudy)} disabled={locked} set={set} />
    </form>
  );
}

/** Review history (M6-06): a disclosure listing the statuses and marks set on the comment. */
function History({ entries }: { entries: HistoryEntry[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const id = useId();
  const label = (e: HistoryEntry): string => t(STATUS_KEYS[e.state]);
  return (
    <>
      <div className="prop-field">
        <span className="prop-label" id={`${id}-label`}>
          {t('annotProps.history')}
        </span>
        <Button
          variant="subtle"
          size="small"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-describedby={`${id}-label`}
          disabled={entries.length === 0}
          onClick={() => {
            setOpen(!open);
          }}
          label={
            entries.length === 0
              ? t('annotProps.historyNone')
              : open
                ? t('annotProps.historyHide')
                : t('annotProps.historyShow', { count: entries.length })
          }
        />
      </div>
      {open && entries.length > 0 ? (
        <ul id={`${id}-list`} className="prop-history" aria-labelledby={`${id}-label`}>
          {entries.map((e) => (
            <li key={e.id}>
              {t('annotProps.historyEntry', {
                state: label(e),
                author: e.author === '' ? t('annotate.noAuthor') : e.author,
                date: e.date ? format.dateTime(e.date) : '',
              })}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** "‹Tool› Tool Properties": the active tool's defaults (M6-03 store), changed in place. */
function ToolProperties({ tool }: { tool: StyleTool }) {
  const { t } = useTranslation();
  // Re-read whenever the tool's defaults change.
  useToolDefaults((s) => s.overrides[tool]);
  const canEdit = useCanEdit();
  const sample = toolSample(tool);
  if (!sample) return <Empty />;
  const shown = new Set(toolPropsOf(sample));
  const props = Object.fromEntries(
    Object.entries(readProps([sample])).filter(([p]) => shown.has(p as Prop)),
  ) as Partial<Record<Prop, Value>>;
  const name = t(TOOL_NAME_KEYS[tool]);
  return (
    <form
      className="annot-props"
      data-testid="tool-properties"
      aria-label={t('annotProps.toolTitle', { tool: name })}
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      <p className="prop-summary">{t('annotProps.toolTitle', { tool: name })}</p>
      <p className="prop-empty-hint">{t('annotProps.toolHint')}</p>
      <StyleAndText
        props={props}
        cloudy={canBeCloudy(sample)}
        disabled={!canEdit}
        set={(p) => (v) => {
          void setToolProp(tool, p, v);
        }}
      />
      <div className="prop-actions">
        <Button
          size="small"
          disabled={!canEdit}
          onClick={() => {
            void resetToolDefaults(tool);
          }}
          label={t('annotProps.resetTool')}
        />
      </div>
    </form>
  );
}
