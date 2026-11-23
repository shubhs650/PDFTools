import { ArrowUndo20Regular } from '@fluentui/react-icons/svg/arrow-undo';
import { Target20Filled } from '@fluentui/react-icons/svg/target';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { format, msg, type MessageKey } from '../../../i18n';
import { Button, ToggleButton } from '../../../ui/components';
import { updateView, useOverlayView } from '../overlay/overlayState';
import {
  applyManual,
  canApply,
  cancelManual,
  completePairs,
  lineUpStep,
  nextSide,
  setApplyTo,
  setPicking,
  undoPoint,
  type ApplyTo,
  type LineUpStep,
  type ManualAlign,
} from './manualAlign';

const STEPS: readonly { n: LineUpStep; label: MessageKey }[] = [
  { n: 1, label: msg('compare.lineUp.step_1') },
  { n: 2, label: msg('compare.lineUp.step_2') },
  { n: 3, label: msg('compare.lineUp.step_3') },
  { n: 4, label: msg('compare.lineUp.step_4') },
];

const APPLY_TO: readonly { to: ApplyTo; label: MessageKey }[] = [
  { to: 'sheet', label: msg('compare.manual.applyTo_sheet') },
  { to: 'all', label: msg('compare.manual.applyTo_all') },
  { to: 'low', label: msg('compare.manual.applyTo_low') },
];

const BAR_TEST_ID = 'line-up-bar';

/** What the step bar says to do now. */
function instruction(m: ManualAlign): MessageKey {
  const done = completePairs(m).length;
  const next = nextSide(m);
  if (next === null) return msg('compare.lineUp.say_full');
  if (!m.picking) return msg('compare.lineUp.say_paused');
  if (next === 'b')
    return done === 0 ? msg('compare.lineUp.say_2') : msg('compare.lineUp.say_2more');
  if (done === 0) return msg('compare.lineUp.say_1');
  return done === 1 ? msg('compare.lineUp.say_3') : msg('compare.lineUp.say_4');
}

/**
 * Line up (M12-26, ADR-033, D-60): the guided step bar above the windows
 * while a sheet is lined up by hand — 1 a point on the old drawing, 2 the
 * same point on the new drawing, 3 an optional second pair far from the
 * first, 4 Apply — with what to do now, Undo last point, Pick points (after
 * Escape stopped picking), Apply to, Apply and Cancel. The window to click
 * has an outline (`data-line-up`); the points are numbered pins in both
 * windows and the overlay follows them at once. Fine-tune stays folded in the
 * Alignment section.
 */
export function LineUpBar({
  id,
  sheetNumber,
  pairs,
}: {
  id: string;
  sheetNumber: number;
  pairs: number;
}) {
  const { t } = useTranslation();
  const view = useOverlayView(id);
  const applyId = useId();
  const titleId = useId();
  const m = view.manual;
  if (!m) return null;
  const step = lineUpStep(m);
  const next = nextSide(m);
  return (
    <section
      className="line-up-bar"
      aria-labelledby={titleId}
      data-testid={BAR_TEST_ID}
      data-step={step}
    >
      <div className="line-up-head">
        <h3 id={titleId} className="line-up-title">
          <span aria-hidden="true" className="line-up-icon">
            <Target20Filled />
          </span>
          {t('compare.lineUp.title', { sheet: format.number(sheetNumber) })}
        </h3>
        <ol className="line-up-steps" aria-label={t('compare.lineUp.steps')}>
          {STEPS.map((s) => (
            <li
              key={s.n}
              className="line-up-step"
              data-state={s.n === step ? 'current' : s.n < step ? 'done' : 'todo'}
              aria-current={s.n === step ? 'step' : undefined}
            >
              <span className="line-up-step-n" aria-hidden="true">
                {format.number(s.n)}
              </span>
              <span>{t(s.label)}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="line-up-body">
        <p className="line-up-say" role="status" data-testid="align-instruction">
          {t(instruction(m))}
          {m.picking && next !== null ? ` ${t('compare.lineUp.snap')}` : ''}
        </p>
        {m.problem ? (
          <p className="line-up-problem" role="alert">
            {m.problem.reason === 'scale'
              ? t('compare.manual.badScale')
              : m.problem.side === 'a'
                ? t('compare.manual.tooClose_a')
                : t('compare.manual.tooClose_b')}
          </p>
        ) : null}
        <div className="line-up-actions">
          <Button
            label={t('compare.lineUp.undo')}
            icon={<ArrowUndo20Regular />}
            size="small"
            disabled={m.points.length === 0}
            onClick={() => {
              updateView(id, undoPoint);
            }}
          />
          <ToggleButton
            label={t('compare.manual.pick')}
            size="small"
            pressed={m.picking && next !== null}
            disabled={next === null}
            onPressedChange={(on) => {
              updateView(id, (v) => setPicking(on ? { ...v, layout: 'review' } : v, on));
            }}
          />
          <span className="line-up-apply">
            <label htmlFor={applyId}>{t('compare.manual.applyTo')}</label>
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
          </span>
          <Button
            label={t('compare.manual.apply')}
            size="small"
            variant="primary"
            disabled={!canApply(m)}
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
    </section>
  );
}
