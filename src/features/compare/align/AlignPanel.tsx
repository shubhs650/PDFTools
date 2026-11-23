import { HelpButton } from '../../help/HelpButton';
import { ArrowDown20Regular } from '@fluentui/react-icons/svg/arrow-down';
import { ArrowLeft20Regular } from '@fluentui/react-icons/svg/arrow-left';
import { ArrowRight20Regular } from '@fluentui/react-icons/svg/arrow-right';
import { ArrowUp20Regular } from '@fluentui/react-icons/svg/arrow-up';
import { Checkmark20Regular } from '@fluentui/react-icons/svg/checkmark';
import { ChevronDown12Regular } from '@fluentui/react-icons/svg/chevron-down';
import { ChevronRight12Regular } from '@fluentui/react-icons/svg/chevron-right';
import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { Target20Regular } from '@fluentui/react-icons/svg/target';
import { useId, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { format, msg } from '../../../i18n';
import { parseLocaleNumber } from '../../../i18n/format';
import {
  NUDGE_LARGE,
  NUDGE_STEP,
  nudgeForKey,
  placeValues,
  pointError,
  withValue,
  type PlaceValues,
  type Pt,
} from '../../../model/compare/align/manual';
import { Button, IconButton } from '../../../ui/components';
import { useFrame, framePage } from '../overlay/frames';
import { alignmentText } from '../alignmentText';
import { FoldSection } from '../layout/FoldSection';
import {
  alignmentOf,
  isAlignChecked,
  needsCheck,
  setAlignChecked,
  updateView,
  useOverlayView,
  type Sheet,
} from '../overlay/overlayState';
import {
  backToAutomatic,
  completePairs,
  nudgeManual,
  removePair,
  setManualPlace,
  toggleLineUp,
} from './manualAlign';

// The section's test id and help topic (M12-25: the FoldSection takes them as props).
const ALIGN_TEST_ID = 'align-panel';
const ALIGN_HELP = 'compare-alignment';

const NUDGES = [
  {
    dir: 'left',
    label: msg('compare.manual.nudge_left'),
    Icon: ArrowLeft20Regular,
    dx: -NUDGE_STEP,
    dy: 0,
  },
  {
    dir: 'up',
    label: msg('compare.manual.nudge_up'),
    Icon: ArrowUp20Regular,
    dx: 0,
    dy: -NUDGE_STEP,
  },
  {
    dir: 'down',
    label: msg('compare.manual.nudge_down'),
    Icon: ArrowDown20Regular,
    dx: 0,
    dy: NUDGE_STEP,
  },
  {
    dir: 'right',
    label: msg('compare.manual.nudge_right'),
    Icon: ArrowRight20Regular,
    dx: NUDGE_STEP,
    dy: 0,
  },
] as const;

/**
 * The Alignment section of the overlay's left pane (M12-13, D-60; M12-26,
 * ADR-033): the sheet's status in plain words with the values found, **Line
 * up by hand** (the guided Line up mode, LineUpBar), **It looks right** on a
 * sheet that needs checking, **Use automatic alignment** on a sheet lined up
 * by hand. While lining up: the point pairs picked (with how far each is off
 * once there are three) and **Fine-tune**, folded: X and Y offset, scale %,
 * rotation ° and nudges of Document A with the arrow keys.
 */
export function AlignPanel({ id, sheet }: { id: string; sheet: Sheet }) {
  const { t } = useTranslation();
  const view = useOverlayView(id);
  const frame = useFrame(framePage(sheet), 0);
  if (sheet.pair === null) return null;
  const pair = sheet.pair;
  const al = alignmentOf(view, sheet);
  const text = al ? alignmentText(al, isAlignChecked(view, sheet)) : null;
  const manual = view.manual?.pair === pair ? view.manual : null;

  return (
    // Folds to the sheet's alignment status (M12-25); open while lining up.
    <FoldSection
      id={id}
      section="align"
      title={t('compare.manual.title')}
      summary={text ? text.status : t('compare.fold.aligning')}
      help={<HelpButton topic="compare-alignment" />}
      forceOpen={manual !== null}
      className="overlay-align"
      testId={ALIGN_TEST_ID}
      helpTopic={ALIGN_HELP}
    >
      {text ? (
        <p className="overlay-align-status" data-status={text.shown} data-testid="align-status">
          <span className="overlay-align-word">{text.status}</span>
          {text.hint ? (
            <span className="overlay-align-values-found">{text.hint}</span>
          ) : text.values ? (
            <span className="overlay-align-values-found">{text.values}</span>
          ) : null}
        </p>
      ) : null}
      {!manual ? (
        <div className="overlay-align-actions">
          <Button
            label={t('compare.manual.start')}
            icon={<Target20Regular />}
            size="small"
            onClick={() => {
              toggleLineUp(id, sheet, true);
            }}
          />
          {needsCheck(view, sheet) ? (
            <Button
              label={t('compare.lineUp.looksRight')}
              icon={<Checkmark20Regular />}
              size="small"
              onClick={() => {
                updateView(id, (v) => setAlignChecked(v, pair));
              }}
            />
          ) : null}
          {al?.status === 'manual' ? (
            <Button
              label={t('compare.manual.automatic')}
              size="small"
              onClick={() => {
                backToAutomatic(id, pair);
              }}
            />
          ) : null}
        </div>
      ) : (
        <ManualEditor
          id={id}
          centre={frame ? { x: frame.width / 2, y: frame.height / 2 } : { x: 0, y: 0 }}
        />
      )}
    </FoldSection>
  );
}

function ManualEditor({ id, centre }: { id: string; centre: Pt }) {
  const { t } = useTranslation();
  const view = useOverlayView(id);
  const [fine, setFine] = useState(false);
  const fineId = useId();
  const m = view.manual;
  if (!m) return null;
  const done = completePairs(m);
  const err = done.length > 0 ? pointError(done, m.place) : null;
  const values = placeValues(m.place);
  const pt = (n: number): string => format.fixed(Math.abs(n) < 0.005 ? 0 : n, 2);

  const set = (key: keyof PlaceValues, value: number): boolean => {
    const place = withValue(m.place, key, value, centre);
    if (!place) return false;
    updateView(id, (v) => setManualPlace(v, place));
    return true;
  };
  const nudge = (dx: number, dy: number): void => {
    updateView(id, (v) => nudgeManual(v, dx, dy));
  };
  // Arrow keys on any nudge button nudge that way (Shift: larger).
  const onNudgeKey = (e: KeyboardEvent<HTMLButtonElement>): void => {
    const d = nudgeForKey(e.key, e.shiftKey);
    if (!d) return;
    e.preventDefault();
    nudge(d.dx, d.dy);
  };

  return (
    <div className="overlay-align-editor" data-testid="align-editor">
      <p className="overlay-align-hint">{t('compare.lineUp.paneHint')}</p>
      {m.points.length > 0 ? (
        <ol className="overlay-align-points" aria-label={t('compare.manual.points')}>
          {m.points.map((p, i) => {
            const k = done.findIndex((d) => d.a === p.a && d.b === p.b);
            const off = k >= 0 && err ? err.each[k] : undefined;
            return (
              <li key={i} className="overlay-align-point" data-testid="align-pair">
                <span>
                  {t('compare.manual.pair', {
                    n: format.number(i + 1),
                    a: p.a ? `${pt(p.a.x)}, ${pt(p.a.y)}` : '—',
                    b: p.b ? `${pt(p.b.x)}, ${pt(p.b.y)}` : '—',
                  })}
                </span>
                {off !== undefined && done.length >= 3 ? (
                  <span className="overlay-align-off" data-testid="align-pair-error">
                    {t('compare.manual.off', { pt: pt(off) })}
                  </span>
                ) : null}
                <IconButton
                  label={t('compare.manual.remove', { n: format.number(i + 1) })}
                  icon={<Dismiss20Regular />}
                  size="small"
                  onClick={() => {
                    updateView(id, (v) => removePair(v, i));
                  }}
                />
              </li>
            );
          })}
        </ol>
      ) : null}
      {err && done.length >= 3 ? (
        <p className="overlay-align-error" data-testid="align-error">
          {t('compare.manual.error', { rms: pt(err.rms), max: pt(err.max) })}
        </p>
      ) : null}
      <button
        type="button"
        className="cmp-fold-button overlay-align-fine ui-focusable"
        aria-expanded={fine}
        aria-controls={fine ? fineId : undefined}
        data-testid="align-finetune"
        onClick={() => {
          setFine(!fine);
        }}
      >
        <span aria-hidden="true">
          {fine ? <ChevronDown12Regular /> : <ChevronRight12Regular />}
        </span>
        <span>{t('compare.lineUp.fineTune')}</span>
      </button>
      {/* The values stay in the page while folded: the placement shown is read from them. */}
      <div id={fineId} className="overlay-align-fine-body" hidden={!fine}>
        <div
          className="overlay-align-values"
          role="group"
          aria-label={t('compare.manual.values')}
          data-testid="align-values"
          data-place={m.place.join(',')}
        >
          <ValueField
            label={t('compare.manual.dx')}
            unit={t('compare.manual.unitPt')}
            value={values.dx}
            digits={2}
            step={NUDGE_STEP}
            onCommit={(n) => set('dx', n)}
          />
          <ValueField
            label={t('compare.manual.dy')}
            unit={t('compare.manual.unitPt')}
            value={values.dy}
            digits={2}
            step={NUDGE_STEP}
            onCommit={(n) => set('dy', n)}
          />
          <ValueField
            label={t('compare.manual.scale')}
            unit="%"
            value={values.scale * 100}
            digits={3}
            step={0.01}
            onCommit={(n) => set('scale', n / 100)}
          />
          <ValueField
            label={t('compare.manual.deg')}
            unit="°"
            value={values.deg}
            digits={3}
            step={0.01}
            onCommit={(n) => set('deg', n)}
          />
        </div>
        <div
          className="overlay-align-nudge"
          role="group"
          aria-label={t('compare.manual.nudge', {
            step: format.number(NUDGE_STEP, 1),
            large: format.number(NUDGE_LARGE),
          })}
          data-testid="align-nudge"
        >
          <span className="overlay-align-nudge-label" aria-hidden="true">
            {t('compare.manual.nudgeShort')}
          </span>
          {NUDGES.map(({ dir, label, Icon, dx, dy }) => (
            <IconButton
              key={dir}
              label={t(label)}
              icon={<Icon />}
              size="small"
              data-testid={`align-nudge-${dir}`}
              onClick={() => {
                nudge(dx, dy);
              }}
              onKeyDown={onNudgeKey}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * A value typed in the user's locale (Intl), committed on Enter or leaving
 * the field; Arrow Up and Down step it (Shift: ten steps).
 */
function ValueField({
  label,
  unit,
  value,
  digits,
  step,
  onCommit,
}: {
  label: string;
  unit: string;
  value: number;
  digits: number;
  step: number;
  onCommit: (n: number) => boolean;
}) {
  const shown = format.fixed(Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value, digits);
  // A new value from elsewhere (points, nudges) starts the field afresh.
  return (
    <ValueInput
      key={shown}
      label={label}
      unit={unit}
      shown={shown}
      value={value}
      step={step}
      onCommit={onCommit}
    />
  );
}

function ValueInput({
  label,
  unit,
  shown,
  value,
  step,
  onCommit,
}: {
  label: string;
  unit: string;
  shown: string;
  value: number;
  step: number;
  onCommit: (n: number) => boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState(shown);
  const [error, setError] = useState(false);
  const commit = (): void => {
    if (text.trim() === '' || text === shown) return;
    const n = parseLocaleNumber(text, format.locale);
    const ok = n !== null && onCommit(n);
    setError(!ok);
  };
  return (
    <div className="overlay-align-field">
      <label htmlFor={id} className="ui-field-label">
        {label}
      </label>
      <div className="overlay-align-row">
        <input
          id={id}
          className="ui-field-input overlay-align-number"
          inputMode="decimal"
          value={text}
          aria-invalid={error || undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => {
            setText(e.currentTarget.value);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') {
              setText(shown);
              setError(false);
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
              onCommit(value + d);
            }
          }}
        />
        <span className="overlay-align-unit" aria-hidden="true">
          {unit}
        </span>
      </div>
      {error ? (
        <p id={`${id}-error`} className="ui-field-error" role="alert">
          {t('compare.manual.badValue')}
        </p>
      ) : null}
    </div>
  );
}
