import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../../app/store/documentStore';
import { format, t as tGlobal } from '../../../i18n';
import {
  entryText,
  groupMeasurements,
  sumText,
  type MeasureEntry,
  type MeasureGroup,
} from '../../../model/measureList';
import { objectsOf, useAnnotationMap } from '../../annotate/comments/commentsStore';
import { useSelectedAnnotations } from '../../annotate/selection';
import { TOOL_SUBJECT } from '../measurements';
import { loadScales, useScales } from '../scaleStore';
import {
  measureEntries,
  setPaneScope,
  showMeasurement,
  useMeasurePane,
  type PaneScope,
} from './measureEntries';
import { ScalesSection } from './ScalesSection';

const SCOPES: readonly PaneScope[] = ['page', 'all'];

/**
 * The Measurements pane (M14-08, D-76, ADR-035, plan M14 §8): the document's
 * measurements grouped by tool with a total per group, for This page or All
 * pages; each row's value, label, page and scale, and its flags (spans two
 * scales: no number, out of the totals, Q30; paper size, Q29). A click or
 * Enter on a row shows the measurement on its page and selects it. The list is
 * one tab stop (arrows move, rule 12, Q36); the Scales section follows.
 */
export function MeasurementsPane() {
  const { t } = useTranslation();
  const docId = useDocuments((s) => s.activeId);
  const page = useDocuments((s) => (docId ? (s.docs[docId]?.view.page ?? 0) : 0));
  const byUid = useAnnotationMap(docId);
  const scales = useScales((s) => (docId ? s.docs[docId] : undefined));
  const scope = useMeasurePane((s) => s.scope);
  const ids = useId();

  useEffect(() => {
    if (docId) void loadScales(docId);
  }, [docId]);

  // Values follow the markups and the page scales (both already in memory).
  const entries = useMemo(
    () =>
      docId && byUid && scales && scales !== 'loading'
        ? measureEntries(docId, objectsOf(byUid))
        : null,
    [docId, byUid, scales],
  );
  const groups = useMemo(
    () => (entries ? groupMeasurements(entries, scope === 'page' ? { page } : {}) : []),
    [entries, scope, page],
  );

  if (!docId) return <p className="pane-empty">{t('measurements.noDocument')}</p>;
  const shown = groups.reduce((n, g) => n + g.entries.length, 0);
  return (
    <div className="measurements-pane" data-testid="measurements-pane">
      <fieldset className="mpane-scope">
        <legend className="ui-visually-hidden">{t('measurements.scope')}</legend>
        {SCOPES.map((v: PaneScope) => (
          <label key={v} className="mpane-scope-option">
            <input
              type="radio"
              name={`${ids}-scope`}
              checked={scope === v}
              onChange={() => {
                setPaneScope(v);
              }}
            />
            {v === 'page' ? t('measurements.thisPage') : t('measurements.allPages')}
          </label>
        ))}
      </fieldset>
      {entries === null ? (
        <p className="pane-empty" role="status">
          {t('measurements.loading')}
        </p>
      ) : shown === 0 ? (
        <p className="pane-empty" data-pane-focus tabIndex={-1}>
          {entries.length === 0 ? t('measurements.none') : t('measurements.noneOnPage')}
        </p>
      ) : (
        <MeasureList docId={docId} groups={groups} />
      )}
      <p className="measurements-count" role="status">
        {entries && shown > 0
          ? t('measurements.count', { count: shown, n: format.number(shown, 0) })
          : ''}
      </p>
      <ScalesSection docId={docId} page={page} scope={scope} />
    </div>
  );
}

/** "Total 3.50 m", "At paper size 35.0 mm", "1 not in the total (spans 2 scales)". */
function totalLines(g: MeasureGroup): string[] {
  const t = tGlobal;
  const out: string[] = [];
  const { real, paper, left } = g.total;
  if (real) out.push(t('measurements.total', { value: sumText(real, g.quantity, format) }));
  if (paper) out.push(t('measurements.paperTotal', { value: sumText(paper, g.quantity, format) }));
  if (left) out.push(t('measurements.leftOut', { count: left, n: format.number(left, 0) }));
  return out;
}

function MeasureList({ docId, groups }: { docId: string; groups: readonly MeasureGroup[] }) {
  const { t } = useTranslation();
  const listId = useId();
  const order = useMemo(() => groups.flatMap((g) => g.entries), [groups]);
  const selected = useSelectedAnnotations(docId);
  const selectedIds = useMemo(() => new Set(selected.map((a) => a.id)), [selected]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // The active row: the one moved to, else the first selected, else the first.
  const active = Math.max(
    0,
    order.findIndex((e) => e.id === activeId) >= 0
      ? order.findIndex((e) => e.id === activeId)
      : order.findIndex((e) => selectedIds.has(e.id)),
  );
  const activeEntry = order[active];
  const optionId = (e: MeasureEntry): string => `${listId}-${e.id}`;

  // A measurement selected on the page scrolls into view here.
  const firstSelected = order.find((e) => selectedIds.has(e.id))?.id ?? null;
  useEffect(() => {
    if (!firstSelected) return;
    document.getElementById(`${listId}-${firstSelected}`)?.scrollIntoView({ block: 'nearest' });
  }, [firstSelected, listId]);

  const moveTo = (i: number): void => {
    const e = order[Math.min(Math.max(0, i), order.length - 1)];
    if (!e) return;
    setActiveId(e.id);
    document.getElementById(optionId(e))?.scrollIntoView({ block: 'nearest' });
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const keys: Record<string, () => void> = {
      ArrowDown: () => {
        moveTo(active + 1);
      },
      ArrowUp: () => {
        moveTo(active - 1);
      },
      Home: () => {
        moveTo(0);
      },
      End: () => {
        moveTo(order.length - 1);
      },
      Enter: () => {
        if (activeEntry) showMeasurement(docId, activeEntry.id);
      },
      ' ': () => {
        if (activeEntry) showMeasurement(docId, activeEntry.id);
      },
    };
    const action = keys[e.key];
    if (!action) return;
    e.preventDefault();
    action();
  };

  return (
    <div
      className="mpane-list"
      role="listbox"
      tabIndex={0}
      aria-label={t('measurements.list')}
      aria-describedby={`${listId}-hint`}
      {...(activeEntry ? { 'aria-activedescendant': optionId(activeEntry) } : {})}
      data-testid="measure-list"
      data-pane-focus
      onKeyDown={onKeyDown}
      onClick={(ev) => {
        // A row's click (the list holds the keys, so the rows need no handlers of their own).
        const id = (ev.target as HTMLElement).closest<HTMLElement>('[data-entry]')?.dataset[
          'entry'
        ];
        if (!id) return;
        setActiveId(id);
        showMeasurement(docId, id);
      }}
    >
      {groups.map((g) => {
        const name = t(TOOL_SUBJECT[g.tool]);
        const totals = totalLines(g);
        const count = format.number(g.entries.length, 0);
        return (
          <div
            key={g.key}
            role="group"
            className="mpane-group"
            aria-label={t('measurements.groupName', {
              name,
              count: g.entries.length,
              n: count,
              totals: totals.join(', '),
            })}
            data-testid={`measure-group-${g.key}`}
          >
            <div className="mpane-group-head" aria-hidden="true">
              <span className="mpane-group-name">
                {name} <span className="mpane-group-count">{count}</span>
              </span>
              <span className="mpane-group-totals">
                {totals.map((line) => (
                  <span key={line} className="mpane-group-total">
                    {line}
                  </span>
                ))}
              </span>
            </div>
            {g.entries.map((e) => (
              <MeasureRow
                key={e.id}
                id={optionId(e)}
                entry={e}
                selected={selectedIds.has(e.id)}
                active={e === activeEntry}
              />
            ))}
          </div>
        );
      })}
      <span id={`${listId}-hint`} hidden>
        {t('measurements.listHint')}
      </span>
    </div>
  );
}

function MeasureRow({
  id,
  entry: e,
  selected,
  active,
}: {
  id: string;
  entry: MeasureEntry;
  selected: boolean;
  active: boolean;
}) {
  const { t } = useTranslation();
  const value = entryText(e, format);
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      className={`mpane-row${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}`}
      data-testid="measure-row"
      data-entry={e.id}
    >
      <span className="mpane-row-value">
        {e.label ? <span className="mpane-row-label">{e.label}</span> : null}
        <span className={value === null ? 'mpane-row-number is-none' : 'mpane-row-number'}>
          {value ?? t('measurements.noValue')}
        </span>
      </span>
      <span className="mpane-row-meta">
        {t('measurements.where', { page: format.number(e.page + 1, 0), where: e.where })}
      </span>
      {e.spans || e.paper ? (
        <span className="mpane-row-flags">
          {e.spans ? (
            <span className="mpane-flag mpane-flag--warning">
              {t('measurements.flag.spans', {
                count: e.spans.length,
                n: format.number(e.spans.length, 0),
              })}
            </span>
          ) : null}
          {e.paper && !e.spans ? (
            <span className="mpane-flag">{t('measurements.flag.paper')}</span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
