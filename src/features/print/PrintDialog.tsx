import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useTranslation } from 'react-i18next';
import { securityOf, useDocuments } from '../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../i18n';
import { allows } from '../../model/permissions';
import { Button, Dialog, ProgressBar, TextField } from '../../ui/components';
import {
  DPI,
  PERCENT_MAX,
  PERCENT_MIN,
  isPercentValid,
  type Markups,
  type Method,
  type Quality,
  type RangeKind,
  type ScaleMode,
} from './options';
import { targetsOf } from './printJob';
import {
  cancelPrint,
  closePrint,
  setOptions,
  startPrint,
  usePrint,
  viewerBlockFor,
} from './printStore';

const RANGES: [RangeKind, MessageKey][] = [
  ['all', msg('print.range.all')],
  ['current', msg('print.range.current')],
  ['view', msg('print.range.view')],
  ['area', msg('print.range.area')],
  ['custom', msg('print.range.custom')],
];
const SCALES: [ScaleMode, MessageKey][] = [
  ['fit', msg('print.scale.fit')],
  ['actual', msg('print.scale.actual')],
  ['custom', msg('print.scale.custom')],
];
const MARKUPS: [Markups, MessageKey][] = [
  ['on', msg('print.markups.on')],
  ['off', msg('print.markups.off')],
  ['only', msg('print.markups.only')],
];
const METHODS: [Method, MessageKey][] = [
  ['raster', msg('print.method.raster')],
  ['viewer', msg('print.method.viewer')],
];
const VIEWER_BLOCKED: Record<string, MessageKey> = {
  noViewer: msg('print.method.blocked.noViewer'),
  range: msg('print.method.blocked.range'),
  markups: msg('print.method.blocked.markups'),
  quality: msg('print.method.blocked.quality'),
};
const QUALITIES: Quality[] = ['standard', 'high'];
const QUALITY_LABEL: Record<Quality, MessageKey> = {
  standard: msg('print.quality.standard'),
  high: msg('print.quality.high'),
};
const NAME = {
  range: 'print-range',
  scale: 'print-scale',
  markups: 'print-markups',
  quality: 'print-quality',
  method: 'print-method',
};
const ERRORS: Record<string, MessageKey> = {
  empty: msg('print.error.empty'),
  syntax: msg('print.error.syntax'),
  outOfRange: msg('print.error.outOfRange'),
  noView: msg('print.error.noView'),
  noSelection: msg('print.error.noSelection'),
  noDocument: msg('print.error.noDocument'),
};

/**
 * File → Print (D-25, §7.13, M2-15): range, scale, markups and quality, then
 * the pages render in the Work worker with progress and Cancel, and print
 * from a hidden frame. Orientation follows each page.
 */
export function PrintDialog() {
  const { t } = useTranslation();
  const docId = usePrint((s) => s.docId);
  const o = usePrint((s) => s.options);
  const running = usePrint((s) => s.running);
  const failed = usePrint((s) => s.error === 'failed');
  const doc = useDocuments((s) => (docId ? s.docs[docId] : undefined));
  if (!docId || !doc) return null;
  const highAllowed = allows(securityOf(doc.meta), 'printHighQuality');
  const targets = targetsOf(docId, o);
  const percentOk = o.scale !== 'custom' || isPercentValid(o.percent);
  const rangeError = targets.ok ? null : t(ERRORS[targets.error] ?? msg('print.error.syntax'));
  const pages = targets.ok ? targets.targets.length : 0;
  const busy = running !== null;
  const blocked = viewerBlockFor(docId, o);
  const method: Method = blocked ? 'raster' : o.method;
  const viewer = method === 'viewer';

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closePrint();
      }}
      title={t('print.title')}
      description={t('print.description', { name: doc.meta.name })}
      closeIcon={<Dismiss20Regular />}
      footer={
        busy ? (
          <Button label={t('print.cancel')} onClick={cancelPrint} />
        ) : (
          <>
            <Button
              label={t('print.print')}
              variant="primary"
              disabled={!targets.ok || (!viewer && !percentOk)}
              onClick={() => {
                void startPrint();
              }}
            />
            <Button label={t('print.close')} onClick={closePrint} />
          </>
        )
      }
    >
      <form
        className="print-dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (targets.ok && (viewer || percentOk)) void startPrint();
        }}
      >
        <fieldset>
          <legend>{t('print.range.legend')}</legend>
          {RANGES.map(([k, label]) => (
            <Choice
              key={k}
              name={NAME.range}
              value={k}
              current={o.range}
              label={t(label)}
              disabled={busy}
              onPick={(range) => {
                setOptions({ range });
              }}
            />
          ))}
          {o.range === 'custom' ? (
            <TextField
              label={t('print.range.customLabel')}
              placeholder={t('print.range.customHint')}
              value={o.custom}
              disabled={busy}
              error={rangeError ?? undefined}
              onChange={(e) => {
                setOptions({ custom: e.target.value });
              }}
            />
          ) : rangeError ? (
            <p className="print-error" role="alert">
              {rangeError}
            </p>
          ) : null}
          <p className="print-note" data-testid="print-count">
            {t('print.pageCount', { count: pages, n: format.number(pages, 0) })}
          </p>
        </fieldset>

        <fieldset>
          <legend>{t('print.scale.legend')}</legend>
          {SCALES.map(([k, label]) => (
            <Choice
              key={k}
              name={NAME.scale}
              value={k}
              current={o.scale}
              label={t(label)}
              disabled={busy || viewer}
              onPick={(scale) => {
                setOptions({ scale });
              }}
            />
          ))}
          {o.scale === 'custom' ? (
            <TextField
              label={t('print.scale.percent')}
              type="number"
              min={PERCENT_MIN}
              max={PERCENT_MAX}
              value={Number.isFinite(o.percent) ? String(o.percent) : ''}
              disabled={busy || viewer}
              error={
                percentOk
                  ? undefined
                  : t('print.error.percent', {
                      min: format.number(PERCENT_MIN, 0),
                      max: format.number(PERCENT_MAX, 0),
                    })
              }
              onChange={(e) => {
                setOptions({ percent: e.target.valueAsNumber });
              }}
            />
          ) : null}
        </fieldset>

        <fieldset>
          <legend>{t('print.markups.legend')}</legend>
          {MARKUPS.map(([k, label]) => (
            <Choice
              key={k}
              name={NAME.markups}
              value={k}
              current={o.markups}
              label={t(label)}
              disabled={busy}
              onPick={(markups) => {
                setOptions({ markups });
              }}
            />
          ))}
        </fieldset>

        <fieldset>
          <legend>{t('print.quality.legend')}</legend>
          {QUALITIES.map((k) => (
            <Choice
              key={k}
              name={NAME.quality}
              value={k}
              current={highAllowed ? o.quality : 'standard'}
              label={t(QUALITY_LABEL[k], { dpi: format.number(DPI[k], 0) })}
              disabled={busy || viewer || (k === 'high' && !highAllowed)}
              onPick={(quality) => {
                setOptions({ quality });
              }}
            />
          ))}
          {highAllowed ? null : <p className="print-note">{t('print.quality.denied')}</p>}
          <p className="print-note">{t('print.orientation')}</p>
        </fieldset>

        <fieldset>
          <legend>{t('print.method.legend')}</legend>
          {METHODS.map(([k, label]) => (
            <Choice
              key={k}
              name={NAME.method}
              value={k}
              current={method}
              label={t(label)}
              disabled={busy || (k === 'viewer' && blocked !== null)}
              onPick={(m) => {
                setOptions({ method: m });
              }}
            />
          ))}
          <p className="print-note">
            {blocked
              ? t(VIEWER_BLOCKED[blocked] ?? msg('print.method.blocked.range'))
              : t(viewer ? msg('print.method.viewerNote') : msg('print.method.rasterNote'))}
          </p>
        </fieldset>

        {running ? (
          <>
            <ProgressBar
              label={t('print.progressName')}
              value={running.total > 0 ? running.done / running.total : null}
            />
            <p className="print-note" role="status">
              {t('print.progress', {
                done: format.number(running.done, 0),
                total: format.number(running.total, 0),
              })}
            </p>
          </>
        ) : null}
        {failed ? (
          <p className="print-error" role="alert">
            {t('print.failed')}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

function Choice<K extends string>({
  name,
  value,
  current,
  label,
  disabled,
  onPick,
}: {
  name: string;
  value: K;
  current: K;
  label: string;
  disabled: boolean;
  onPick: (v: K) => void;
}) {
  return (
    <label className="print-option">
      <input
        type="radio"
        name={name}
        value={value}
        checked={current === value}
        disabled={disabled}
        onChange={() => {
          onPick(value);
        }}
      />
      {label}
    </label>
  );
}
