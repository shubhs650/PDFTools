// The close-out list (M12-15, D-62, Q16, Q43; ADR-033): every comment of the
// old revision with its state, in the comparison result's right pane:
// comments with typed text first, then markup without text, each by page and
// place; Hide highlights leaves out the highlight-type ones. Selecting a
// comment brings it into view (its sheet zoomed to it in an overlay, its text
// on both sides in a text comparison), selects it in Document A and flashes
// it. Close Out As… closes it out as Addressed, Carried Over (copied to the
// new revision first) or Changed Differently, each with a line saying what it
// means; Reopen undoes it. The check highlight's colour comes from the
// standard swatch picker.
import { HelpButton } from '../../help/HelpButton';
import { useId, useMemo, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../../i18n';
import { Button, ColorPicker, DropdownMenu, ToggleButton } from '../../../ui/components';
import { annotationTypeKey } from '../../annotate/annotationTypes';
import { objectsOf, useAnnotationMap, type ByUid } from '../../annotate/comments/commentsStore';
import type { Comparison } from '../model';
import { closeOut, closeOutBlocked, copyToBlocked, copyToRevision, reopen } from './actions';
import {
  CLOSE_OUT_FILTERS,
  CLOSE_OUT_GROUPS,
  OUTCOMES,
  canReopen,
  closeOutRows,
  counts,
  filterRows,
  withoutHighlights,
  type CloseOutFilter,
  type CloseOutGroup,
  type CloseOutRow,
  type CloseOutState,
  type Outcome,
} from './closeOutModel';
import {
  setCheckColour,
  setHideHighlights,
  updateCloseOut,
  useCloseOut,
  useCloseOutView,
} from './closeOutStore';
import { revealComment } from './reveal';

const STATE: Record<CloseOutState, MessageKey> = {
  open: msg('compare.closeout.state_open'),
  addressed: msg('compare.closeout.state_addressed'),
  carried: msg('compare.closeout.state_carried'),
  changed: msg('compare.closeout.state_changed'),
  completed: msg('compare.closeout.state_completed'),
};

const FILTER: Record<CloseOutFilter, MessageKey> = {
  all: msg('compare.closeout.filter_all'),
  open: msg('compare.closeout.filter_open'),
  closed: msg('compare.closeout.filter_closed'),
};

const ACTION: Record<Outcome, MessageKey> = {
  addressed: msg('compare.closeout.action_addressed'),
  carried: msg('compare.closeout.action_carried'),
  changed: msg('compare.closeout.action_changed'),
};

/** What each outcome means, under it in Close Out As… (ADR-033). */
const ACTION_HINT: Record<Outcome, MessageKey> = {
  addressed: msg('compare.closeout.hint_addressed'),
  carried: msg('compare.closeout.hint_carried'),
  changed: msg('compare.closeout.hint_changed'),
};

const GROUP: Record<CloseOutGroup, MessageKey> = {
  text: msg('compare.closeout.group_text'),
  markup: msg('compare.closeout.group_markup'),
};

/** Rows per document of the old revision, built once per annotation map. */
const rowsCache = new WeakMap<ByUid, CloseOutRow[]>();

function rowsOf(byUid: ByUid | null): CloseOutRow[] {
  if (!byUid) return [];
  let rows = rowsCache.get(byUid);
  if (!rows) {
    rows = closeOutRows(objectsOf(byUid));
    rowsCache.set(byUid, rows);
  }
  return rows;
}

/** The close-out pane of a comparison result. */
export function CloseOutPane({ comparison: c }: { comparison: Comparison }) {
  const { t } = useTranslation();
  const headingId = useId();
  const view = useCloseOutView(c.id);
  const colour = useCloseOut((s) => s.colour);
  const hideHighlights = useCloseOut((s) => s.hideHighlights);
  const files = c.a.map((f) => f.docId);
  return (
    <aside
      className="closeout-pane"
      aria-labelledby={headingId}
      data-testid="closeout-pane"
      data-help-topic="compare-review"
    >
      <div className="pane-title-row">
        <h3 id={headingId} className="overlay-side-title">
          {t('compare.closeout.title')}
        </h3>
        <HelpButton topic="compare-review" />
      </div>
      <p className="closeout-intro">{t('compare.closeout.intro')}</p>
      <div className="closeout-tools">
        <div className="closeout-filter" role="group" aria-label={t('compare.closeout.filter')}>
          {CLOSE_OUT_FILTERS.map((f) => (
            <ToggleButton
              key={f}
              label={t(FILTER[f])}
              pressed={view.filter === f}
              onPressedChange={() => {
                updateCloseOut(c.id, (v) => ({ ...v, filter: f }));
              }}
            />
          ))}
        </div>
        <label className="closeout-hide-highlights">
          <input
            type="checkbox"
            className="ui-focusable"
            checked={hideHighlights}
            data-testid="closeout-hide-highlights"
            onChange={(e) => {
              setHideHighlights(e.currentTarget.checked);
            }}
          />
          <span>{t('compare.closeout.hideHighlights')}</span>
        </label>
        <span className="closeout-colour">
          <ColorPicker
            label={t('compare.closeout.colour')}
            value={colour}
            onChange={setCheckColour}
          />
        </span>
      </div>
      {files.map((docId) => (
        <CloseOutList key={docId} comparison={c} docId={docId} named={files.length > 1} />
      ))}
      <CloseOutActions comparison={c} />
    </aside>
  );
}

/** One document of the old revision: its comments with their states. */
function CloseOutList({
  comparison: c,
  docId,
  named,
}: {
  comparison: Comparison;
  docId: string;
  named: boolean;
}) {
  const { t } = useTranslation();
  const view = useCloseOutView(c.id);
  const hideHighlights = useCloseOut((s) => s.hideHighlights);
  const byUid = useAnnotationMap(docId);
  const name = useDocuments((s) => s.docs[docId]?.meta.name ?? '');
  const all = rowsOf(byUid);
  const listed = useMemo(() => withoutHighlights(all, hideHighlights), [all, hideHighlights]);
  const rows = useMemo(
    () => filterRows(all, view.filter, hideHighlights),
    [all, view.filter, hideHighlights],
  );
  const n = counts(listed);
  const selected = view.selected?.docId === docId ? view.selected.id : null;
  const optionId = (id: string): string => `${c.id}-closeout-${docId}-${id}`;
  const pick = (row: CloseOutRow | undefined): void => {
    if (!row) return;
    updateCloseOut(c.id, (v) => ({ ...v, selected: { docId, id: row.id } }));
    revealComment(c, docId, row);
  };
  const onKey = (e: KeyboardEvent): void => {
    const at = rows.findIndex((r) => r.id === selected);
    const to: Record<string, number> = {
      ArrowDown: at + 1,
      ArrowUp: at < 0 ? rows.length - 1 : at - 1,
      Home: 0,
      End: rows.length - 1,
    };
    const i = to[e.key];
    if (i === undefined) return;
    e.preventDefault();
    pick(rows[Math.max(0, Math.min(rows.length - 1, i))]);
  };
  return (
    <section className="closeout-doc">
      <div className="text-list-head">
        {named ? <span className="closeout-file">{name}</span> : null}
        <span className="text-list-count" data-testid="closeout-counts">
          {t('compare.closeout.counts', {
            open: format.number(n.open),
            closed: format.number(n.closed),
          })}
        </span>
      </div>
      <div
        className="closeout-rows text-list-rows"
        role="listbox"
        aria-label={named ? `${t('compare.closeout.list')}: ${name}` : t('compare.closeout.list')}
        tabIndex={0}
        aria-activedescendant={selected ? optionId(selected) : undefined}
        data-testid="closeout-list"
        onKeyDown={onKey}
      >
        {rows.length === 0 ? (
          <p className="text-list-empty">
            {all.length === 0 ? t('compare.closeout.empty') : t('compare.closeout.emptyFilter')}
          </p>
        ) : (
          CLOSE_OUT_GROUPS.map((g) => {
            const inGroup = rows.filter((r) => r.group === g);
            if (inGroup.length === 0) return null;
            const groupId = `${c.id}-closeout-${docId}-group-${g}`;
            return (
              <div
                key={g}
                role="group"
                aria-labelledby={groupId}
                className="closeout-group"
                data-group={g}
              >
                <p id={groupId} aria-hidden="true" className="closeout-group-title">
                  {t(GROUP[g], { count: inGroup.length })}
                </p>
                {inGroup.map(row)}
              </div>
            );
          })
        )}
      </div>
    </section>
  );

  function row(r: CloseOutRow) {
    return (
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- the listbox handles the keys
      <div
        key={r.id}
        id={optionId(r.id)}
        role="option"
        tabIndex={-1}
        aria-selected={r.id === selected}
        className="closeout-row"
        data-state={r.state}
        data-id={r.id}
        onClick={() => {
          pick(r);
        }}
      >
        <span className="closeout-row-head">
          <span className="closeout-row-type">{t(annotationTypeKey(r.annot))}</span>
          <span className="closeout-state" data-state={r.state}>
            {t(STATE[r.state])}
          </span>
        </span>
        <span className="closeout-row-text">
          {t('compare.closeout.row', {
            number: format.number(r.number),
            text: r.firstLine || t('compare.closeout.noText'),
          })}
        </span>
        <span className="closeout-row-meta">
          {t('compare.closeout.rowMeta', {
            page: format.number(r.page + 1),
            author: r.author,
          })}
        </span>
      </div>
    );
  }
}

/** The buttons that act on the selected comment of the list. */
function CloseOutActions({ comparison: c }: { comparison: Comparison }) {
  const { t } = useTranslation();
  const view = useCloseOutView(c.id);
  const sel = view.selected;
  const byUid = useAnnotationMap(sel?.docId ?? null);
  const row = sel ? rowsOf(byUid).find((r) => r.id === sel.id) : undefined;
  const all = byUid ? objectsOf(byUid) : [];
  const blocked = sel ? closeOutBlocked(sel.docId) : msg('compare.closeout.noSelection');
  const why = (key: MessageKey | null): string | undefined => (key ? t(key) : undefined);
  const noRow = row ? null : msg('compare.closeout.noSelection');
  const copyWhy = sel && row ? copyToBlocked(sel.docId, 'b', [row.annot]) : noRow;
  return (
    <div
      className="closeout-actions"
      role="toolbar"
      aria-label={t('compare.closeout.actions')}
      data-testid="closeout-actions"
    >
      <DropdownMenu
        trigger={
          <Button
            label={t('compare.closeout.closeOutAs')}
            size="small"
            variant="primary"
            disabled={!row || !!blocked}
            title={why(noRow ?? blocked)}
          />
        }
        entries={OUTCOMES.map((o) => ({
          id: `closeout-${o}`,
          label: t(ACTION[o]),
          description:
            o === 'carried' && copyWhy ? `${t(ACTION_HINT[o])} ${t(copyWhy)}` : t(ACTION_HINT[o]),
          disabled: o === 'carried' && !!copyWhy,
          onSelect: () => {
            if (sel && row) void closeOut(sel.docId, [row.annot], o);
          },
        }))}
      />
      <Button
        label={t('compare.closeout.reopen')}
        size="small"
        disabled={!row || !!blocked || !canReopen(all, row.id)}
        onClick={() => {
          if (sel && row) reopen(sel.docId, [row.annot]);
        }}
      />
      <Button
        label={t('command.compare.copyToNew')}
        size="small"
        disabled={!!copyWhy}
        title={why(copyWhy)}
        onClick={() => {
          if (sel && row) void copyToRevision(sel.docId, 'b', [row.annot]);
        }}
      />
    </div>
  );
}
