import { ArrowDown20Regular } from '@fluentui/react-icons/svg/arrow-down';
import { ArrowUp20Regular } from '@fluentui/react-icons/svg/arrow-up';
import { Checkmark16Filled } from '@fluentui/react-icons/svg/checkmark';
import {
  CheckmarkCircle20Filled,
  CheckmarkCircle20Regular,
} from '@fluentui/react-icons/svg/checkmark-circle';
import { Dismiss16Regular } from '@fluentui/react-icons/svg/dismiss';
import type { TFunction } from 'i18next';
import { memo, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { format, msg, type MessageKey } from '../../../i18n';
import type { TextChange, TextChangeKind } from '../../../model/compare/text/match';
import {
  MARK_STYLES,
  colourOf,
  countByStyle,
  type ChangeEntry,
  type MarkStyle,
} from '../../../model/compare/textView';
import { ColorPicker, IconButton, ToggleButton } from '../../../ui/components';
import { changeKey, setColour, updateTextView, useTextView, useTextViewPart } from './textFlow';

const NEXT_KEYS = 'F8';
const PREV_KEYS = 'Shift+F8';

/** Rows drawn above and below the ones in view. */
const OVERSCAN = 8;
/** One row's height (CSS px); the list draws only the rows in view (thousands on long documents). */
export const ROW_HEIGHT = 68;

const STYLE_LABEL: Record<MarkStyle, MessageKey> = {
  deleted: msg('compare.text.style_deleted'),
  inserted: msg('compare.text.style_inserted'),
  replaced: msg('compare.text.style_replaced'),
  moved: msg('compare.text.style_moved'),
  figure: msg('compare.text.style_figure'),
};

const STYLE_SHAPE: Record<MarkStyle, MessageKey> = {
  deleted: msg('compare.text.shape_deleted'),
  inserted: msg('compare.text.shape_inserted'),
  replaced: msg('compare.text.shape_replaced'),
  moved: msg('compare.text.shape_moved'),
  figure: msg('compare.text.shape_figure'),
};

const KIND_LABEL: Record<TextChangeKind, MessageKey> = {
  inserted: msg('compare.text.kind_inserted'),
  deleted: msg('compare.text.kind_deleted'),
  replaced: msg('compare.text.kind_replaced'),
  moved: msg('compare.text.kind_moved'),
  header: msg('compare.text.kind_header'),
  footer: msg('compare.text.kind_footer'),
  figure: msg('compare.text.kind_figure'),
  renumbered: msg('compare.text.kind_renumbered'),
  reference: msg('compare.text.kind_reference'),
};

/** The legend at the head of the list (D-64, Q42): each kind's colour and shape, its count and its switch. */
/**
 * The legend. It reads only the filter and the colours, so stepping through
 * the list (a new entry in use) does not draw it again (rule 1).
 */
export const Legend = memo(function Legend({
  id,
  entries,
}: {
  id: string;
  entries: readonly ChangeEntry[];
}) {
  const { t } = useTranslation();
  const filter = useTextViewPart(id, (v) => v.filter);
  const colours = useTextViewPart(id, (v) => v.colours);
  const view = { filter, colours };
  const headingId = useId();
  const counts = countByStyle(entries);
  return (
    <section className="text-legend" aria-labelledby={headingId}>
      <h3 id={headingId} className="overlay-side-title">
        {t('compare.text.legend')}
      </h3>
      <ul className="text-legend-list">
        {MARK_STYLES.map((s) => {
          const label = t(STYLE_LABEL[s]);
          return (
            <li key={s} className="text-legend-item" data-style={s}>
              <label className="text-legend-show">
                <input
                  type="checkbox"
                  className="ui-focusable"
                  aria-label={t('compare.text.showStyle', {
                    style: label,
                    count: format.number(counts[s]),
                  })}
                  checked={view.filter.styles[s]}
                  onChange={(e) => {
                    const on = e.currentTarget.checked;
                    updateTextView(id, (v) => ({
                      ...v,
                      filter: { ...v.filter, styles: { ...v.filter.styles, [s]: on } },
                    }));
                  }}
                />
                <span className="text-legend-sample" aria-hidden="true">
                  <svg viewBox="0 0 28 14" width="28" height="14">
                    <Sample style={s} colour={colourOf(s, view.colours)} />
                  </svg>
                </span>
                <span className="text-legend-text">
                  <span className="text-legend-name">{label}</span>
                  <span className="text-legend-shape">{t(STYLE_SHAPE[s])}</span>
                </span>
                <span className="text-legend-count">{format.number(counts[s])}</span>
              </label>
              {s === 'figure' ? (
                <span className="text-legend-pick" />
              ) : (
                <span className="text-legend-pick">
                  <ColorPicker
                    label={t('compare.text.colourOf', { style: label })}
                    value={view.colours[s]}
                    onChange={(hex) => {
                      updateTextView(id, (v) => setColour(v, s, hex));
                    }}
                  />
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
});

/** A small picture of a kind's mark, as on the page. */
function Sample({ style, colour }: { style: MarkStyle; colour: string }) {
  switch (style) {
    case 'deleted':
      return (
        <>
          <rect x="1" y="3" width="26" height="8" fill={colour} fillOpacity={0.14} />
          <line x1="1" x2="27" y1="7" y2="7" stroke={colour} strokeWidth={1.5} />
        </>
      );
    case 'inserted':
      return (
        <>
          <rect x="1" y="3" width="26" height="8" fill={colour} fillOpacity={0.14} />
          <line x1="1" x2="27" y1="11" y2="11" stroke={colour} strokeWidth={1.5} />
        </>
      );
    case 'replaced':
      return (
        <>
          <rect x="1" y="3" width="12" height="8" fill={colour} fillOpacity={0.14} />
          <line x1="1" x2="13" y1="7" y2="7" stroke={colour} strokeWidth={1.5} />
          <rect x="15" y="3" width="12" height="8" fill={colour} fillOpacity={0.14} />
          <line x1="15" x2="27" y1="11" y2="11" stroke={colour} strokeWidth={1.5} />
        </>
      );
    case 'moved':
      return <rect x="1" y="3" width="26" height="8" fill={colour} fillOpacity={0.3} />;
    case 'figure':
      return (
        <rect x="2" y="2" width="24" height="10" fill="none" stroke={colour} strokeWidth={1.5} />
      );
  }
}

/** The kind's own wording ("Header changed", "Clauses renumbered"). */
function kindLabel(t: TFunction, c: TextChange): string {
  return t(KIND_LABEL[c.kind]);
}

/** "A page 3 · B page 4" (the documents' own page numbers). */
function pagesText(
  t: TFunction,
  c: TextChange,
  pageOf: { a: (p: number) => number | undefined; b: (p: number) => number | undefined },
): string {
  const a = c.a ? pageOf.a(c.a.page) : undefined;
  const b = c.b ? pageOf.b(c.b.page) : undefined;
  const n = (p: number): string => format.number(p + 1);
  if (a !== undefined && b !== undefined) return t('compare.text.pages', { a: n(a), b: n(b) });
  if (a !== undefined) return t('compare.text.pageA', { a: n(a) });
  if (b !== undefined) return t('compare.text.pageB', { b: n(b) });
  return '';
}

/** The labels a change carries: percent, OCR, its table row and column, a figure's difference, … */
function badges(t: TFunction, c: TextChange): string[] {
  const out: string[] = [];
  if (c.pct !== undefined)
    out.push(
      t('compare.text.pct', {
        pct: `${c.pct > 0 ? '+' : ''}${format.number(c.pct, 1)}`,
      }),
    );
  if (c.ocr === 'ocr') out.push(t('compare.text.ocr'));
  if (c.ocr === 'ocr-error') out.push(t('compare.text.ocrError'));
  if (c.table?.head) out.push(t('compare.text.headerRow'));
  else if (c.table)
    out.push(
      c.table.col !== undefined || c.table.column !== undefined
        ? t('compare.text.rowColumn', {
            row: c.table.row,
            column: c.table.col ?? format.number((c.table.column ?? 0) + 1),
          })
        : t('compare.text.row', { row: c.table.row }),
    );
  if (c.figure?.diff !== undefined)
    out.push(
      t('compare.text.figureDiff', {
        pct: format.number((c.figure.diff / 255) * 100, 1),
      }),
    );
  if (c.inner?.length) out.push(t('compare.text.inner', { count: c.inner.length }));
  if (c.renumber)
    out.push(
      t('compare.text.renumber', {
        shifted: format.number(c.renumber.shifted),
        follow: format.number(c.renumber.follow),
      }),
    );
  if (c.reference) out.push(t('compare.text.expected', { expected: c.reference.expected }));
  return out;
}

/** Texts in an accessible name: long enough to tell changes apart, short enough to listen to. */
const NAME_CHARS = 160;
const clip = (s: string): string => (s.length > NAME_CHARS ? `${s.slice(0, NAME_CHARS)}…` : s);

/** The change's accessible name: its kind, pages, labels and texts. */
function entryText(
  t: TFunction,
  e: ChangeEntry,
  pageOf: { a: (p: number) => number | undefined; b: (p: number) => number | undefined },
): string {
  const c = e.change;
  return [
    e.parent !== null ? t('compare.text.inMove') : '',
    kindLabel(t, c),
    pagesText(t, c, pageOf),
    ...badges(t, c),
    clip(c.a?.text ?? ''),
    c.b ? `→ ${clip(c.b.text)}` : '',
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * The list of changes (D-64, Q43): search on Enter (rule 3), next and
 * previous (F8, Shift+F8), the checked tick; one row per change in B's
 * reading order. A listbox: arrows move, the entry in use is centred on both
 * sides, Space ticks it. Only the rows in view are drawn.
 */
export function ChangeList({
  id,
  entries,
  visible,
  selected,
  checked,
  pageOf,
  onSelect,
  onStep,
  total,
}: {
  id: string;
  entries: readonly ChangeEntry[];
  visible: readonly number[];
  selected: number | null;
  checked: ReadonlySet<number>;
  pageOf: { a: (p: number) => number | undefined; b: (p: number) => number | undefined };
  onSelect: (entry: number) => void;
  onStep: (dir: 1 | -1) => void;
  total: number;
}) {
  const { t } = useTranslation();
  const view = useTextView(id);
  const headingId = useId();
  const listId = useId();
  const [query, setQuery] = useState(view.filter.query);
  const scroller = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 400 });

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
  const at = selected === null ? -1 : visible.indexOf(selected);
  useEffect(() => {
    const el = scroller.current;
    if (!el || at < 0) return;
    const top = at * ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight)
      el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
  }, [at]);

  const first = Math.max(0, Math.floor(scroll.top / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(
    visible.length,
    Math.ceil((scroll.top + scroll.height) / ROW_HEIGHT) + OVERSCAN,
  );
  const rows = visible.slice(first, last);
  const optionId = (entry: number): string => `${listId}-e${String(entry)}`;

  const toggleChecked = (entry: number): void => {
    const e = entries[entry];
    if (!e) return;
    updateTextView(id, (v) => {
      const key = entryKey(e);
      return {
        ...v,
        checked: v.checked.includes(key) ? v.checked.filter((k) => k !== key) : [...v.checked, key],
      };
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (visible.length === 0) return;
    const step: Record<string, number> = {
      ArrowDown: 1,
      ArrowUp: -1,
      PageDown: Math.max(1, Math.floor(scroll.height / ROW_HEIGHT)),
      PageUp: -Math.max(1, Math.floor(scroll.height / ROW_HEIGHT)),
    };
    let to: number | undefined;
    if (e.key in step)
      to = Math.min(visible.length - 1, Math.max(0, (at < 0 ? -1 : at) + (step[e.key] ?? 0)));
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = visible.length - 1;
    else if (e.key === ' ' && selected !== null) {
      e.preventDefault();
      toggleChecked(selected);
      return;
    } else if (e.key === 'Enter' && selected !== null) {
      e.preventDefault();
      onSelect(selected);
      return;
    }
    if (to === undefined) return;
    e.preventDefault();
    const entry = visible[to];
    if (entry !== undefined) onSelect(entry);
  };

  const applySearch = (q: string): void => {
    updateTextView(id, (v) => ({ ...v, filter: { ...v.filter, query: q } }));
  };

  return (
    <section className="text-list" aria-labelledby={headingId} data-testid="text-list">
      <div className="text-list-head">
        <h3 id={headingId} className="overlay-side-title">
          {t('compare.text.list')}
        </h3>
        <span
          className="text-list-count"
          data-testid="text-list-count"
          data-count={total}
          data-shown={visible.length}
        >
          {visible.length === total
            ? t('compare.text.count', { count: total })
            : t('compare.text.shown', {
                shown: format.number(visible.length),
                count: format.number(total),
              })}
        </span>
      </div>
      <div className="text-list-tools">
        <div className="text-search">
          <input
            type="search"
            className="ui-input ui-focusable text-search-input"
            aria-label={t('compare.text.search')}
            placeholder={t('compare.text.searchHint')}
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
              label={t('compare.text.clearSearch')}
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
            label={t('compare.text.previous')}
            icon={<ArrowUp20Regular />}
            aria-keyshortcuts={PREV_KEYS}
            disabled={visible.length === 0}
            onClick={() => {
              onStep(-1);
            }}
          />
          <IconButton
            label={t('compare.text.next')}
            icon={<ArrowDown20Regular />}
            aria-keyshortcuts={NEXT_KEYS}
            disabled={visible.length === 0}
            onClick={() => {
              onStep(1);
            }}
          />
          <ToggleButton
            label={t('compare.text.checkThis')}
            iconOnly
            icon={<CheckmarkCircle20Regular />}
            pressedIcon={<CheckmarkCircle20Filled />}
            disabled={selected === null}
            pressed={selected !== null && checked.has(selected)}
            onPressedChange={() => {
              if (selected !== null) toggleChecked(selected);
            }}
          />
          <label className="text-hide-checked">
            <input
              type="checkbox"
              className="ui-focusable"
              checked={view.filter.hideChecked}
              onChange={(e) => {
                const on = e.currentTarget.checked;
                updateTextView(id, (v) => ({ ...v, filter: { ...v.filter, hideChecked: on } }));
              }}
            />
            <span>{t('compare.text.hideChecked')}</span>
          </label>
        </div>
      </div>
      <div
        ref={scroller}
        className="text-list-rows"
        role="listbox"
        aria-label={t('compare.text.listName')}
        aria-activedescendant={
          selected !== null && at >= first && at < last ? optionId(selected) : undefined
        }
        tabIndex={0}
        data-testid="text-list-rows"
        onKeyDown={onKeyDown}
      >
        {visible.length === 0 ? (
          <p className="text-list-empty">
            {total === 0 ? t('compare.text.none') : t('compare.text.noneShown')}
          </p>
        ) : (
          <div style={{ height: `${String(visible.length * ROW_HEIGHT)}px`, position: 'relative' }}>
            {rows.map((entry, k) => {
              const e = entries[entry];
              if (!e) return null;
              const c = e.change;
              const isChecked = checked.has(entry);
              const label = entryText(t, e, pageOf);
              return (
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- the listbox handles the keys
                <div
                  key={entry}
                  id={optionId(entry)}
                  role="option"
                  aria-selected={entry === selected}
                  aria-label={isChecked ? t('compare.text.entryChecked', { label }) : label}
                  tabIndex={-1}
                  className="text-entry"
                  data-style={e.style}
                  data-kind={c.kind}
                  data-entry={entry}
                  data-inner={e.parent !== null || undefined}
                  data-checked={isChecked || undefined}
                  style={{
                    top: `${String((first + k) * ROW_HEIGHT)}px`,
                    height: `${String(ROW_HEIGHT)}px`,
                    borderInlineStartColor: colourOf(e.style, view.colours),
                  }}
                  onClick={() => {
                    onSelect(entry);
                  }}
                >
                  <span className="text-entry-head">
                    <span className="text-entry-kind">{kindLabel(t, c)}</span>
                    <span className="text-entry-pages">{pagesText(t, c, pageOf)}</span>
                    {isChecked ? (
                      <span className="text-entry-check" aria-hidden="true">
                        <Checkmark16Filled />
                      </span>
                    ) : null}
                  </span>
                  <span className="text-entry-badges">
                    {badges(t, c).map((b, i) => (
                      <span key={i} className="text-entry-badge">
                        {b}
                      </span>
                    ))}
                  </span>
                  <span className="text-entry-texts">
                    {c.a && c.kind !== 'moved' ? (
                      <del className="text-entry-old">{c.a.text}</del>
                    ) : null}
                    {c.b ? <ins className="text-entry-new">{c.b.text}</ins> : null}
                    {c.kind === 'moved' && !c.b && c.a ? <span>{c.a.text}</span> : null}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

const entryKey = (e: ChangeEntry): string => changeKey(e.change);
