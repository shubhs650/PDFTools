import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../i18n';
import { Button } from '../../ui/components';
import { goToPage } from '../view/controller';
import { buildRows, pagesWithoutContext, rowAt, scrollMap, type Row } from './resultRows';
import {
  cancelSearch,
  openExtra,
  openHit,
  requestContext,
  runAdvancedSearch,
  setScope,
  setSearchOption,
  setSearchQuery,
  useSearch,
  type AdvancedOptions,
  type SearchScope,
} from './searchStore';

const SCOPE_LABEL: Record<SearchScope, MessageKey> = {
  document: msg('search.scopeDocument'),
  all: msg('search.scopeAll'),
};
const SCOPES = Object.keys(SCOPE_LABEL) as SearchScope[];
const EXTRA_LABEL: Record<'bookmark' | 'annotation', MessageKey> = {
  bookmark: msg('search.row.bookmark'),
  annotation: msg('search.row.annotation'),
};

/** Row height in CSS px (fixed: the list is virtualized by index). */
const ROW_H = 28;
/** Rows rendered beyond the window on each side. */
const OVERSCAN = 8;

const ERROR_MESSAGE: Record<string, MessageKey> = {
  'search-empty-query': msg('find.error.empty'),
  'search-invalid-query': msg('find.error.invalid'),
  'search-matches-empty': msg('find.error.matchesEmpty'),
  'search-failed': msg('find.error.failed'),
};

const OPTION_LABEL: Record<keyof AdvancedOptions, MessageKey> = {
  matchCase: msg('find.matchCase'),
  wholeWord: msg('find.wholeWord'),
  wildcards: msg('search.wildcards'),
  regex: msg('search.regex'),
  annotations: msg('search.annotations'),
  bookmarks: msg('search.bookmarks'),
};

/**
 * Advanced Search pane (Ctrl+Shift+F, §6, M2-09). Searches only on Enter or
 * the Search button (rule 3). Results are one virtual list grouped by
 * document and page; Enter or a click on a row opens it.
 */
export function SearchPane() {
  const { t } = useTranslation();
  const query = useSearch((s) => s.query);
  const options = useSearch((s) => s.options);
  const scope = useSearch((s) => s.scope);
  const status = useSearch((s) => s.status);
  const error = useSearch((s) => s.error);
  const total = useSearch((s) => s.total);
  const groups = useSearch((s) => s.groups);
  const docCount = useSearch((s) => s.docCount);
  const docsDone = useSearch((s) => s.docsDone);
  const pagesDone = useSearch((s) => s.pagesDone);
  const pageCount = useSearch((s) => s.pageCount);
  const ranScope = useSearch((s) => s.ran?.scope ?? 'document');
  const focusRequest = useSearch((s) => s.focusRequest);
  const hasDocument = useDocuments((s) => s.activeId !== null);
  const input = useRef<HTMLInputElement>(null);
  const scopeName = useId();

  useEffect(() => {
    input.current?.select();
  }, [focusRequest]);

  const rows = useMemo(() => buildRows(groups, ranScope === 'all'), [groups, ranScope]);

  const progress =
    docCount > 0 ? (docsDone + (pageCount ? pagesDone / pageCount : 0)) / docCount : 0;
  const statusText =
    status === 'error'
      ? t(ERROR_MESSAGE[error ?? ''] ?? msg('find.error.failed'))
      : status === 'searching'
        ? t('search.status.searching', {
            n: format.number(total, 0),
            percent: format.percent(Math.min(1, progress), 0),
          })
        : status === 'cancelled'
          ? t('search.status.cancelled', { n: format.number(total, 0) })
          : status === 'done'
            ? total > 0
              ? t('search.status.count', { count: total, n: format.number(total, 0) })
              : t('find.status.none')
            : '';

  return (
    <div className="search-pane">
      <form
        className="search-form"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void runAdvancedSearch();
        }}
      >
        <div className="search-row">
          <input
            ref={input}
            className="find-input search-input"
            type="search"
            aria-label={t('search.label')}
            placeholder={t('search.label')}
            value={query}
            onChange={(e) => {
              setSearchQuery(e.target.value);
            }}
          />
          {status === 'searching' ? (
            <Button label={t('find.stop')} size="small" onClick={cancelSearch} />
          ) : (
            <Button
              label={t('search.run')}
              size="small"
              variant="primary"
              type="submit"
              disabled={!hasDocument || !query.trim()}
            />
          )}
        </div>
        <fieldset className="search-options">
          <legend className="search-legend">{t('search.options')}</legend>
          {(Object.keys(OPTION_LABEL) as (keyof AdvancedOptions)[]).map((name) => (
            <label key={name} className="search-check">
              <input
                type="checkbox"
                checked={options[name]}
                onChange={(e) => {
                  setSearchOption(name, e.target.checked);
                }}
              />
              {t(OPTION_LABEL[name])}
            </label>
          ))}
        </fieldset>
        <fieldset className="search-options">
          <legend className="search-legend">{t('search.scope')}</legend>
          {SCOPES.map((value) => (
            <label key={value} className="search-check">
              <input
                type="radio"
                name={scopeName}
                value={value}
                checked={scope === value}
                onChange={() => {
                  setScope(value);
                }}
              />
              {t(SCOPE_LABEL[value])}
            </label>
          ))}
        </fieldset>
      </form>
      <p className="search-status" role="status" aria-live="polite">
        {statusText}
      </p>
      <ResultsList rows={rows} />
    </div>
  );
}

function ResultsList({ rows }: { rows: ReturnType<typeof buildRows> }) {
  const { t } = useTranslation();
  const names = useDocuments((s) => s.docs);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(400);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setViewHeight(el.clientHeight);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  const map = scrollMap(rows.count * ROW_H, viewHeight);
  const realTop = map.toReal(scrollTop);
  /** Rows are placed at their row-space position minus this (0 unless scaled). */
  const shift = realTop - scrollTop;
  const first = Math.max(0, Math.floor(realTop / ROW_H) - OVERSCAN);
  const last = Math.min(rows.count - 1, Math.ceil((realTop + viewHeight) / ROW_H) + OVERSCAN);
  const current = Math.min(active, Math.max(0, rows.count - 1));

  // Rows of pages past the context cap: ask the worker for their hits.
  useEffect(() => {
    if (rows.count === 0) return;
    const need = pagesWithoutContext(rows, first, last);
    if (need.length) requestContext(need);
  }, [rows, first, last]);

  if (rows.count === 0) return null;

  const open = (row: Row | null): void => {
    if (!row) return;
    if (row.kind === 'hit') void openHit(row.docId, row.page, row.index);
    else if (row.kind === 'extra') void openExtra(row.docId, row.extra);
    else if (row.kind === 'page') void openHit(row.docId, row.page, 0);
    else {
      const g = rows.groups.find((x) => x.docId === row.docId);
      const page = g ? Math.min(...g.results.pages.keys()) : 0;
      if (Number.isFinite(page)) void openHit(row.docId, page, 0);
      else goToPage(0);
    }
  };

  const moveTo = (i: number): void => {
    const to = Math.max(0, Math.min(rows.count - 1, i));
    setActive(to);
    const el = list.current;
    if (!el) return;
    const top = to * ROW_H;
    const viewTop = map.toReal(el.scrollTop);
    if (top < viewTop) el.scrollTop = map.toScroll(top);
    else if (top + ROW_H > viewTop + el.clientHeight)
      el.scrollTop = map.toScroll(top + ROW_H - el.clientHeight);
    setScrollTop(el.scrollTop);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const perView = Math.max(1, Math.floor(viewHeight / ROW_H) - 1);
    const keys: Record<string, () => void> = {
      ArrowDown: () => {
        moveTo(current + 1);
      },
      ArrowUp: () => {
        moveTo(current - 1);
      },
      PageDown: () => {
        moveTo(current + perView);
      },
      PageUp: () => {
        moveTo(current - perView);
      },
      Home: () => {
        moveTo(0);
      },
      End: () => {
        moveTo(rows.count - 1);
      },
      Enter: () => {
        open(rowAt(rows, current));
      },
    };
    const action = keys[e.key];
    if (!action) return;
    e.preventDefault();
    action();
  };

  const label = (row: Row): string => {
    if (row.kind === 'doc')
      return t('search.row.document', {
        name: names[row.docId]?.meta.name ?? '',
        n: format.number(row.count, 0),
      });
    if (row.kind === 'page')
      return t('search.row.page', {
        page: format.number(row.page + 1, 0),
        n: format.number(row.count, 0),
      });
    return '';
  };

  const items = [];
  for (let i = first; i <= last; i++) {
    const row = rowAt(rows, i);
    if (!row) continue;
    const cls = `search-result search-result--${row.kind}${i === current ? ' search-result--active' : ''}`;
    items.push(
      <div
        key={i}
        id={`${listId}-${String(i)}`}
        role="option"
        aria-selected={i === current}
        className={cls}
        data-row={i}
        style={{ top: i * ROW_H - shift, height: ROW_H }}
      >
        {row.kind === 'hit' || row.kind === 'extra' ? (
          <HitText row={row} />
        ) : (
          <span className="search-result-text">{label(row)}</span>
        )}
      </div>,
    );
  }

  return (
    <div
      ref={list}
      className="search-results"
      role="listbox"
      tabIndex={0}
      aria-label={t('search.results')}
      aria-activedescendant={`${listId}-${String(current)}`}
      data-testid="search-results"
      onScroll={(e) => {
        setScrollTop(e.currentTarget.scrollTop);
      }}
      onKeyDown={onKeyDown}
      onClick={(e) => {
        const el = (e.target as HTMLElement).closest<HTMLElement>('[data-row]');
        if (!el) return;
        const i = Number(el.dataset['row']);
        setActive(i);
        open(rowAt(rows, i));
      }}
    >
      <div className="search-results-content" style={{ height: map.height }}>
        {items}
      </div>
    </div>
  );
}

function HitText({ row }: { row: Extract<Row, { kind: 'hit' | 'extra' }> }) {
  const { t } = useTranslation();
  const hit = row.kind === 'hit' ? row.hit : row.extra;
  const tag =
    row.kind === 'extra'
      ? row.extra.page < 0
        ? t('search.row.bookmarkNoPage')
        : t(EXTRA_LABEL[row.extra.source], {
            page: format.number(row.extra.page + 1, 0),
          })
      : null;
  if (!hit)
    return (
      <span className="search-result-text search-result-loading">{t('search.row.loading')}</span>
    );
  return (
    <span className="search-result-text">
      {tag ? <span className="search-result-tag">{tag}</span> : null}
      {hit.before}
      <mark className="search-result-match">{hit.match}</mark>
      {hit.after}
    </span>
  );
}
