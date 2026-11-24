import { CheckmarkCircle20Regular } from '@fluentui/react-icons/svg/checkmark-circle';
import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { Warning20Regular } from '@fluentui/react-icons/svg/warning';
import { ZoomIn20Regular } from '@fluentui/react-icons/svg/zoom-in';
import { ZoomOut20Regular } from '@fluentui/react-icons/svg/zoom-out';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { recordError } from '../../../app/diagnostics';
import { format, msg, t as tr, type MessageKey } from '../../../i18n';
import { cellOf, colLetters, columnOf, MAX_ROW } from '../../../model/crs/a1';
import {
  applySuggestions,
  columnMarks,
  detailMarks,
  firstStepWithIssue,
  firstTarget,
  place,
  SETUP_STEPS,
  stepIssues,
  unplaceColumn,
  type PlaceTarget,
  type SetupStep,
  type Suggested,
} from '../../../model/crs/setup';
import {
  columnLabel,
  CRS_TYPES,
  DETAIL_FIELDS,
  MAX_NAME,
  SNAPSHOT_MAX_PX,
  SNAPSHOT_MIN_PX,
  STATUS_WORDS,
  type CrsTemplateSettings,
  type DetailField,
  type StatusWord,
  type TemplateIssue,
} from '../../../model/crs/template';
import type { SheetPreview } from '../../../workers/work/crsTemplate/preview';
import { Button, Dialog, IconButton, TextField } from '../../../ui/components';
import { STATUS_KEYS } from '../../annotate/comments/statusLabels';
import { TYPE_KEYS } from '../../annotate/annotationTypes';
import { workClient } from '../../view/host';
import { SheetPreviewGrid, type PickMode } from './SheetPreviewGrid';
import { LOST_KEYS } from './templateLabels';
import { DETAIL_KEYS, FIELD_KEYS } from './templateSheets';
import { cancelSetup, saveSetup, useTemplateUi, type SetupSession } from './templateUi';

const STEP_KEYS: Record<SetupStep, MessageKey> = {
  sheet: msg('crs.setup.step.sheet'),
  details: msg('crs.setup.step.details'),
  columns: msg('crs.setup.step.columns'),
  comments: msg('crs.setup.step.comments'),
};

const STATUS_WORD_KEYS: Record<StatusWord, MessageKey> = {
  accepted: STATUS_KEYS.Accepted,
  rejected: STATUS_KEYS.Rejected,
  cancelled: STATUS_KEYS.Cancelled,
  completed: STATUS_KEYS.Completed,
  none: STATUS_KEYS.none,
};

const ZOOMS = [0.5, 0.75, 1, 1.25] as const;
const MAX_ZOOM = 1.25;

/** The guided set-up (C13) for the template being imported or edited. */
export function TemplateSetup() {
  const session = useTemplateUi((s) => s.setup);
  if (!session) return null;
  return <SetupWindow key={session.key} session={session} />;
}

type PreviewState =
  | { state: 'loading'; preview: SheetPreview | null }
  | { state: 'ready'; preview: SheetPreview }
  | { state: 'missing' | 'failed'; preview: null };

/** The sheet preview for the set-up, read in the Work worker (debounced, the last one wins). */
function usePreview(
  session: SetupSession,
  s: CrsTemplateSettings,
  lastPreDrawnOverride: number | null,
  onReady: (p: SheetPreview) => void,
): PreviewState {
  const [out, setOut] = useState<PreviewState>({ state: 'loading', preview: null });
  const ready = useRef(onReady);
  useEffect(() => {
    ready.current = onReady;
  });
  const placed = s.columns.flatMap((c) => (c.on && c.col !== null ? [c.col] : []));
  const columnsKey = placed.join(',');
  const needRow = Math.max(
    0,
    ...DETAIL_FIELDS.map((f) => {
      const a = s.details[f];
      return (a ? cellOf(a)?.row : undefined) ?? 0;
    }),
  );
  useEffect(() => {
    const ac = new AbortController();
    const timer = setTimeout(() => {
      const columns = columnsKey ? columnsKey.split(',').map(Number) : [];
      workClient()
        .run(
          'crsTemplatePreview',
          {
            key: session.key,
            bytes: session.workbook.slice(0),
            request: {
              sheet: s.sheet,
              needRow,
              probe:
                s.startRow >= 1
                  ? { startRow: s.startRow, columns, lastPreDrawn: lastPreDrawnOverride }
                  : null,
            },
          },
          { signal: ac.signal },
        )
        .promise.then((r) => {
          if (ac.signal.aborted) return;
          if (!r.ok) setOut({ state: 'failed', preview: null });
          else if (!r.preview) setOut({ state: 'missing', preview: null });
          else {
            setOut({ state: 'ready', preview: r.preview });
            ready.current(r.preview);
          }
        })
        .catch((err: unknown) => {
          if (ac.signal.aborted) return;
          recordError('crs.templatePreview', err);
          setOut({ state: 'failed', preview: null });
        });
    }, 120);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [
    session.key,
    session.workbook,
    s.sheet,
    s.startRow,
    needRow,
    columnsKey,
    lastPreDrawnOverride,
  ]);
  return out;
}

function SetupWindow({ session }: { session: SetupSession }) {
  const { t } = useTranslation();
  const ids = useId();
  const [s, setS] = useState<CrsTemplateSettings>(session.settings);
  const [name, setName] = useState(session.name);
  const [step, setStep] = useState<SetupStep>('sheet');
  const [target, setTarget] = useState<PlaceTarget | null>({ kind: 'start' });
  const [checked, setChecked] = useState<ReadonlySet<SetupStep>>(new Set());
  const [suggested, setSuggested] = useState<Suggested | null>(null);
  const [zoom, setZoom] = useState<number>(0.75);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [ownLast, setOwnLast] = useState(session.settings.lastPreDrawn !== null);
  // A fresh import: the first suggestions, once the first preview is in.
  const suggestedOnce = useRef(session.id !== null);
  const latest = useRef(s);
  useEffect(() => {
    latest.current = s;
  });
  const preview = usePreview(session, s, s.lastPreDrawn, (p) => {
    if (suggestedOnce.current) return;
    suggestedOnce.current = true;
    const r = applySuggestions(latest.current, p.cells);
    setS(r.settings);
    setSuggested(r.suggested);
  });
  const sheets = session.sheets.map((x) => x.name);
  const detected = preview.preview?.lastPreDrawn ?? null;
  const lastRow = s.lastPreDrawn ?? detected ?? (s.startRow || null);

  const goTo = (next: SetupStep) => {
    setChecked((c) => new Set([...c, step]));
    setStep(next);
    setTarget(firstTarget(s, next));
  };
  const issuesOf = (st: SetupStep) => stepIssues(s, st, sheets, lastRow);
  const stepIndex = SETUP_STEPS.indexOf(step);

  const onPick = (row: number, col: number) => {
    if (!target) return;
    const r = place(s, target, row, col);
    setS(r.settings);
    setTarget(r.next);
  };

  const save = async () => {
    const bad = firstStepWithIssue(s, sheets, lastRow);
    setChecked(new Set(SETUP_STEPS));
    if (bad) {
      setStep(bad);
      setTarget(firstTarget(s, bad));
      return;
    }
    setSaving(true);
    setSaveError(false);
    try {
      await saveSetup(name.trim() || session.name, s);
    } catch (err) {
      recordError('crs.templateSave', err);
      setSaveError(true);
      setSaving(false);
    }
  };

  const mode: PickMode =
    target === null
      ? 'none'
      : target.kind === 'start' || target.kind === 'last'
        ? 'row'
        : target.kind === 'detail'
          ? 'cell'
          : 'column';
  const active = ((): { row?: number; col?: number } | null => {
    if (!target) return null;
    if (target.kind === 'start') return s.startRow ? { row: s.startRow } : null;
    if (target.kind === 'last') return lastRow ? { row: lastRow } : null;
    if (target.kind === 'detail') {
      const a = s.details[target.field];
      const p = a ? cellOf(a) : null;
      return p ? { row: p.row, col: p.col } : null;
    }
    const col = s.columns[target.index]?.col ?? null;
    return col !== null ? { col } : null;
  })();
  const cMarks = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const [col, fields] of columnMarks(s))
      m.set(
        col,
        fields.map((f) => t(FIELD_KEYS[f])),
      );
    return m;
  }, [s, t]);
  const dMarks = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [k, fields] of detailMarks(s, cellOf))
      m.set(
        k,
        fields.map((f) => t(DETAIL_KEYS[f])),
      );
    return m;
  }, [s, t]);

  const hint = ((): string => {
    if (!target) return t('crs.setup.hint.none');
    switch (target.kind) {
      case 'start':
        return t('crs.setup.hint.start');
      case 'last':
        return t('crs.setup.hint.last');
      case 'detail':
        return t('crs.setup.hint.detail', { field: t(DETAIL_KEYS[target.field]) });
      case 'column': {
        const f = s.columns[target.index]?.field;
        return f ? t('crs.setup.hint.column', { field: t(FIELD_KEYS[f]) }) : '';
      }
    }
  })();

  const body: Record<SetupStep, () => ReactNode> = {
    sheet: () => (
      <SheetStep
        ids={ids}
        s={s}
        setS={setS}
        name={name}
        setName={setName}
        session={session}
        target={target}
        setTarget={setTarget}
        detected={detected}
        lastRow={lastRow}
        ownLast={ownLast}
        setOwnLast={setOwnLast}
        suggested={suggested?.start === true}
      />
    ),
    details: () => (
      <DetailsStep
        ids={ids}
        s={s}
        setS={setS}
        target={target}
        setTarget={setTarget}
        suggested={suggested?.details === true}
      />
    ),
    columns: () => (
      <ColumnsStep
        ids={ids}
        s={s}
        setS={setS}
        target={target}
        setTarget={setTarget}
        suggested={suggested?.columns === true}
      />
    ),
    comments: () => <CommentsStep ids={ids} s={s} setS={setS} />,
  };

  const issues = checked.has(step) ? issuesOf(step) : [];

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) cancelSetup();
      }}
      title={session.id ? t('crs.setup.editTitle') : t('crs.setup.title')}
      description={t('crs.setup.description')}
      closeIcon={<Dismiss20Regular />}
      className="crs-setup-dialog"
      footer={
        <>
          {saveError ? (
            <p className="print-error crs-setup-footnote" role="alert">
              {t('crs.setup.saveFailed')}
            </p>
          ) : null}
          <Button
            label={t('crs.setup.back')}
            disabled={stepIndex === 0 || saving}
            onClick={() => {
              const prev = SETUP_STEPS[stepIndex - 1];
              if (prev) goTo(prev);
            }}
          />
          {stepIndex < SETUP_STEPS.length - 1 ? (
            <Button
              label={t('crs.setup.next')}
              variant="primary"
              disabled={saving}
              onClick={() => {
                const next = SETUP_STEPS[stepIndex + 1];
                if (next) goTo(next);
              }}
            />
          ) : null}
          <Button
            label={t('crs.setup.save')}
            variant={stepIndex === SETUP_STEPS.length - 1 ? 'primary' : 'default'}
            disabled={saving}
            onClick={() => {
              void save();
            }}
          />
          <Button label={t('crs.setup.cancel')} disabled={saving} onClick={cancelSetup} />
        </>
      }
    >
      <div className="crs-setup" data-testid="crs-setup">
        <nav className="crs-setup-steps" aria-label={t('crs.setup.stepsName')}>
          <ol>
            {SETUP_STEPS.map((st, i) => {
              const bad = checked.has(st) && issuesOf(st).length > 0;
              const done = checked.has(st) && !bad;
              return (
                <li key={st}>
                  <button
                    type="button"
                    className="crs-setup-step"
                    aria-current={st === step ? 'step' : undefined}
                    onClick={() => {
                      goTo(st);
                    }}
                  >
                    <span className="crs-setup-step-no" aria-hidden="true">
                      {format.number(i + 1, 0)}
                    </span>
                    <span className="crs-setup-step-name">
                      <span className="ui-visually-hidden">
                        {t('crs.setup.stepNo', { n: format.number(i + 1, 0) })}
                      </span>
                      {t(STEP_KEYS[st])}
                    </span>
                    {bad ? (
                      <span className="crs-setup-step-state crs-setup-step-state--bad">
                        <Warning20Regular aria-hidden="true" />
                        <span className="ui-visually-hidden">{t('crs.setup.stepHasIssues')}</span>
                      </span>
                    ) : done ? (
                      <span className="crs-setup-step-state crs-setup-step-state--done">
                        <CheckmarkCircle20Regular aria-hidden="true" />
                        <span className="ui-visually-hidden">{t('crs.setup.stepDone')}</span>
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        <section
          className="crs-setup-panel"
          aria-labelledby={`${ids}-step-title`}
          data-testid={`crs-setup-step-${step}`}
        >
          <h3 id={`${ids}-step-title`} className="crs-setup-step-title">
            {t('crs.setup.stepName', {
              n: format.number(stepIndex + 1, 0),
              name: t(STEP_KEYS[step]),
            })}
          </h3>
          {body[step]()}
          {issues.length ? (
            <ul className="crs-setup-issues" role="alert">
              {issues.map((i, k) => (
                <li key={k}>{issueText(i)}</li>
              ))}
            </ul>
          ) : null}
        </section>
        <section className="crs-setup-preview" aria-label={t('crs.setup.previewName')}>
          <div className="crs-setup-preview-bar">
            <p className="crs-setup-hint" role="status" aria-live="polite">
              {hint}
            </p>
            <IconButton
              label={t('crs.setup.zoomOut')}
              icon={<ZoomOut20Regular />}
              disabled={zoom <= ZOOMS[0]}
              onClick={() => {
                setZoom((z) => [...ZOOMS].reverse().find((x) => x < z) ?? z);
              }}
            />
            <span className="crs-setup-zoom">{format.zoom(zoom)}</span>
            <IconButton
              label={t('crs.setup.zoomIn')}
              icon={<ZoomIn20Regular />}
              disabled={zoom >= MAX_ZOOM}
              onClick={() => {
                setZoom((z) => ZOOMS.find((x) => x > z) ?? z);
              }}
            />
          </div>
          <div className="crs-setup-sheet" data-testid="crs-preview">
            {preview.preview ? (
              <SheetPreviewGrid
                preview={preview.preview}
                mode={mode}
                label={t('crs.setup.gridName', { sheet: preview.preview.sheet })}
                startRow={s.startRow}
                lastPreDrawn={lastRow}
                columnMarks={cMarks}
                detailMarks={dMarks}
                active={active}
                zoom={zoom}
                onPick={onPick}
              />
            ) : (
              <p className="crs-setup-sheet-note" role="status">
                {preview.state === 'loading'
                  ? t('crs.setup.previewLoading')
                  : preview.state === 'missing'
                    ? t('crs.setup.previewMissing')
                    : t('crs.setup.previewFailed')}
              </p>
            )}
          </div>
          <ul className="crs-setup-legend" aria-label={t('crs.setup.legendName')}>
            <li>
              <span className="crs-legend-swatch crs-legend-swatch--start" aria-hidden="true" />
              {t('crs.setup.legend.start')}
            </li>
            <li>
              <span className="crs-legend-swatch crs-legend-swatch--predrawn" aria-hidden="true" />
              {s.startRow && lastRow && lastRow > s.startRow
                ? t('crs.setup.legend.predrawnRows', {
                    from: format.number(s.startRow + 1, 0),
                    to: format.number(lastRow, 0),
                  })
                : t('crs.setup.legend.predrawn')}
            </li>
            <li>
              <span className="crs-pv-chip crs-pv-chip--field" aria-hidden="true">
                {t('crs.setup.legend.fieldChip')}
              </span>
              {t('crs.setup.legend.field')}
            </li>
            <li>
              <span className="crs-pv-chip crs-pv-chip--detail" aria-hidden="true">
                {t('crs.setup.legend.detailChip')}
              </span>
              {t('crs.setup.legend.detail')}
            </li>
          </ul>
        </section>
      </div>
    </Dialog>
  );
}

const ISSUE_KEYS: Record<TemplateIssue['code'], MessageKey> = {
  'no-sheet': msg('crs.issue.noSheet'),
  'bad-start-row': msg('crs.issue.badStartRow'),
  'bad-last-row': msg('crs.issue.badLastRow'),
  'no-fields': msg('crs.issue.noFields'),
  'no-column': msg('crs.issue.noColumn'),
  'same-column': msg('crs.issue.sameColumn'),
  'bad-cell': msg('crs.issue.badCell'),
  'cell-in-table': msg('crs.issue.cellInTable'),
  'bad-rule': msg('crs.issue.badRule'),
};

function issueText(i: TemplateIssue): string {
  switch (i.code) {
    case 'no-column':
      return tr(ISSUE_KEYS[i.code], { field: tr(FIELD_KEYS[i.field]) });
    case 'same-column':
      return tr(ISSUE_KEYS[i.code], {
        column: columnLabel(i.col),
        fields: format.list(i.fields.map((f) => tr(FIELD_KEYS[f]))),
      });
    case 'bad-cell':
    case 'cell-in-table':
      return tr(ISSUE_KEYS[i.code], { field: tr(DETAIL_KEYS[i.detail]) });
    default:
      return tr(ISSUE_KEYS[i.code]);
  }
}

interface StepProps {
  ids: string;
  s: CrsTemplateSettings;
  setS: (f: (p: CrsTemplateSettings) => CrsTemplateSettings) => void;
}

interface PlaceProps extends StepProps {
  target: PlaceTarget | null;
  setTarget: (t: PlaceTarget) => void;
  suggested: boolean;
}

const sameTarget = (a: PlaceTarget | null, b: PlaceTarget): boolean =>
  a !== null && JSON.stringify(a) === JSON.stringify(b);

/** "Place by clicking the sheet" for one item: a radio in the step's group. */
function PickRadio(props: { name: string; label: string; checked: boolean; onPick: () => void }) {
  const { t } = useTranslation();
  return (
    <label className="crs-pick">
      <input
        type="radio"
        name={props.name}
        checked={props.checked}
        aria-label={t('crs.setup.pickNamed', { field: props.label })}
        onChange={props.onPick}
      />
      <span aria-hidden="true">{props.label}</span>
    </label>
  );
}

function Suggestion({ on }: { on: boolean }) {
  const { t } = useTranslation();
  return on ? <p className="crs-setup-suggested">{t('crs.setup.suggested')}</p> : null;
}

function SheetStep(
  p: PlaceProps & {
    name: string;
    setName: (n: string) => void;
    session: SetupSession;
    detected: number | null;
    lastRow: number | null;
    ownLast: boolean;
    setOwnLast: (b: boolean) => void;
  },
) {
  const { t } = useTranslation();
  const { s, setS } = p;
  const lost = p.session.lost;
  return (
    <div className="crs-setup-fields">
      <TextField
        label={t('crs.setup.name')}
        value={p.name}
        maxLength={MAX_NAME}
        onChange={(e) => {
          p.setName(e.currentTarget.value);
        }}
      />
      <p className="print-note">
        {t('crs.setup.fromFile', { file: p.session.fileName || p.name })}
      </p>
      {lost.length ? (
        <p className="crs-setup-warning" role="note">
          <Warning20Regular aria-hidden="true" />
          <span>
            {t('crs.setup.lost', { parts: format.list(lost.map((x) => t(LOST_KEYS[x]))) })}
          </span>
        </p>
      ) : null}
      <div className="ui-field">
        <label className="ui-field-label" htmlFor={`${p.ids}-sheet`}>
          {t('crs.setup.sheet')}
        </label>
        <select
          id={`${p.ids}-sheet`}
          className="ui-field-input"
          value={s.sheet}
          onChange={(e) => {
            const sheet = e.currentTarget.value;
            setS((x) => ({ ...x, sheet }));
          }}
        >
          {p.session.sheets.map((x) => (
            <option key={x.name} value={x.name}>
              {x.state === 'visible' ? x.name : t('crs.setup.hiddenSheet', { name: x.name })}
            </option>
          ))}
        </select>
        <p className="print-note">{t('crs.setup.sheetNote')}</p>
      </div>
      <fieldset className="crs-setup-group">
        <legend className="ui-field-label">{t('crs.setup.startRow')}</legend>
        <PickRadio
          name={`${p.ids}-target`}
          label={t('crs.setup.pickStart')}
          checked={sameTarget(p.target, { kind: 'start' })}
          onPick={() => {
            p.setTarget({ kind: 'start' });
          }}
        />
        <RowInput
          label={t('crs.setup.startRowNumber')}
          value={s.startRow}
          onFocus={() => {
            p.setTarget({ kind: 'start' });
          }}
          onChange={(row) => {
            setS((x) => ({
              ...x,
              startRow: row ?? 0,
              lastPreDrawn:
                x.lastPreDrawn !== null && row !== null && x.lastPreDrawn < row
                  ? null
                  : x.lastPreDrawn,
            }));
          }}
        />
        <Suggestion on={p.suggested} />
        <p className="print-note">{t('crs.setup.startNote')}</p>
      </fieldset>
      <fieldset className="crs-setup-group">
        <legend className="ui-field-label">{t('crs.setup.predrawn')}</legend>
        <p className="print-note" data-testid="crs-predrawn">
          {!s.startRow
            ? t('crs.setup.predrawnNeedsStart')
            : p.lastRow !== null && p.lastRow > s.startRow
              ? t('crs.setup.predrawnRows', {
                  from: format.number(s.startRow, 0),
                  to: format.number(p.lastRow, 0),
                  count: p.lastRow - s.startRow + 1,
                })
              : t('crs.setup.predrawnNone', { row: format.number(s.startRow, 0) })}
        </p>
        <label className="scale-radio">
          <input
            type="checkbox"
            checked={p.ownLast}
            disabled={!s.startRow}
            onChange={(e) => {
              const on = e.currentTarget.checked;
              p.setOwnLast(on);
              if (on) {
                setS((x) => ({ ...x, lastPreDrawn: p.detected ?? x.startRow }));
                p.setTarget({ kind: 'last' });
              } else {
                setS((x) => ({ ...x, lastPreDrawn: null }));
                p.setTarget({ kind: 'start' });
              }
            }}
          />
          {t('crs.setup.ownLast')}
        </label>
        {p.ownLast ? (
          <>
            <PickRadio
              name={`${p.ids}-target`}
              label={t('crs.setup.pickLast')}
              checked={sameTarget(p.target, { kind: 'last' })}
              onPick={() => {
                p.setTarget({ kind: 'last' });
              }}
            />
            <RowInput
              label={t('crs.setup.lastRowNumber')}
              value={s.lastPreDrawn ?? 0}
              onFocus={() => {
                p.setTarget({ kind: 'last' });
              }}
              onChange={(row) => {
                setS((x) => ({ ...x, lastPreDrawn: row }));
              }}
            />
          </>
        ) : null}
      </fieldset>
    </div>
  );
}

/** A row number typed in (empty = not set; anything else is kept until it is a row). */
function RowInput(props: {
  label: string;
  value: number;
  onFocus: () => void;
  onChange: (row: number | null) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(props.value ? String(props.value) : '');
  const [prev, setPrev] = useState(props.value);
  if (prev !== props.value) {
    // Set by a click on the preview: show it.
    setPrev(props.value);
    setText(props.value ? String(props.value) : '');
  }
  const n = Number(text);
  const bad = text.trim() !== '' && !(Number.isInteger(n) && n >= 1 && n <= MAX_ROW);
  return (
    <TextField
      label={props.label}
      inputMode="numeric"
      className="crs-setup-short"
      value={text}
      error={bad ? t('crs.setup.rowError') : undefined}
      onFocus={props.onFocus}
      onChange={(e) => {
        const v = e.currentTarget.value;
        setText(v);
        const k = Number(v);
        if (v.trim() === '') props.onChange(null);
        else if (Number.isInteger(k) && k >= 1 && k <= MAX_ROW) props.onChange(k);
      }}
    />
  );
}

function DetailsStep(p: PlaceProps) {
  const { t } = useTranslation();
  const { s, setS } = p;
  return (
    <div className="crs-setup-fields">
      <p className="print-note">{t('crs.setup.detailsNote')}</p>
      <Suggestion on={p.suggested} />
      <div className="crs-place-list" role="group" aria-label={t('crs.setup.step.details')}>
        {DETAIL_FIELDS.map((f) => (
          <DetailRow key={f} {...p} field={f} />
        ))}
      </div>
      <TextField
        label={t('crs.setup.fileNameRule')}
        value={s.fileNameRule}
        placeholder={t('crs.setup.fileNameRuleExample')}
        onChange={(e) => {
          const rule = e.currentTarget.value;
          setS((x) => ({ ...x, fileNameRule: rule }));
        }}
      />
      <p className="print-note">{t('crs.setup.fileNameRuleNote')}</p>
    </div>
  );
}

/** The detail cells with `field` set to `addr` ('' takes it off). */
function withDetail(
  details: Partial<Record<DetailField, string>>,
  field: DetailField,
  addr: string,
): Partial<Record<DetailField, string>> {
  const rest = Object.fromEntries(Object.entries(details).filter(([k]) => k !== field));
  return addr ? { ...rest, [field]: addr } : rest;
}

function DetailRow(p: PlaceProps & { field: DetailField }) {
  const { t } = useTranslation();
  const label = t(DETAIL_KEYS[p.field]);
  const addr = p.s.details[p.field] ?? '';
  const tgt: PlaceTarget = { kind: 'detail', field: p.field };
  return (
    <div className={`crs-place-row${sameTarget(p.target, tgt) ? ' crs-place-row--active' : ''}`}>
      <PickRadio
        name={`${p.ids}-target`}
        label={label}
        checked={sameTarget(p.target, tgt)}
        onPick={() => {
          p.setTarget(tgt);
        }}
      />
      <input
        className="ui-field-input crs-setup-cell"
        aria-label={t('crs.setup.cellFor', { field: label })}
        placeholder={t('crs.setup.cellPlaceholder')}
        value={addr}
        onFocus={() => {
          p.setTarget(tgt);
        }}
        onChange={(e) => {
          const v = e.currentTarget.value.trim().toUpperCase();
          p.setS((x) => ({ ...x, details: withDetail(x.details, p.field, v) }));
        }}
      />
      {addr ? (
        <IconButton
          size="small"
          label={t('crs.setup.clearNamed', { field: label })}
          icon={<Dismiss20Regular />}
          onClick={() => {
            p.setS((x) => ({ ...x, details: withDetail(x.details, p.field, '') }));
          }}
        />
      ) : null}
    </div>
  );
}

function ColumnsStep(p: PlaceProps) {
  const { t } = useTranslation();
  const { s } = p;
  const dup = new Set<number>();
  const seen = new Set<number>();
  for (const c of s.columns)
    if (c.on && c.col !== null) {
      if (seen.has(c.col)) dup.add(c.col);
      seen.add(c.col);
    }
  return (
    <div className="crs-setup-fields">
      <p className="print-note">{t('crs.setup.columnsNote')}</p>
      <Suggestion on={p.suggested} />
      <div className="crs-place-list" role="group" aria-label={t('crs.setup.step.columns')}>
        {s.columns.map((c, index) => (
          <ColumnRow
            key={`${c.field}-${String(index)}`}
            {...p}
            index={index}
            clash={c.on && c.col !== null && dup.has(c.col)}
          />
        ))}
      </div>
    </div>
  );
}

function ColumnRow(p: PlaceProps & { index: number; clash: boolean }) {
  const { t } = useTranslation();
  const c = p.s.columns[p.index];
  const col = c?.col ?? null;
  const [text, setText] = useState(col ? colLetters(col) : '');
  const [prev, setPrev] = useState(col);
  if (prev !== col) {
    // Placed by a click on the preview: show it.
    setPrev(col);
    setText(col ? colLetters(col) : '');
  }
  if (!c) return null;
  const label = t(FIELD_KEYS[c.field]);
  const tgt: PlaceTarget = { kind: 'column', index: p.index };
  const typed = text.trim();
  const bad = typed !== '' && columnOf(typed) === null;
  return (
    <div
      className={[
        'crs-place-row',
        'crs-place-row--column',
        sameTarget(p.target, tgt) ? 'crs-place-row--active' : '',
        p.clash ? 'crs-place-row--clash' : '',
      ].join(' ')}
    >
      <label className="crs-tick">
        <input
          type="checkbox"
          checked={c.on}
          aria-label={t('crs.setup.writeNamed', { field: label })}
          onChange={(e) => {
            const on = e.currentTarget.checked;
            if (on && c.col === null) p.setTarget(tgt);
            p.setS((x) => ({
              ...x,
              columns: x.columns.map((k, i) => (i === p.index ? { ...k, on } : k)),
            }));
          }}
        />
      </label>
      <PickRadio
        name={`${p.ids}-target`}
        label={label}
        checked={sameTarget(p.target, tgt)}
        onPick={() => {
          p.setTarget(tgt);
        }}
      />
      <input
        className="ui-field-input crs-setup-col"
        aria-label={t('crs.setup.columnFor', { field: label })}
        aria-invalid={bad || p.clash ? true : undefined}
        placeholder={t('crs.setup.columnPlaceholder')}
        value={text}
        onFocus={() => {
          p.setTarget(tgt);
        }}
        onChange={(e) => {
          const v = e.currentTarget.value;
          setText(v);
          const typedCol = v.trim() === '' ? null : columnOf(v.trim());
          if (v.trim() !== '' && typedCol === null) return;
          setPrev(typedCol);
          p.setS((x) =>
            typedCol === null
              ? unplaceColumn(x, p.index)
              : {
                  ...x,
                  columns: x.columns.map((k, i) =>
                    i === p.index ? { ...k, col: typedCol, on: true } : k,
                  ),
                },
          );
        }}
      />
      <span className="crs-setup-col-label" aria-hidden="true">
        {c.col !== null ? columnLabel(c.col) : ''}
      </span>
      {c.field === 'fixed' ? (
        <input
          className="ui-field-input crs-setup-fixed"
          aria-label={t('crs.setup.fixedText')}
          placeholder={t('crs.setup.fixedText')}
          value={c.text ?? ''}
          onChange={(e) => {
            const v = e.currentTarget.value;
            p.setS((x) => ({
              ...x,
              columns: x.columns.map((k, i) => (i === p.index ? { ...k, text: v } : k)),
            }));
          }}
        />
      ) : null}
    </div>
  );
}

function CommentsStep(p: StepProps) {
  const { t } = useTranslation();
  const { s, setS } = p;
  const snapshotOn = s.columns.some((c) => c.field === 'snapshot' && c.on);
  const [px, setPx] = useState(String(s.snapshotMaxPx));
  return (
    <div className="crs-setup-fields">
      <fieldset className="crs-setup-group">
        <legend className="ui-field-label">{t('crs.setup.types')}</legend>
        <p className="print-note">{t('crs.setup.typesNote')}</p>
        <div className="crs-setup-row">
          <Button
            size="small"
            label={t('crs.setup.typesAll')}
            onClick={() => {
              setS((x) => ({
                ...x,
                types: Object.fromEntries(CRS_TYPES.map((k) => [k, true])) as typeof x.types,
              }));
            }}
          />
          <Button
            size="small"
            label={t('crs.setup.typesNone')}
            onClick={() => {
              setS((x) => ({
                ...x,
                types: Object.fromEntries(CRS_TYPES.map((k) => [k, false])) as typeof x.types,
              }));
            }}
          />
        </div>
        <div className="crs-setup-types">
          {CRS_TYPES.map((k) => (
            <label key={k} className="scale-radio">
              <input
                type="checkbox"
                checked={s.types[k]}
                onChange={(e) => {
                  const on = e.currentTarget.checked;
                  setS((x) => ({ ...x, types: { ...x.types, [k]: on } }));
                }}
              />
              {t(TYPE_KEYS[k])}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="scale-radio">
        <input
          type="checkbox"
          checked={s.ignoreHighlights}
          onChange={(e) => {
            const on = e.currentTarget.checked;
            setS((x) => ({ ...x, ignoreHighlights: on }));
          }}
        />
        {t('crs.setup.ignoreHighlights')}
      </label>
      <fieldset className="crs-setup-group">
        <legend className="ui-field-label">{t('crs.setup.statusWords')}</legend>
        <p className="print-note">{t('crs.setup.statusWordsNote')}</p>
        <div className="crs-setup-status">
          {STATUS_WORDS.map((w) => (
            <TextField
              key={w}
              label={t(STATUS_WORD_KEYS[w])}
              value={s.status[w]}
              maxLength={200}
              onChange={(e) => {
                const v = e.currentTarget.value;
                setS((x) => ({ ...x, status: { ...x.status, [w]: v } }));
              }}
            />
          ))}
        </div>
      </fieldset>
      {snapshotOn ? (
        <TextField
          label={t('crs.setup.snapshotMax', {
            min: format.number(SNAPSHOT_MIN_PX, 0),
            max: format.number(SNAPSHOT_MAX_PX, 0),
          })}
          inputMode="numeric"
          className="crs-setup-short"
          value={px}
          error={
            Number(px) >= SNAPSHOT_MIN_PX && Number(px) <= SNAPSHOT_MAX_PX
              ? undefined
              : t('crs.setup.snapshotMaxError')
          }
          onChange={(e) => {
            const v = e.currentTarget.value;
            setPx(v);
            const n = Math.round(Number(v));
            if (n >= SNAPSHOT_MIN_PX && n <= SNAPSHOT_MAX_PX)
              setS((x) => ({ ...x, snapshotMaxPx: n }));
          }}
        />
      ) : null}
      <label className="scale-radio">
        <input
          type="checkbox"
          checked={s.sheetPerPage}
          onChange={(e) => {
            const on = e.currentTarget.checked;
            setS((x) => ({ ...x, sheetPerPage: on }));
          }}
        />
        {t('crs.setup.sheetPerPage')}
      </label>
    </div>
  );
}
