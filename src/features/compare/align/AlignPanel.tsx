import { HelpButton } from '../../help/HelpButton';
import { ArrowDown20Regular } from '@fluentui/react-icons/svg/arrow-down';
import { ArrowLeft20Regular } from '@fluentui/react-icons/svg/arrow-left';
import { ArrowRight20Regular } from '@fluentui/react-icons/svg/arrow-right';
import { ArrowUp20Regular } from '@fluentui/react-icons/svg/arrow-up';
import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useId, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { format, msg, type MessageKey } from '../../../i18n';
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
import { Button, IconButton, ToggleButton } from '../../../ui/components';
import { useFrame, framePage } from '../overlay/frames';
import { alignmentOf, updateView, useOverlayView, type Sheet } from '../overlay/overlayState';
import {
  applyManual,
  backToAutomatic,
  cancelManual,
  completePairs,
  nextSide,
  nudgeManual,
  removePair,
  setApplyTo,
  setManualPlace,
  setPicking,
  startManual,
  type ApplyTo,
} from './manualAlign';

const APPLY_TO: readonly { to: ApplyTo; label: MessageKey }[] = [
  { to: 'sheet', label: msg('compare.manual.applyTo_sheet') },
  { to: 'all', label: msg('compare.manual.applyTo_all') },
  { to: 'low', label: msg('compare.manual.applyTo_low') },
];

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
 * Manual alignment of the sheet shown (M12-13, D-60, Q7, Q8), in the left
 * pane under the sheet list: Align by points starts it in Review, where clicks
 * in Document A's and Document B's windows pick 1 to 3 point pairs (one
 * shifts, two give shift, scale and rotation, three a best fit with its
 * error); the values can be typed (X and Y offset, scale %, rotation °) and
 * Document A nudged with the arrow keys; the overlay shows the result at once.
 * Apply sets it on this sheet, all sheets or all low-confidence sheets.
 */
export function AlignPanel({
  id,
  sheet,
  pairs,
}: {
  id: string;
  sheet: Sheet;
  /** How many sheets are compared (Apply to all). */
  pairs: number;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const view = useOverlayView(id);
  const frame = useFrame(framePage(sheet), 0);
  if (sheet.pair === null) return null;
  const pair = sheet.pair;
  const al = alignmentOf(view, sheet);
  const manual = view.manual?.pair === pair ? view.manual : null;

  return (
    <section
      className="overlay-align"
      aria-labelledby={headingId}
      data-testid="align-panel"
      data-help-topic="compare-alignment"
    >
      <div className="pane-title-row">
        <h3 id={headingId} className="overlay-side-title">
          {t('compare.manual.title')}
        </h3>
        <HelpButton topic="compare-alignment" />
      </div>
      {!manual ? (
        <div className="overlay-align-actions">
          <Button
            label={t('compare.manual.start')}
            size="small"
            onClick={() => {
              updateView(id, (v) => startManual(v, sheet));
            }}
          />
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
          pairs={pairs}
          centre={frame ? { x: frame.width / 2, y: frame.height / 2 } : { x: 0, y: 0 }}
        />
      )}
    </section>
  );
}

function ManualEditor({ id, pairs, centre }: { id: string; pairs: number; centre: Pt }) {
  const { t } = useTranslation();
  const view = useOverlayView(id);
  const applyId = useId();
  const m = view.manual;
  if (!m) return null;
  const done = completePairs(m);
  const err = done.length > 0 ? pointError(done, m.place) : null;
  const next = nextSide(m);
  const values = placeValues(m.place);
  const pt = (n: number): string => format.fixed(Math.abs(n) < 0.005 ? 0 : n, 2);

  let instruction: string;
  if (next === null) instruction = t('compare.manual.full');
  else if (!m.picking) instruction = t('compare.manual.notPicking');
  else if (next === 'a') instruction = t('compare.manual.pickA');
  else instruction = t('compare.manual.pickB');

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
      <ToggleButton
        label={t('compare.manual.pick')}
        size="small"
        pressed={m.picking}
        disabled={next === null && !m.picking}
        onPressedChange={(on) => {
          updateView(id, (v) => setPicking(on ? { ...v, layout: 'review' } : v, on));
        }}
      />
      <p className="overlay-align-hint" role="status" data-testid="align-instruction">
        {instruction}
      </p>
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
      {m.problem ? (
        <p className="overlay-align-problem" role="alert">
          {m.problem.reason === 'scale'
            ? t('compare.manual.badScale')
            : m.problem.side === 'a'
              ? t('compare.manual.tooClose_a')
              : t('compare.manual.tooClose_b')}
        </p>
      ) : null}
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
      <div className="overlay-align-apply">
        <label htmlFor={applyId} className="ui-field-label">
          {t('compare.manual.applyTo')}
        </label>
        <select
          id={applyId}
          className="ui-field-input"
          value={m.applyTo}
          onChange={(e) => {
            const to = e.currentTarget.value as ApplyTo;
            updateView(id, (v) => setApplyTo(v, to));
          }}
        >
          {APPLY_TO.map(({ to, label }) => (
            <option key={to} value={to}>
              {t(label)}
            </option>
          ))}
        </select>
        <div className="overlay-align-actions">
          <Button
            label={t('compare.manual.apply')}
            size="small"
            variant="primary"
            onClick={() => {
              applyManual(id, pairs);
            }}
          />
          <Button
            label={t('compare.manual.cancel')}
            size="small"
            onClick={() => {
              updateView(id, cancelManual);
            }}
          />
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
