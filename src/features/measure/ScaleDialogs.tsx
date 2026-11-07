import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { documentStore, useDocuments } from '../../app/store/documentStore';
import { format, msg } from '../../i18n';
import { parseLocaleNumber } from '../../i18n/format';
import {
  calibrate,
  FT_IN_STEPS,
  MM_PER_POINT,
  parseFtIn,
  ratioLabel,
  type Unit,
} from '../../model/scale';
import { Button, Dialog, TextField } from '../../ui/components';
import { parseRange } from '../print/options';
import { startPicking } from './calibrate';
import { UNIT_KEYS, type UnitChoice } from './units';
import { toScale, useScaleFields, type Fields } from './scaleFields';
import { applyScale, closeScaleDialog, scaleOf, scaleStore, useScales } from './scaleStore';
import { dialogHelp } from '../help/openHelp';

const UNITS: readonly UnitChoice[] = ['mm', 'cm', 'm', 'in', 'ft', 'ftin'];
const PRECISIONS = [0, 1, 2, 3, 4] as const;

const ERROR_KEYS = {
  ratio: msg('scale.error.ratio'),
  points: msg('scale.error.points'),
  length: msg('scale.error.length'),
  save: msg('scale.error.save'),
} as const;

export function UnitFields({ f }: { f: Fields }) {
  const { t } = useTranslation();
  const ids = useId();
  return (
    <>
      <div className="ui-field">
        <label className="ui-field-label" htmlFor={`${ids}-unit`}>
          {t('scale.unit')}
        </label>
        <select
          id={`${ids}-unit`}
          className="ui-field-input"
          value={f.unit}
          onChange={(e) => {
            f.setUnit(e.currentTarget.value as UnitChoice);
          }}
        >
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {t(UNIT_KEYS[u])}
            </option>
          ))}
        </select>
      </div>
      {f.unit === 'ftin' ? (
        <div className="ui-field">
          <label className="ui-field-label" htmlFor={`${ids}-ftin`}>
            {t('scale.fraction')}
          </label>
          <select
            id={`${ids}-ftin`}
            className="ui-field-input"
            value={f.ftIn}
            onChange={(e) => {
              f.setFtIn(Number(e.currentTarget.value));
            }}
          >
            {FT_IN_STEPS.map((d) => (
              <option key={d} value={d}>
                {`1/${String(d)}"`}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="ui-field">
          <label className="ui-field-label" htmlFor={`${ids}-precision`}>
            {t('scale.precision')}
          </label>
          <select
            id={`${ids}-precision`}
            className="ui-field-input"
            value={f.precision}
            onChange={(e) => {
              f.setPrecision(Number(e.currentTarget.value));
            }}
          >
            {PRECISIONS.map((p) => (
              <option key={p} value={p}>
                {format.number(1.23456789, p)}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}

function PagesFields({ f, rangeError }: { f: Fields; rangeError: boolean }) {
  const { t } = useTranslation();
  const ids = useId();
  const opt = (
    v: 'page' | 'all' | 'range',
    key: 'scale.where.page' | 'scale.where.all' | 'scale.where.range',
  ) => (
    <label className="scale-radio">
      <input
        type="radio"
        name={`${ids}-where`}
        checked={f.where === v}
        onChange={() => {
          f.setWhere(v);
        }}
      />
      {t(key)}
    </label>
  );
  return (
    <fieldset className="scale-where">
      <legend className="ui-field-label">{t('scale.applyTo')}</legend>
      {opt('page', msg('scale.where.page'))}
      {opt('all', msg('scale.where.all'))}
      {opt('range', msg('scale.where.range'))}
      {f.where === 'range' ? (
        <TextField
          label={t('scale.pages')}
          value={f.range}
          error={rangeError ? t('scale.error.range') : undefined}
          onChange={(e) => {
            f.setRange(e.currentTarget.value);
          }}
        />
      ) : null}
    </fieldset>
  );
}

/** The pages chosen, or null when the typed range is wrong. */
function pagesOf(f: Fields, docId: string): number[] | null {
  const d = documentStore.getState().docs[docId];
  if (!d) return null;
  if (f.where === 'page') return [d.view.page];
  const count = d.meta.pageCount;
  if (f.where === 'all') return Array.from({ length: count }, (_, i) => i);
  const r = parseRange(f.range, count);
  return r.ok ? [...new Set(r.pages)] : null;
}

/** Measure → Set Scale (M3-15): paper : real, units and precision, for pages. */
export function SetScaleDialog() {
  const open = useScales((s) => s.dialog === 'setScale');
  const docId = useDocuments((s) => s.activeId);
  if (!open || !docId) return null;
  return <SetScaleForm docId={docId} />;
}

function SetScaleForm({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const ids = useId();
  const defaults = useScales((s) => s.defaults);
  // The page's scale when the dialog opens (read once: a derived object).
  const [current] = useState(() =>
    scaleOf(scaleStore.getState(), docId, documentStore.getState().docs[docId]?.view.page ?? 0),
  );
  const f = useScaleFields(
    current
      ? {
          unit: current.unit,
          precision: current.precision,
          ...(current.ftIn ? { ftIn: current.ftIn } : {}),
        }
      : defaults,
  );
  const [paper, setPaper] = useState(current ? format.number(current.paper, 4) : '1');
  const [real, setReal] = useState(current ? format.number(current.real, 4) : '100');
  const [error, setError] = useState<'ratio' | 'range' | 'save' | null>(null);
  const p = parseLocaleNumber(paper, format.locale);
  const r = parseLocaleNumber(real, format.locale);
  const valid = p !== null && r !== null && p > 0 && r > 0;
  const submit = (): void => {
    if (!valid) {
      setError('ratio');
      return;
    }
    const pages = pagesOf(f, docId);
    if (!pages?.length) {
      setError('range');
      return;
    }
    void applyScale(docId, pages, toScale(p, r, f.unit, f.precision, f.ftIn)).then((ok) => {
      if (ok) closeScaleDialog();
      else setError('save');
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closeScaleDialog();
      }}
      title={t('scale.setTitle')}
      description={t('scale.setDescription')}
      closeIcon={<Dismiss20Regular />}
      help={dialogHelp('measure-scale')}
      footer={
        <>
          <Button label={t('scale.apply')} variant="primary" type="submit" form={`${ids}-form`} />
          <Button label={t('annotate.caret.cancel')} onClick={closeScaleDialog} />
        </>
      }
    >
      <form
        id={`${ids}-form`}
        className="scale-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="scale-ratio">
          <TextField
            label={t('scale.paper')}
            inputMode="decimal"
            value={paper}
            onChange={(e) => {
              setPaper(e.currentTarget.value);
              setError(null);
            }}
          />
          <span aria-hidden="true">:</span>
          <TextField
            label={t('scale.real')}
            inputMode="decimal"
            value={real}
            onChange={(e) => {
              setReal(e.currentTarget.value);
              setError(null);
            }}
          />
        </div>
        <UnitFields f={f} />
        <PagesFields f={f} rangeError={error === 'range'} />
        <p className="scale-preview" role="status">
          {valid
            ? t('scale.preview', {
                ratio: ratioLabel({ paper: p, real: r, unit: 'mm', precision: 0 }, format),
              })
            : ''}
        </p>
        {error === 'ratio' || error === 'save' ? (
          <p className="ui-field-error" role="alert">
            {t(ERROR_KEYS[error])}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

/** Measure → Calibrate (M3-15): two points on the page and their real length. */
export function CalibrateDialog() {
  const open = useScales((s) => s.dialog === 'calibrate');
  const docId = useDocuments((s) => s.activeId);
  if (!open || !docId) return null;
  return <CalibrateForm docId={docId} />;
}

function CalibrateForm({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const ids = useId();
  const defaults = useScales((s) => s.defaults);
  const picked = useScales((s) => s.picked);
  const f = useScaleFields(defaults);
  const n = (v: number | undefined) => (v === undefined ? '' : format.number(v, 2));
  const [pts, setPts] = useState([n(picked?.a.x), n(picked?.a.y), n(picked?.b.x), n(picked?.b.y)]);
  const [length, setLength] = useState('');
  const [error, setError] = useState<'points' | 'length' | 'range' | 'save' | null>(null);
  const coords = pts.map((s) => parseLocaleNumber(s, format.locale));
  const [ax, ay, bx, by] = coords;
  const havePts = coords.every((c) => c !== null);
  const paperPt = havePts ? Math.hypot((bx ?? 0) - (ax ?? 0), (by ?? 0) - (ay ?? 0)) : 0;
  const realLen = f.unit === 'ftin' ? parseFtIn(length) : parseLocaleNumber(length, format.locale);
  const unit: Unit = f.unit === 'ftin' ? 'ft' : f.unit;
  const result =
    havePts && paperPt > 0 && realLen !== null && realLen > 0
      ? calibrate(
          { x: ax ?? 0, y: ay ?? 0 },
          { x: bx ?? 0, y: by ?? 0 },
          realLen,
          unit,
          f.precision,
        )
      : null;
  const submit = (): void => {
    if (!havePts || paperPt === 0) {
      setError('points');
      return;
    }
    if (!result) {
      setError('length');
      return;
    }
    const pages = pagesOf(f, docId);
    if (!pages?.length) {
      setError('range');
      return;
    }
    void applyScale(docId, pages, f.unit === 'ftin' ? { ...result, ftIn: f.ftIn } : result).then(
      (ok) => {
        if (ok) closeScaleDialog();
        else setError('save');
      },
    );
  };
  const labels = [msg('scale.p1x'), msg('scale.p1y'), msg('scale.p2x'), msg('scale.p2y')] as const;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closeScaleDialog();
      }}
      title={t('scale.calTitle')}
      description={t('scale.calDescription')}
      closeIcon={<Dismiss20Regular />}
      help={dialogHelp('measure-scale')}
      footer={
        <>
          <Button label={t('scale.apply')} variant="primary" type="submit" form={`${ids}-form`} />
          <Button label={t('annotate.caret.cancel')} onClick={closeScaleDialog} />
        </>
      }
    >
      <form
        id={`${ids}-form`}
        className="scale-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Button label={t('scale.pick')} onClick={startPicking} />
        <div className="scale-points">
          {labels.map((k, i) => (
            <TextField
              key={k}
              label={t(k)}
              inputMode="decimal"
              value={pts[i] ?? ''}
              onChange={(e) => {
                const v = e.currentTarget.value;
                setPts((p) => p.map((x, j) => (j === i ? v : x)));
                setError(null);
              }}
            />
          ))}
        </div>
        {havePts ? (
          <p className="scale-preview">
            {t('scale.onPaper', { length: format.number(paperPt * MM_PER_POINT, 1) })}
          </p>
        ) : null}
        <UnitFields f={f} />
        <TextField
          label={t(f.unit === 'ftin' ? msg('scale.realLengthFtIn') : msg('scale.realLength'))}
          value={length}
          onChange={(e) => {
            setLength(e.currentTarget.value);
            setError(null);
          }}
        />
        <PagesFields f={f} rangeError={error === 'range'} />
        <p className="scale-preview" role="status">
          {result ? t('scale.preview', { ratio: ratioLabel(result, format) }) : ''}
        </p>
        {error && error !== 'range' ? (
          <p className="ui-field-error" role="alert">
            {t(ERROR_KEYS[error])}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
