import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../i18n';
import { POINTS_PER_UNIT, type BlankUnit } from '../../model/blankSize';
import {
  keptRect,
  marginsFit,
  marginToPoints,
  NO_MARGINS,
  type CropMargins,
} from '../../model/cropBox';
import { Button, Dialog, TextField } from '../../ui/components';
import { resolveScope, type Scope, type ScopeKind } from '../extract/scope';
import { dialogHelp } from '../help/openHelp';
import { ThumbImage } from '../thumbnails/ThumbImage';
import { usePages } from '../thumbnails/pageInfo';
import { cropPages, cropPagesOp, pageIsCropped } from './crop';
import { closePageDialog as closeDialog } from './dialogStore';
import { selectionOf } from './selection';

// Organize → Crop Pages (M11-08·O9, D-55): margins cut off each page as it is
// shown now (top, bottom, left, right in mm or inches), for all pages, the
// current page, the selected pages or a range; a preview of the first page
// with the area kept; Remove Crop shows the chosen pages' whole sheets again.
// From the Crop Tool, the margins of the area drawn and that page. The unit
// and the last margins typed are kept for the next time in this session.

const SIDES = ['top', 'bottom', 'left', 'right'] as const;
type Side = (typeof SIDES)[number];
const SIDE_LABEL: Record<Side, MessageKey> = {
  top: msg('crop.top'),
  bottom: msg('crop.bottom'),
  left: msg('crop.left'),
  right: msg('crop.right'),
};
const UNITS: readonly BlankUnit[] = ['mm', 'in'];
const UNIT_LABEL: Record<BlankUnit, MessageKey> = {
  mm: msg('blank.unit.mm'),
  in: msg('blank.unit.in'),
};
const RANGE_ERRORS: Record<string, MessageKey> = {
  empty: msg('pages.error.empty'),
  syntax: msg('pages.error.syntax'),
  outOfRange: msg('pages.error.outOfRange'),
  noSelection: msg('pages.error.noSelection'),
};

/** Decimals a margin is shown with in each unit. */
const DECIMALS: Record<BlankUnit, number> = { mm: 1, in: 2 };
/** The preview's longer side, in CSS px. */
const PREVIEW = 168;

type Texts = Record<Side, string>;

let lastUnit: BlankUnit = 'mm';
let lastTexts: Texts | null = null;

/** Keeps the unit and the margins typed for the next time the dialog opens (this session). */
function rememberCrop(unit: BlankUnit, texts: Texts): void {
  lastUnit = unit;
  lastTexts = texts;
}

/** A margin as text in `unit` (a dot as the decimal sign, as typed). */
function marginText(pt: number, unit: BlankUnit): string {
  const v = pt / POINTS_PER_UNIT[unit];
  const r = Number(v.toFixed(DECIMALS[unit]));
  return String(Math.abs(r) < 1e-9 ? 0 : r);
}

const textsOf = (m: CropMargins, unit: BlankUnit): Texts => ({
  top: marginText(m.top, unit),
  bottom: marginText(m.bottom, unit),
  left: marginText(m.left, unit),
  right: marginText(m.right, unit),
});

export function CropDialog({
  docId,
  from,
}: {
  docId: string;
  from?: { page: number; margins: CropMargins } | undefined;
}) {
  const { t } = useTranslation();
  const ids = useId();
  const pageCount = useDocuments((s) => s.docs[docId]?.meta.pageCount ?? 0);
  const viewPage = useDocuments((s) => s.docs[docId]?.view.page ?? 0);
  const current = from?.page ?? viewPage;
  const picked = selectionOf(docId).selected;
  const selection = picked.length > 1 && !from ? picked : [];
  const [scope, setScope] = useState<Scope>({
    kind: selection.length > 1 ? 'selection' : from ? 'current' : 'all',
    custom: '',
  });
  const [unit, setUnit] = useState<BlankUnit>(lastUnit);
  const [texts, setTexts] = useState<Texts>(() =>
    from ? textsOf(from.margins, lastUnit) : (lastTexts ?? textsOf(NO_MARGINS, lastUnit)),
  );
  // Each margin as typed, in points, unrounded: a change of unit shows these
  // again, so mm → in → mm gives back what was typed.
  const exact = useRef<Record<Side, number | null> | null>(null);
  const pages = cropPages(docId);
  const thumbs = usePages(docId);

  const values = Object.fromEntries(
    SIDES.map((s) => [s, marginToPoints(texts[s], unit)]),
  ) as Record<Side, number | null>;
  const margins: CropMargins | null = SIDES.every((s) => values[s] !== null)
    ? {
        top: values.top ?? 0,
        bottom: values.bottom ?? 0,
        left: values.left ?? 0,
        right: values.right ?? 0,
      }
    : null;
  const r = resolveScope(scope, { pageCount, current, selection });
  const targets = r.ok ? r.pages : [];
  const tooSmall = margins
    ? targets.find((i) => !marginsFit(pages[i] ?? NO_SIZE, margins))
    : undefined;
  const ok = r.ok && margins !== null && tooSmall === undefined;
  const removable = targets.some((i) => {
    const p = pages[i];
    return p !== undefined && pageIsCropped(p);
  });
  const first = targets[0];
  const shown = first === undefined ? undefined : pages[first];
  const rangeError = !r.ok && scope.kind === 'custom' ? RANGE_ERRORS[r.error] : undefined;

  const changeUnit = (u: BlankUnit) => {
    // The margins stay the same length, shown in the new unit.
    exact.current ??= values;
    const kept = exact.current;
    setTexts((prev) => {
      const next = { ...prev };
      for (const s of SIDES) {
        const pt = kept[s];
        if (pt !== null) next[s] = marginText(pt, u);
      }
      return next;
    });
    setUnit(u);
  };
  const remember = () => {
    rememberCrop(unit, texts);
  };

  const radio = (kind: ScopeKind, label: string, disabled = false) => (
    <label className="scale-radio">
      <input
        type="radio"
        name={`${ids}-scope`}
        checked={scope.kind === kind}
        disabled={disabled}
        onChange={() => {
          setScope((s) => ({ ...s, kind }));
        }}
      />
      {label}
    </label>
  );
  const inUnit = (pt: number) => format.number(pt / POINTS_PER_UNIT[unit], DECIMALS[unit]);

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closeDialog();
      }}
      title={t('crop.title')}
      description={t('crop.description')}
      closeIcon={<Dismiss20Regular />}
      help={dialogHelp('organize-pages')}
      className="crop-dialog"
      footer={
        <>
          <Button
            label={t('crop.confirm')}
            variant="primary"
            type="submit"
            form={`${ids}-form`}
            disabled={!ok}
          />
          <Button
            label={t('crop.remove')}
            disabled={!r.ok || !removable}
            onClick={() => {
              if (!r.ok) return;
              remember();
              closeDialog();
              void cropPagesOp(docId, r.pages, null);
            }}
          />
          <Button label={t('crop.cancel')} onClick={closeDialog} />
        </>
      }
    >
      <form
        id={`${ids}-form`}
        className="crop-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          remember();
          closeDialog();
          void cropPagesOp(docId, r.pages, margins);
        }}
      >
        <div className="crop-fields">
          <fieldset className="crop-margins">
            <legend className="ui-field-label">{t('crop.margins')}</legend>
            <div className="crop-margin-grid">
              {SIDES.map((s) => (
                <TextField
                  key={s}
                  label={t(SIDE_LABEL[s])}
                  inputMode="decimal"
                  value={texts[s]}
                  error={values[s] === null ? t('crop.error.number') : undefined}
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    exact.current = null;
                    setTexts((prev) => ({ ...prev, [s]: v }));
                  }}
                />
              ))}
            </div>
            <div className="ui-field crop-unit">
              <label className="ui-field-label" htmlFor={`${ids}-unit`}>
                {t('blank.unit.label')}
              </label>
              <select
                id={`${ids}-unit`}
                className="ui-field-input"
                value={unit}
                onChange={(e) => {
                  changeUnit(e.currentTarget.value as BlankUnit);
                }}
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {t(UNIT_LABEL[u])}
                  </option>
                ))}
              </select>
            </div>
          </fieldset>
          <fieldset className="scale-where">
            <legend className="ui-field-label">{t('pages.scope.legend')}</legend>
            {radio('all', t('crop.scope.all', { count: format.number(pageCount, 0) }))}
            {radio(
              'current',
              from
                ? t('crop.scope.drawn', { page: format.number(current + 1, 0) })
                : t('pages.scope.current', { page: format.number(current + 1, 0) }),
            )}
            {radio(
              'selection',
              t('pages.scope.selected', { count: selection.length }),
              selection.length === 0,
            )}
            {radio('custom', t('pages.scope.custom'))}
            {scope.kind === 'custom' ? (
              <TextField
                label={t('pages.scope.customLabel')}
                placeholder={t('pages.scope.customHint')}
                value={scope.custom}
                error={rangeError ? t(rangeError) : undefined}
                onChange={(e) => {
                  const custom = e.currentTarget.value;
                  setScope({ kind: 'custom', custom });
                }}
              />
            ) : null}
          </fieldset>
        </div>
        {first !== undefined && shown && thumbs[first] ? (
          <CropPreview
            docId={docId}
            pageIndex={first}
            page={thumbs[first]}
            size={shown}
            margins={margins}
            label={t('crop.preview', { page: format.number(first + 1, 0) })}
          />
        ) : null}
        <p className="print-note" role="status" data-testid="crop-summary">
          {tooSmall !== undefined
            ? null
            : margins && shown && first !== undefined
              ? t('crop.summary', {
                  page: format.number(first + 1, 0),
                  width: inUnit(keptRect(shown, margins).width),
                  height: inUnit(keptRect(shown, margins).height),
                  unit: t(UNIT_LABEL[unit]),
                })
              : null}
        </p>
        {tooSmall !== undefined ? (
          <p className="print-error" role="alert">
            {t('crop.error.tooSmall', { page: format.number(tooSmall + 1, 0) })}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

const NO_SIZE = { width: 0, height: 0 };

/**
 * The first chosen page as it is shown now, the parts the margins cut off
 * shaded and the area kept outlined. A picture only: the margins are the way
 * to change it (keyboard, rule 12).
 */
function CropPreview({
  docId,
  pageIndex,
  page,
  size,
  margins,
  label,
}: {
  docId: string;
  pageIndex: number;
  page: { width: number; height: number; rotation: number };
  size: { width: number; height: number };
  margins: CropMargins | null;
  label: string;
}) {
  const wide = size.width >= size.height;
  const width = wide ? PREVIEW : Math.round((PREVIEW * size.width) / Math.max(1, size.height));
  const height = Math.round((width * size.height) / Math.max(1, size.width));
  const k = width / Math.max(1, size.width);
  const kept = margins && marginsFit(size, margins) ? keptRect(size, margins) : null;
  return (
    <figure className="crop-preview" data-testid="crop-preview">
      <div className="crop-preview-page thumb-image" style={{ width, height }}>
        <ThumbImage
          documentId={docId}
          pageIndex={pageIndex}
          page={page}
          width={width}
          priority={0}
        />
        {kept ? (
          <div
            className="crop-preview-kept"
            data-testid="crop-preview-kept"
            aria-hidden="true"
            style={{
              left: kept.x * k,
              top: kept.y * k,
              width: kept.width * k,
              height: kept.height * k,
            }}
          />
        ) : null}
      </div>
      <figcaption className="crop-preview-caption">{label}</figcaption>
    </figure>
  );
}
