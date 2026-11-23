import { ArrowDown20Regular } from '@fluentui/react-icons/svg/arrow-down';
import { ArrowUp20Regular } from '@fluentui/react-icons/svg/arrow-up';
import { Checkmark16Filled } from '@fluentui/react-icons/svg/checkmark';
import {
  CheckmarkCircle20Filled,
  CheckmarkCircle20Regular,
} from '@fluentui/react-icons/svg/checkmark-circle';
import { Dismiss16Regular } from '@fluentui/react-icons/svg/dismiss';
import type { TFunction } from 'i18next';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { documentStore } from '../../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../../i18n';
import {
  DIFF_KINDS,
  DIFF_TYPES,
  SENSITIVITIES,
  type DiffKind,
  type DiffType,
  type Sensitivity,
} from '../../../model/compare/detect/entries';
import { Button, DropdownMenu, IconButton, ToggleButton } from '../../../ui/components';
import { announceTransfer } from '../../annotate/transfer/transferAnnounce';
import { goSheet, updateView, type Sheet } from '../overlay/overlayState';
import { focusOverlay } from '../review/overlayFocus';
import {
  countEntries,
  scopedEntries,
  shownEntries,
  stepFrom,
  toggleChecked,
  updateDiff,
  useDiffView,
  type ShownEntry,
} from './diffState';
import { makeClouds } from './makeClouds';

/** Next difference; with Shift, the previous one (as in a text comparison: F8, Shift+F8). */
const NEXT_KEY = 'F8';
const NEXT_KEYS = 'F8';
const PREV_KEYS = 'Shift+F8';
const SCOPES = ['all', 'sheet'] as const;
const SCOPE_LABEL: Record<(typeof SCOPES)[number], MessageKey> = {
  all: msg('compare.diff.scope_all'),
  sheet: msg('compare.diff.scope_sheet'),
};
const CLOUD_ITEMS = { selected: 'selected', shown: 'shown' } as const;
const OVERSCAN = 8;
/** One row's height (CSS px); only the rows in view are drawn. */
const DIFF_ROW_HEIGHT = 60;

/** Minimum sizes offered (mm; 0 = every difference). */
const MIN_SIZES = [0, 0.5, 1, 2, 5, 10] as const;

const SENSITIVITY_LABEL: Record<Sensitivity, MessageKey> = {
  low: msg('compare.diff.sensitivity_low'),
  normal: msg('compare.diff.sensitivity_normal'),
  high: msg('compare.diff.sensitivity_high'),
};

const KIND_LABEL: Record<DiffKind, MessageKey> = {
  added: msg('compare.diff.kind_added'),
  removed: msg('compare.diff.kind_removed'),
  changed: msg('compare.diff.kind_changed'),
};

const TYPE_LABEL: Record<DiffType, MessageKey> = {
  text: msg('compare.diff.type_text'),
  geometry: msg('compare.diff.type_geometry'),
  both: msg('compare.diff.type_both'),
};

/** "Sheet 2 · Changed · text" and the words: the entry's accessible name. */
function entryName(t: TFunction, e: ShownEntry): string {
  const x = e.entry;
  return [
    t('compare.overlay.sheetName', { sheet: format.number(e.sheet + 1) }),
    t(KIND_LABEL[x.kind]),
    t(TYPE_LABEL[x.type]),
    x.old && x.new ? `${x.old} → ${x.new}` : x.old || x.new,
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * The differences of an overlay comparison (M12-14, D-61, Q17, Q22, Q23): the
 * detection settings applied live, the list with its filters, search on Enter
 * (rule 3), next and previous (F8, Shift+F8), the checked tick, and Make
 * cloud comments. A listbox: arrows move, the entry in use is shown on the
 * overlay, Space ticks it. Only the rows in view are drawn.
 */
export function DiffPane({
  id,
  sheets,
  current,
}: {
  id: string;
  sheets: readonly Sheet[];
  current: number;
}) {
  const { t } = useTranslation();
  const view = useDiffView(id);
  const headingId = useId();
  const listId = useId();
  const sensId = useId();
  const minId = useId();
  const scopeId = useId();
  const [query, setQuery] = useState(view.filter.query);
  const [notice, setNotice] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 400 });

  const scoped = useMemo(() => scopedEntries(view, sheets, current), [view, sheets, current]);
  const shown = useMemo(() => shownEntries(view, sheets, current), [view, sheets, current]);
  const counts = useMemo(() => countEntries(scoped), [scoped]);
  const checked = useMemo(() => new Set(view.checked), [view.checked]);
  const paired = sheets.filter((s) => s.pair !== null);
  const detected = paired.filter((s) => s.pair !== null && view.results[s.pair]).length;

  const select = (e: ShownEntry): void => {
    const other = e.sheet !== current;
    updateDiff(id, (v) => ({ ...v, selected: e.id }));
    if (other) updateView(id, (v) => goSheet(v, e.sheet, sheets.length));
    focusOverlay(id, e.entry.box, other);
  };
  const step = (dir: 1 | -1): void => {
    const to = stepFrom(shown, view.selected, dir);
    if (to) select(to);
  };

  // F8 / Shift+F8: next and previous difference while this comparison is the tab in use.
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  });
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== NEXT_KEY || e.ctrlKey || e.altKey || e.metaKey) return;
      if (documentStore.getState().activeTab !== id) return;
      e.preventDefault();
      stepRef.current(e.shiftKey ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [id]);

  // The rows in view, and the entry in use kept in view.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const read = (): void => {
      setScroll({ top: el.scrollTop, height: el.clientHeight });
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    el.addEventListener('scroll', read, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', read);
    };
  }, []);
  const at = view.selected === null ? -1 : shown.findIndex((e) => e.id === view.selected);
  useEffect(() => {
    const el = scroller.current;
    if (!el || at < 0) return;
    const top = at * DIFF_ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + DIFF_ROW_HEIGHT > el.scrollTop + el.clientHeight)
      el.scrollTop = top + DIFF_ROW_HEIGHT - el.clientHeight;
  }, [at]);
  const first = Math.max(0, Math.floor(scroll.top / DIFF_ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(
    shown.length,
    Math.ceil((scroll.top + scroll.height) / DIFF_ROW_HEIGHT) + OVERSCAN,
  );
  const optionId = (k: number): string => `${listId}-e${String(k)}`;

  const onListKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (shown.length === 0) return;
    const page = Math.max(1, Math.floor(scroll.height / DIFF_ROW_HEIGHT));
    const moves: Record<string, number> = {
      ArrowDown: 1,
      ArrowUp: -1,
      PageDown: page,
      PageUp: -page,
    };
    let to: number | undefined;
    if (e.key in moves) to = Math.min(shown.length - 1, Math.max(0, at + (moves[e.key] ?? 0)));
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = shown.length - 1;
    else if (e.key === ' ' && view.selected !== null) {
      e.preventDefault();
      const sel = view.selected;
      updateDiff(id, (v) => toggleChecked(v, sel));
      return;
    } else if (e.key === 'Enter' && at >= 0) {
      e.preventDefault();
      const cur = shown[at];
      if (cur) select(cur);
      return;
    }
    if (to === undefined) return;
    e.preventDefault();
    const entry = shown[to];
    if (entry) select(entry);
  };

  const applySearch = (q: string): void => {
    updateDiff(id, (v) => ({ ...v, filter: { ...v.filter, query: q } }));
  };

  const clouds = (which: 'selected' | 'shown'): void => {
    const sel = shown.find((e) => e.id === view.selected);
    const list = which === 'selected' ? (sel ? [sel] : []) : shown;
    if (!list.length) return;
    const r = makeClouds(list, sheets);
    if ('blocked' in r) {
      setNotice(t('compare.diff.cloudsBlocked', { name: r.blocked }));
      return;
    }
    const text = t('compare.diff.cloudsMade', { count: r.made });
    setNotice(text);
    for (const d of r.docs) announceTransfer(d, text);
  };

  const selectedEntry = shown.find((e) => e.id === view.selected) ?? null;

  return (
    <aside className="overlay-diffs" aria-labelledby={headingId} data-testid="diff-pane">
      <div className="text-list-head">
        <h3 id={headingId} className="overlay-side-title">
          {t('compare.diff.title')}
        </h3>
        <span
          className="text-list-count"
          data-testid="diff-count"
          data-count={scoped.length}
          data-shown={shown.length}
          data-detected={detected}
        >
          {detected < paired.length
            ? t('compare.diff.finding', {
                done: format.number(detected),
                count: format.number(paired.length),
              })
            : shown.length === scoped.length
              ? t('compare.diff.count', { count: scoped.length })
              : t('compare.diff.shown', {
                  shown: format.number(shown.length),
                  count: format.number(scoped.length),
                })}
        </span>
      </div>

      <div className="overlay-diff-settings" role="group" aria-label={t('compare.diff.settings')}>
        <div className="overlay-diff-field">
          <label htmlFor={sensId} className="ui-field-label">
            {t('compare.diff.sensitivity')}
          </label>
          <select
            id={sensId}
            className="ui-field-input"
            data-testid="diff-sensitivity"
            value={view.sensitivity}
            onChange={(e) => {
              const s = e.currentTarget.value as Sensitivity;
              updateDiff(id, (v) => ({ ...v, sensitivity: s }));
            }}
          >
            {SENSITIVITIES.map((s) => (
              <option key={s} value={s}>
                {t(SENSITIVITY_LABEL[s])}
              </option>
            ))}
          </select>
        </div>
        <div className="overlay-diff-field">
          <label htmlFor={minId} className="ui-field-label">
            {t('compare.diff.minSize')}
          </label>
          <select
            id={minId}
            className="ui-field-input"
            data-testid="diff-min-size"
            value={String(view.minSize)}
            onChange={(e) => {
              const mm = Number(e.currentTarget.value);
              updateDiff(id, (v) => ({ ...v, minSize: mm }));
            }}
          >
            {MIN_SIZES.map((mm) => (
              <option key={mm} value={String(mm)}>
                {mm === 0
                  ? t('compare.diff.minSize_off')
                  : t('compare.diff.minSize_mm', { size: format.number(mm, 1) })}
              </option>
            ))}
          </select>
        </div>
        <label className="overlay-check">
          <input
            type="checkbox"
            className="ui-focusable"
            data-testid="diff-outlines"
            checked={view.outlines}
            onChange={(e) => {
              const on = e.currentTarget.checked;
              updateDiff(id, (v) => ({ ...v, outlines: on }));
            }}
          />
          <span>{t('compare.diff.outlines')}</span>
        </label>
      </div>

      <div className="overlay-diff-filters" role="group" aria-label={t('compare.diff.filters')}>
        <div className="overlay-diff-scope">
          <label htmlFor={scopeId} className="ui-field-label">
            {t('compare.diff.scope')}
          </label>
          <select
            id={scopeId}
            className="ui-field-input"
            data-testid="diff-scope"
            value={view.filter.scope}
            onChange={(e) => {
              const scope = e.currentTarget.value as (typeof SCOPES)[number];
              updateDiff(id, (v) => ({ ...v, filter: { ...v.filter, scope } }));
            }}
          >
            {SCOPES.map((k) => (
              <option key={k} value={k}>
                {t(SCOPE_LABEL[k])}
              </option>
            ))}
          </select>
        </div>
        <div className="overlay-diff-chips">
          {DIFF_KINDS.map((k) => (
            <label key={k} className="overlay-diff-chip" data-kind={k}>
              <input
                type="checkbox"
                className="ui-focusable"
                data-testid={`diff-kind-${k}`}
                aria-label={t('compare.diff.showKind', {
                  kind: t(KIND_LABEL[k]),
                  count: format.number(counts.kinds[k]),
                })}
                checked={view.filter.kinds[k]}
                onChange={(e) => {
                  const on = e.currentTarget.checked;
                  updateDiff(id, (v) => ({
                    ...v,
                    filter: { ...v.filter, kinds: { ...v.filter.kinds, [k]: on } },
                  }));
                }}
              />
              <span>{t(KIND_LABEL[k])}</span>
              <span className="text-legend-count">{format.number(counts.kinds[k])}</span>
            </label>
          ))}
        </div>
        <div className="overlay-diff-chips">
          {DIFF_TYPES.map((k) => (
            <label key={k} className="overlay-diff-chip">
              <input
                type="checkbox"
                className="ui-focusable"
                data-testid={`diff-type-${k}`}
                aria-label={t('compare.diff.showType', {
                  type: t(TYPE_LABEL[k]),
                  count: format.number(counts.types[k]),
                })}
                checked={view.filter.types[k]}
                onChange={(e) => {
                  const on = e.currentTarget.checked;
                  updateDiff(id, (v) => ({
                    ...v,
                    filter: { ...v.filter, types: { ...v.filter.types, [k]: on } },
                  }));
                }}
              />
              <span>{t(TYPE_LABEL[k])}</span>
              <span className="text-legend-count">{format.number(counts.types[k])}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="text-list-tools">
        <div className="text-search">
          <input
            type="search"
            className="ui-input ui-focusable text-search-input"
            aria-label={t('compare.diff.search')}
            placeholder={t('compare.diff.searchHint')}
            data-testid="diff-search"
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applySearch(query);
              } else if (e.key === 'Escape' && query) {
                e.preventDefault();
                setQuery('');
                applySearch('');
              }
            }}
          />
          {view.filter.query ? (
            <IconButton
              label={t('compare.diff.clearSearch')}
              icon={<Dismiss16Regular />}
              size="small"
              onClick={() => {
                setQuery('');
                applySearch('');
              }}
            />
          ) : null}
        </div>
        <div className="text-list-nav">
          <IconButton
            label={t('compare.diff.previous')}
            icon={<ArrowUp20Regular />}
            aria-keyshortcuts={PREV_KEYS}
            disabled={shown.length === 0}
            onClick={() => {
              step(-1);
            }}
          />
          <IconButton
            label={t('compare.diff.next')}
            icon={<ArrowDown20Regular />}
            aria-keyshortcuts={NEXT_KEYS}
            disabled={shown.length === 0}
            onClick={() => {
              step(1);
            }}
          />
          <ToggleButton
            label={t('compare.diff.checkThis')}
            iconOnly
            icon={<CheckmarkCircle20Regular />}
            pressedIcon={<CheckmarkCircle20Filled />}
            disabled={view.selected === null}
            pressed={view.selected !== null && checked.has(view.selected)}
            onPressedChange={() => {
              const sel = view.selected;
              if (sel !== null) updateDiff(id, (v) => toggleChecked(v, sel));
            }}
          />
          <label className="text-hide-checked">
            <input
              type="checkbox"
              className="ui-focusable"
              checked={view.filter.hideChecked}
              onChange={(e) => {
                const on = e.currentTarget.checked;
                updateDiff(id, (v) => ({ ...v, filter: { ...v.filter, hideChecked: on } }));
              }}
            />
            <span>{t('compare.diff.hideChecked')}</span>
          </label>
        </div>
      </div>

      {shown.length === 0 ? (
        // No listbox without options (axe): the reason stands in its place.
        <div ref={scroller} className="text-list-rows" data-testid="diff-list">
          <p className="text-list-empty" role="status">
            {detected < paired.length
              ? t('compare.diff.waiting')
              : scoped.length === 0
                ? t('compare.diff.none')
                : t('compare.diff.noneShown')}
          </p>
        </div>
      ) : (
        <div
          ref={scroller}
          className="text-list-rows"
          role="listbox"
          aria-label={t('compare.diff.listName')}
          aria-activedescendant={at >= first && at < last && at >= 0 ? optionId(at) : undefined}
          tabIndex={0}
          data-testid="diff-list"
          onKeyDown={onListKey}
        >
          <div
            style={{ height: `${String(shown.length * DIFF_ROW_HEIGHT)}px`, position: 'relative' }}
          >
            {shown.slice(first, last).map((e, k) => {
              const row = first + k;
              const x = e.entry;
              const isChecked = checked.has(e.id);
              const name = entryName(t, e);
              return (
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- the listbox handles the keys
                <div
                  key={e.id}
                  id={optionId(row)}
                  role="option"
                  aria-selected={e.id === view.selected}
                  aria-label={isChecked ? t('compare.diff.entryChecked', { label: name }) : name}
                  tabIndex={-1}
                  className="text-entry overlay-diff-entry"
                  data-kind={x.kind}
                  data-type={x.type}
                  data-id={e.id}
                  data-checked={isChecked || undefined}
                  style={{
                    top: `${String(row * DIFF_ROW_HEIGHT)}px`,
                    height: `${String(DIFF_ROW_HEIGHT)}px`,
                  }}
                  onClick={() => {
                    select(e);
                  }}
                >
                  <span className="text-entry-head">
                    <span className="text-entry-kind">{t(KIND_LABEL[x.kind])}</span>
                    <span className="text-entry-pages">
                      {t('compare.overlay.sheetName', { sheet: format.number(e.sheet + 1) })}
                      {' · '}
                      {t(TYPE_LABEL[x.type])}
                    </span>
                    {isChecked ? (
                      <span className="text-entry-check" aria-hidden="true">
                        <Checkmark16Filled />
                      </span>
                    ) : null}
                  </span>
                  <span className="text-entry-texts">
                    {x.old || x.new ? (
                      <>
                        {x.old ? <del className="text-entry-old">{x.old}</del> : null}
                        {x.new ? <ins className="text-entry-new">{x.new}</ins> : null}
                      </>
                    ) : (
                      <span className="text-entry-old">{t('compare.diff.region')}</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="overlay-diff-actions">
        <DropdownMenu
          trigger={
            <Button label={t('compare.diff.clouds')} size="small" disabled={shown.length === 0} />
          }
          entries={[
            {
              id: CLOUD_ITEMS.selected,
              label: t('compare.diff.cloudsSelected'),
              disabled: selectedEntry === null,
              onSelect: () => {
                clouds('selected');
              },
            },
            {
              id: CLOUD_ITEMS.shown,
              label: t('compare.diff.cloudsShown', { count: shown.length }),
              onSelect: () => {
                clouds('shown');
              },
            },
          ]}
        />
        <p className="overlay-diff-notice" role="status" data-testid="diff-notice">
          {notice ?? ''}
        </p>
      </div>
    </aside>
  );
}
