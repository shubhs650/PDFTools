// The close-out list (M12-15, D-62, Q16, Q43): every comment of the old
// revision with its state, in the comparison result's right pane. Selecting a
// comment shows it (its sheet in an overlay, its text on both sides in a text
// comparison) and selects it in Document A; the buttons below close it out as
// Addressed, Carried Over (copied to the new revision first) or Changed
// Differently, reopen it, or copy it to the new revision. The check
// highlight's colour comes from the standard swatch picker.
import { HelpButton } from '../../help/HelpButton';
import { useId, useMemo, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../../i18n';
import { matchPlace, sheetOf } from '../../../model/compare/alignedCopy';
import { stackY } from '../../../model/compare/textView';
import { Button, ColorPicker, ToggleButton } from '../../../ui/components';
import { annotationTypeKey } from '../../annotate/annotationTypes';
import { objectsOf, useAnnotationMap, type ByUid } from '../../annotate/comments/commentsStore';
import { annotationCapability } from '../../annotate/selection';
import type { Comparison } from '../model';
import { goSheet, updateView } from '../overlay/overlayState';
import { textLinkOf } from '../text/textLink';
import { closeOut, closeOutBlocked, copyToBlocked, copyToRevision, reopen } from './actions';
import {
  CLOSE_OUT_FILTERS,
  OUTCOMES,
  canReopen,
  closeOutRows,
  counts,
  filterRows,
  type CloseOutFilter,
  type CloseOutRow,
  type CloseOutState,
  type Outcome,
} from './closeOutModel';
import { setCheckColour, updateCloseOut, useCloseOut, useCloseOutView } from './closeOutStore';
import { notesOf, sheetsOfComparison } from './context';

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

/** Shows a comment of A: its sheet (overlay) or its text on both sides (text), selected in A. */
function reveal(c: Comparison, docId: string, row: CloseOutRow): void {
  if (c.type === 'overlay') {
    const sheets = sheetsOfComparison(c.id);
    const i = sheetOf(sheets, notesOf(c.id), { docId, page: row.page });
    if (i >= 0) updateView(c.id, (v) => goSheet(v, i, sheets.length));
  } else {
    // The comment's text on both sides: the matching place of its middle (as Copy finds it).
    const link = textLinkOf(c.id);
    const stack = link?.stack('a');
    const r = row.annot.rect;
    const top = stack ? stackY(stack, row.page, r.origin.y) : undefined;
    const placed = link?.located();
    if (link && top !== undefined && placed) {
      const half = r.size.height / 2;
      const b = matchPlace(placed.curve, placed.places, 'a', top + half);
      link.centreOn({
        a: { top, bottom: top + 2 * half },
        b: { top: b - half, bottom: b + half },
      });
    }
  }
  annotationCapability()?.forDocument(docId).selectAnnotation(row.page, row.id);
}

/** The close-out pane of a comparison result. */
export function CloseOutPane({ comparison: c }: { comparison: Comparison }) {
  const { t } = useTranslation();
  const headingId = useId();
  const view = useCloseOutView(c.id);
  const colour = useCloseOut((s) => s.colour);
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
  const byUid = useAnnotationMap(docId);
  const name = useDocuments((s) => s.docs[docId]?.meta.name ?? '');
  const all = rowsOf(byUid);
  const rows = useMemo(() => filterRows(all, view.filter), [all, view.filter]);
  const n = counts(all);
  const selected = view.selected?.docId === docId ? view.selected.id : null;
  const optionId = (id: string): string => `${c.id}-closeout-${docId}-${id}`;
  const pick = (row: CloseOutRow | undefined): void => {
    if (!row) return;
    updateCloseOut(c.id, (v) => ({ ...v, selected: { docId, id: row.id } }));
    reveal(c, docId, row);
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
          rows.map((r) => (
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
          ))
        )}
      </div>
    </section>
  );
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
      {OUTCOMES.map((o) => (
        <Button
          key={o}
          label={t(ACTION[o])}
          size="small"
          disabled={!row || !!blocked || (o === 'carried' && !!copyWhy)}
          title={why(noRow ?? blocked ?? (o === 'carried' ? copyWhy : null))}
          onClick={() => {
            if (sel && row) void closeOut(sel.docId, [row.annot], o);
          }}
        />
      ))}
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
