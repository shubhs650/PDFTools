import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from '../../i18n';
import { parseLocaleNumber } from '../../i18n/format';
import { calibrate, parseFtIn, ratioLabel, type Unit } from '../../model/scale';
import { normBox, type Box } from '../../model/scaleViewport';
import { Button, Dialog, TextField } from '../../ui/components';
import { UnitFields } from './ScaleDialogs';
import { toScale, useScaleFields } from './scaleFields';
import { mediaBoxOf, scaleStore, useScales } from './scaleStore';
import { closeViewportDialog, saveViewport, useViewports, type ViewportEdit } from './viewports';

/** Measure → Scale Viewport (M3-17): name, box and scale (ratio, or the box's real width). */
export function ViewportDialog() {
  const editing = useViewports((s) => s.editing);
  if (!editing) return null;
  return <ViewportForm key={`${editing.docId}/${String(editing.index)}`} e={editing} />;
}

const MIN = 4;

function ViewportForm({ e }: { e: ViewportEdit }) {
  const { t } = useTranslation();
  const ids = useId();
  const defaults = useScales((s) => s.defaults);
  const f = useScaleFields(
    e.scale
      ? {
          unit: e.scale.unit,
          precision: e.scale.precision,
          ...(e.scale.ftIn ? { ftIn: e.scale.ftIn } : {}),
        }
      : defaults,
  );
  const num = (n: number): string => format.number(n, 2);
  const [name, setName] = useState(e.name);
  const [paper, setPaper] = useState(e.scale ? format.number(e.scale.paper, 4) : '1');
  const [real, setReal] = useState(e.scale ? format.number(e.scale.real, 4) : '5');
  const [known, setKnown] = useState('');
  const [box, setBox] = useState(e.bbox.map(num));
  const [error, setError] = useState<'name' | 'box' | 'ratio' | 'length' | null>(null);

  const parse = (v: string): number | null => parseLocaleNumber(v, format.locale);
  const b = box.map(parse);
  const nb = b.every((n): n is number => n !== null) ? normBox(b as Box) : null;
  const [mx1, my1, mx2, my2] = mediaBoxOf(scaleStore.getState(), e.docId, e.page);
  const boxOk =
    !!nb &&
    nb[2] - nb[0] >= MIN &&
    nb[3] - nb[1] >= MIN &&
    nb[0] >= mx1 - 0.5 &&
    nb[1] >= my1 - 0.5 &&
    nb[2] <= mx2 + 0.5 &&
    nb[3] <= my2 + 0.5;

  // The scale: from the box's real width when given (calibration), else the ratio.
  const scale = (() => {
    if (known.trim() !== '' && nb) {
      const unit: Unit = f.unit === 'ftin' ? 'ft' : f.unit;
      const len = f.unit === 'ftin' ? parseFtIn(known) : parse(known);
      if (len === null || len <= 0) return 'length' as const;
      const s = calibrate({ x: nb[0], y: 0 }, { x: nb[2], y: 0 }, len, unit, f.precision);
      return toScale(s.paper, s.real, f.unit, f.precision, f.ftIn);
    }
    const p = parse(paper);
    const r = parse(real);
    if (p === null || r === null || p <= 0 || r <= 0) return 'ratio' as const;
    return toScale(p, r, f.unit, f.precision, f.ftIn);
  })();

  const submit = (): void => {
    if (name.trim() === '') {
      setError('name');
      return;
    }
    if (!boxOk) {
      setError('box');
      return;
    }
    if (typeof scale === 'string') {
      setError(scale);
      return;
    }
    saveViewport({ ...e, name: name.trim(), bbox: nb }, scale);
    closeViewportDialog();
  };
  const boxLabels = [t('viewport.x1'), t('viewport.y1'), t('viewport.x2'), t('viewport.y2')];
  const errorText =
    error === 'name'
      ? t('viewport.error.name')
      : error === 'box'
        ? t('viewport.error.box')
        : error === 'ratio'
          ? t('scale.error.ratio')
          : error === 'length'
            ? t('scale.error.length')
            : null;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closeViewportDialog();
      }}
      title={e.index === undefined ? t('viewport.addTitle') : t('viewport.editTitle')}
      description={t('viewport.description')}
      closeIcon={<Dismiss20Regular />}
      footer={
        <>
          <Button label={t('viewport.save')} variant="primary" type="submit" form={`${ids}-form`} />
          <Button label={t('annotate.caret.cancel')} onClick={closeViewportDialog} />
        </>
      }
    >
      <form
        id={`${ids}-form`}
        className="scale-form"
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          submit();
        }}
      >
        <TextField
          label={t('viewport.name')}
          value={name}
          onChange={(ev) => {
            setName(ev.currentTarget.value);
            setError(null);
          }}
        />
        <fieldset className="viewport-box">
          <legend className="ui-field-label">{t('viewport.box')}</legend>
          {box.map((v, i) => (
            <TextField
              key={boxLabels[i]}
              label={boxLabels[i] ?? ''}
              inputMode="decimal"
              value={v}
              onChange={(ev) => {
                const next = [...box];
                next[i] = ev.currentTarget.value;
                setBox(next);
                setError(null);
              }}
            />
          ))}
        </fieldset>
        <div className="scale-ratio">
          <TextField
            label={t('scale.paper')}
            inputMode="decimal"
            value={paper}
            onChange={(ev) => {
              setPaper(ev.currentTarget.value);
              setError(null);
            }}
          />
          <span aria-hidden="true">:</span>
          <TextField
            label={t('scale.real')}
            inputMode="decimal"
            value={real}
            onChange={(ev) => {
              setReal(ev.currentTarget.value);
              setError(null);
            }}
          />
        </div>
        <TextField
          label={t('viewport.knownWidth')}
          value={known}
          onChange={(ev) => {
            setKnown(ev.currentTarget.value);
            setError(null);
          }}
        />
        <UnitFields f={f} />
        <p className="scale-preview" role="status">
          {typeof scale === 'string'
            ? ''
            : t('scale.preview', { ratio: ratioLabel(scale, format) })}
        </p>
        {errorText ? (
          <p className="ui-field-error" role="alert">
            {errorText}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
