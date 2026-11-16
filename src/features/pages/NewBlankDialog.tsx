import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format, msg, type MessageKey } from '../../i18n';
import {
  BLANK_MAX_PAGES,
  BLANK_PAPERS,
  POINTS_PER_UNIT,
  blankPageSize,
  pageCountOf,
  sideLimits,
  sideOk,
  sideToPoints,
  type BlankOrientation,
  type BlankPaper,
  type BlankUnit,
} from '../../model/blankSize';
import { Button, Dialog, TextField } from '../../ui/components';
import { dialogHelp } from '../help/openHelp';
import { closePageDialog } from './dialogStore';
import { createBlankPdf } from './newBlank';

// Create Blank PDF (M10-08·O4, D-49): page size (A4, A3, Letter, Legal or a
// custom width × height in mm or inches), orientation and number of pages.
// The choices are kept for the next time in this session.

const PAPER_LABEL: Record<BlankPaper, MessageKey> = {
  a4: msg('blank.paper.a4'),
  a3: msg('blank.paper.a3'),
  letter: msg('blank.paper.letter'),
  legal: msg('blank.paper.legal'),
  custom: msg('blank.paper.custom'),
};
const UNITS: readonly BlankUnit[] = ['mm', 'in'];
const UNIT_LABEL: Record<BlankUnit, MessageKey> = {
  mm: msg('blank.unit.mm'),
  in: msg('blank.unit.in'),
};
const ORIENTATIONS: readonly BlankOrientation[] = ['portrait', 'landscape'];
const ORIENTATION_LABEL: Record<BlankOrientation, MessageKey> = {
  portrait: msg('blank.portrait'),
  landscape: msg('blank.landscape'),
};

interface Choices {
  paper: BlankPaper;
  orientation: BlankOrientation;
  unit: BlankUnit;
  width: string;
  height: string;
  count: string;
}

let last: Choices = {
  paper: 'a4',
  orientation: 'portrait',
  unit: 'mm',
  width: '210',
  height: '297',
  count: '1',
};

/** Keeps the choices for the next time the dialog opens (this session). */
function remember(c: Choices): void {
  last = c;
}

/** The unit a paper size is usually given in (the preview line). */
const unitOf = (c: Choices): BlankUnit =>
  c.paper === 'custom' ? c.unit : c.paper === 'letter' || c.paper === 'legal' ? 'in' : 'mm';

export function NewBlankDialog() {
  const { t } = useTranslation();
  const ids = useId();
  const [c, setC] = useState<Choices>(() => last);
  const set = (patch: Partial<Choices>) => {
    setC((prev) => ({ ...prev, ...patch }));
  };
  const custom = c.paper === 'custom';
  const width = sideToPoints(c.width, c.unit);
  const height = sideToPoints(c.height, c.unit);
  const count = pageCountOf(c.count);
  const limits = sideLimits(c.unit);
  const sideError = t('blank.error.side', {
    min: format.number(limits.min, 1),
    max: format.number(limits.max, 1),
    unit: t(UNIT_LABEL[c.unit]),
  });
  const widthOk = !custom || sideOk(width);
  const heightOk = !custom || sideOk(height);
  const ok = widthOk && heightOk && count !== null;
  const size = ok
    ? blankPageSize(c.paper, c.orientation, { width: width ?? 0, height: height ?? 0 })
    : null;
  const shown = unitOf(c);
  const inUnit = (pt: number) => format.number(pt / POINTS_PER_UNIT[shown], shown === 'mm' ? 0 : 2);

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closePageDialog();
      }}
      title={t('blank.title')}
      description={t('blank.description')}
      closeIcon={<Dismiss20Regular />}
      help={dialogHelp('opening-files')}
      footer={
        <>
          <Button
            label={t('blank.confirm')}
            variant="primary"
            type="submit"
            form={`${ids}-form`}
            disabled={!ok}
          />
          <Button label={t('blank.cancel')} onClick={closePageDialog} />
        </>
      }
    >
      <form
        id={`${ids}-form`}
        className="scale-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!size || count === null) return;
          remember(c);
          closePageDialog();
          void createBlankPdf({ ...size, count });
        }}
      >
        <div className="ui-field">
          <label className="ui-field-label" htmlFor={`${ids}-paper`}>
            {t('blank.size')}
          </label>
          <select
            id={`${ids}-paper`}
            className="ui-field-input"
            value={c.paper}
            onChange={(e) => {
              set({ paper: e.currentTarget.value as BlankPaper });
            }}
          >
            {BLANK_PAPERS.map((p) => (
              <option key={p} value={p}>
                {t(PAPER_LABEL[p])}
              </option>
            ))}
          </select>
        </div>
        {custom ? (
          <div className="blank-custom">
            <TextField
              label={t('blank.width')}
              inputMode="decimal"
              value={c.width}
              error={widthOk ? undefined : sideError}
              onChange={(e) => {
                set({ width: e.currentTarget.value });
              }}
            />
            <TextField
              label={t('blank.height')}
              inputMode="decimal"
              value={c.height}
              error={heightOk ? undefined : sideError}
              onChange={(e) => {
                set({ height: e.currentTarget.value });
              }}
            />
            <div className="ui-field">
              <label className="ui-field-label" htmlFor={`${ids}-unit`}>
                {t('blank.unit.label')}
              </label>
              <select
                id={`${ids}-unit`}
                className="ui-field-input"
                value={c.unit}
                onChange={(e) => {
                  set({ unit: e.currentTarget.value as BlankUnit });
                }}
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {t(UNIT_LABEL[u])}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <fieldset className="scale-where">
            <legend className="ui-field-label">{t('blank.orientation')}</legend>
            {ORIENTATIONS.map((o) => (
              <label key={o} className="scale-radio">
                <input
                  type="radio"
                  name={`${ids}-orientation`}
                  checked={c.orientation === o}
                  onChange={() => {
                    set({ orientation: o });
                  }}
                />
                {t(ORIENTATION_LABEL[o])}
              </label>
            ))}
          </fieldset>
        )}
        <TextField
          label={t('blank.count')}
          inputMode="numeric"
          value={c.count}
          error={
            count === null
              ? t('blank.error.count', { max: format.number(BLANK_MAX_PAGES, 0) })
              : undefined
          }
          onChange={(e) => {
            set({ count: e.currentTarget.value });
          }}
        />
        {size && count !== null ? (
          <p className="scale-preview" data-testid="blank-summary">
            {t('blank.summary', {
              count,
              pages: format.number(count, 0),
              width: inUnit(size.width),
              height: inUnit(size.height),
              unit: t(UNIT_LABEL[shown]),
            })}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
