import { ChevronLeft20Regular } from '@fluentui/react-icons/svg/chevron-left';
import { HelpButton } from '../../help/HelpButton';
import { ChevronRight20Regular } from '@fluentui/react-icons/svg/chevron-right';
import {
  LayoutColumnTwoSplitRight20Filled,
  LayoutColumnTwoSplitRight20Regular,
} from '@fluentui/react-icons/svg/layout-column-two-split-right';
import { LockClosed20Filled } from '@fluentui/react-icons/svg/lock-closed';
import { LockOpen20Regular } from '@fluentui/react-icons/svg/lock-open';
import { Square20Filled, Square20Regular } from '@fluentui/react-icons/svg/square';
import { useEffect, useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { documentStore, useDocuments } from '../../../app/store/documentStore';
import { format } from '../../../i18n';
import { comparedPairs } from '../../../model/compare/pairing';
import { IconButton, ProgressBar, ToggleButton } from '../../../ui/components';
import { CommandIcon } from '../../../ui/icons/CommandIcon';
import { NewComparisonButton } from '../NewComparisonButton';
import type { Comparison } from '../model';
import { pairingInputs, startComparing, syncPairing, usePairing } from '../pairingFlow';
import { typeLabel } from '../title';
import { alignmentText } from '../alignmentText';
import { AlignPanel } from '../align/AlignPanel';
import { AreaInfo, AreaPanel } from '../area/AreaPanel';
import { OverlayLayers } from './OverlayLayers';
import { frameOf, framePage } from './frames';
import {
  dropView,
  alignmentOf,
  goSheet,
  overlayStore,
  overlayView,
  setAligned,
  setLayout,
  setLock,
  sheetsOf,
  updateView,
  useOverlayView,
  type Sheet,
} from './overlayState';
import { ensureNotes, useNotes } from '../review/notes';
import { ReviewLayout } from '../review/ReviewLayout';
import { renderEngine, workClient } from '../../view/host';
import { closeLayerCopies } from './layerCopies';
import { closeVectorPages, comparisonSheets } from './vectorOverlay';
import { applyRestoredPlaces } from '../file/restore';
import { documentsOf } from '../model';
import { CloseOutPane } from '../closeout/CloseOutPane';
import { CloseOutToggle } from '../closeout/CloseOutToggle';
import { useCloseOutView } from '../closeout/closeOutStore';
import { DiffPane } from '../diff/DiffPane';
import { DiffToggle } from '../diff/DiffToggle';
import { IgnoreZones } from '../diff/IgnoreZones';
import { watchDifferences } from '../diff/diffFlow';
import {
  dropDiff,
  sheetOrder,
  sheetState,
  updateDiff,
  useDiffPart,
  useDiffView,
  type SheetState,
} from '../diff/diffState';

let watching = false;
const docsOfView = new Map<string, string[]>();

/** Closing a comparison forgets its view and the Render worker's cached overlay tiles. */
function watchClosing(c: Comparison): void {
  docsOfView.set(c.id, documentsOf(c));
  if (watching) return;
  watching = true;
  documentStore.subscribe((s) => {
    for (const [id, docIds] of docsOfView) {
      if (s.comparisons[id]) continue;
      docsOfView.delete(id);
      if (overlayStore.getState().byId[id]) dropView(id);
      dropDiff(id);
      void renderEngine()
        .rpc.call('overlayRelease', { docIds })
        .promise.catch(() => undefined);
      // The layer copies of its documents (layer switches, Q24), in both workers.
      closeLayerCopies(docIds);
      // Its vector overlay pages (the display mode, M12-16).
      closeVectorPages(id);
      void workClient()
        .releaseLayers(docIds)
        .catch(() => undefined);
    }
  });
}

/**
 * The result of a PDF overlay (M12-11, D-59, ARCHITECTURE §7.16): the sheet
 * list and the switches on the left, the overlay window with its floating bar
 * on the right. One sheet at a time (Q14). The sheets come from the pairing
 * table; Compare starts the comparison's work in the workers.
 */
export function OverlayResult({ comparison: c }: { comparison: Comparison }) {
  const { t } = useTranslation();
  const titleId = useId();
  // What pairing reads of the documents (not their views: the windows change those all the time).
  const inputsKey = useDocuments((s) => pairingInputs(c, s.docs)?.key ?? null);
  // A restored comparison pairs its pages again (M12-09: pairing edits are not restored).
  useEffect(() => {
    syncPairing(c);
    watchClosing(c);
  }, [c, inputsKey]);
  const pairing = usePairing(c.id);
  const sheets = useMemo(
    () => (pairing?.status === 'done' ? sheetsOf(pairing.rows, pairing.pages) : []),
    [pairing],
  );
  const pairsKey = pairing?.status === 'done' ? JSON.stringify(comparedPairs(pairing.rows)) : null;
  // Compare runs the comparison (D-66); each sheet's alignment comes back as it is found (D-60).
  useEffect(() => {
    if (pairsKey === null) return;
    const session = startComparing(c.id);
    if (!session) return;
    updateView(c.id, (v) =>
      Object.keys(v.aligned).length || v.manual ? { ...v, aligned: {}, manual: null } : v,
    );
    // Layer switches stay with the documents: a new session draws with them too (Q24).
    for (const [docId, states] of Object.entries(overlayView(c.id).layers))
      session.setLayers(docId, states);
    // A comparison reopened from its file (M12-20): the sheets placed by hand.
    applyRestoredPlaces(c.id, session, comparisonSheets(c.id) ?? []);
    // Each sheet's differences as its detection ends (M12-14, D-61); none kept from other pairs.
    updateDiff(c.id, (v) =>
      Object.keys(v.results).length || v.selected !== null
        ? { ...v, results: {}, selected: null }
        : v,
    );
    const offDiffs = watchDifferences(c.id, session);
    const offAlign = session.watchAlignment((pair, al) => {
      updateView(c.id, (v) => setAligned(v, pair, al));
    });
    return () => {
      offAlign();
      offDiffs();
    };
  }, [c.id, pairsKey]);
  const view = useOverlayView(c.id);
  const index = Math.min(view.sheet, Math.max(0, sheets.length - 1));
  const sheet = sheets[index];

  // The comparison's notes: one blank page per sheet in its frame (M12-12, D-62).
  const framesKey = JSON.stringify(sheets.map(framePage));
  useEffect(() => {
    if (sheets.length === 0) return;
    let live = true;
    const { docs: all } = documentStore.getState();
    void Promise.all(
      sheets.map((s) => {
        const p = framePage(s);
        return p ? frameOf(p.docId, p.page, all[p.docId]?.edits ?? 0) : Promise.reject(new Error());
      }),
    ).then(
      (sizes) => {
        if (live) void ensureNotes(c.id, sizes);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
    // framesKey stands for the sheets' pages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id, framesKey]);
  const notes = useNotes(c.id);
  const closeOutOpen = useCloseOutView(c.id).open;
  const diffPane = useDiffPart(c.id, (v) => v.pane);

  let body;
  if (!pairing || pairing.status === 'reading' || pairing.status === 'matching') {
    body = (
      <div className="overlay-wait" role="status">
        <p>{t('compare.overlay.pairing')}</p>
        <ProgressBar
          label={t('compare.overlay.pairing')}
          value={pairing && pairing.total > 0 ? pairing.done / pairing.total : null}
        />
      </div>
    );
  } else if (pairing.status === 'failed') {
    body = (
      <p className="overlay-wait" role="status">
        {t('compare.overlay.pairingFailed')}
      </p>
    );
  } else if (!sheet) {
    body = (
      <p className="overlay-wait" role="status">
        {t('compare.overlay.noSheets')}
      </p>
    );
  } else {
    body = (
      <div className="overlay-body">
        <aside className="overlay-side" aria-label={t('compare.overlay.sheets')}>
          <SheetList comparison={c} sheets={sheets} current={index} />
          {c.area ? <AreaInfo comparison={c} sheet={sheet} /> : null}
          <AlignPanel
            id={c.id}
            sheet={sheet}
            pairs={sheets.filter((s) => s.pair !== null).length}
          />
          {c.area ? null : <AreaPanel id={c.id} sheet={sheet} />}
          <OverlayLayers comparison={c} sheet={sheet} />
          <IgnoreZones id={c.id} sheets={sheets} current={index} />
        </aside>
        {notes?.status === 'ready' && notes.docId ? (
          <ReviewLayout
            comparison={c}
            sheet={sheet}
            index={index}
            notesId={notes.docId}
            fitKey={`${String(diffPane)}|${String(closeOutOpen)}`}
          />
        ) : notes?.status === 'failed' ? (
          <p className="overlay-wait" role="status">
            {t('compare.review.notesFailed')}
          </p>
        ) : (
          <div className="overlay-wait" role="status">
            <p>{t('compare.review.preparing')}</p>
            <ProgressBar label={t('compare.review.preparing')} value={null} />
          </div>
        )}
        {diffPane ? <DiffPane id={c.id} sheets={sheets} current={index} /> : null}
        {closeOutOpen ? <CloseOutPane comparison={c} /> : null}
      </div>
    );
  }

  return (
    <section
      className="compare-result overlay-result"
      aria-labelledby={titleId}
      data-testid="compare-result"
      data-type="overlay"
      data-help-topic="compare-overlay"
    >
      <header className="overlay-head">
        <span className="overlay-head-icon" aria-hidden="true">
          <CommandIcon id="compare.overlay" />
        </span>
        <h2 id={titleId} className="overlay-head-title">
          {c.area ? t('compare.area.resultTitle') : typeLabel(c.type)}
          <span className="compare-preview">{t('compare.preview')}</span>
        </h2>
        {sheets.length > 0 ? (
          <div className="overlay-head-nav">
            <IconButton
              label={t('compare.overlay.previous')}
              icon={<ChevronLeft20Regular />}
              disabled={index === 0}
              onClick={() => {
                updateView(c.id, (v) => goSheet(v, index - 1, sheets.length));
              }}
            />
            <span className="overlay-head-sheet" aria-live="polite">
              {t('compare.overlay.sheetOf', {
                sheet: format.number(index + 1),
                count: format.number(sheets.length),
              })}
            </span>
            <IconButton
              label={t('compare.overlay.next')}
              icon={<ChevronRight20Regular />}
              disabled={index >= sheets.length - 1}
              onClick={() => {
                updateView(c.id, (v) => goSheet(v, index + 1, sheets.length));
              }}
            />
          </div>
        ) : null}
        {sheets.length > 0 ? (
          <div className="overlay-head-layout" role="group" aria-label={t('compare.review.layout')}>
            <ToggleButton
              label={t('compare.review.layout_review')}
              iconOnly
              icon={<LayoutColumnTwoSplitRight20Regular />}
              pressedIcon={<LayoutColumnTwoSplitRight20Filled />}
              pressed={view.layout === 'review'}
              onPressedChange={() => {
                updateView(c.id, (v) => setLayout(v, 'review'));
              }}
            />
            <ToggleButton
              label={t('compare.review.layout_overlay')}
              iconOnly
              icon={<Square20Regular />}
              pressedIcon={<Square20Filled />}
              pressed={view.layout === 'overlay'}
              onPressedChange={() => {
                updateView(c.id, (v) => setLayout(v, 'overlay'));
              }}
            />
            <ToggleButton
              label={t('compare.review.lock')}
              iconOnly
              icon={<LockOpen20Regular />}
              pressedIcon={<LockClosed20Filled />}
              pressed={view.lock}
              onPressedChange={(on) => {
                updateView(c.id, (v) => setLock(v, on));
              }}
            />
            <DiffToggle id={c.id} />
            <CloseOutToggle id={c.id} />
          </div>
        ) : null}
        {c.area ? null : (
          // An area comparison's inputs are its rectangles, drawn in another comparison (O1).
          <NewComparisonButton id={c.id} />
        )}
        <HelpButton topic="compare-overlay" label={t('compare.help')} />
      </header>
      {body}
    </section>
  );
}

/** A page of a side, as the list names it: "3", or "Sheets-B.pdf 3" for a set. */
function usePageLabel(c: Comparison): (p: Sheet['a']) => string {
  // The names only (a string, so a window's view change re-renders nothing here).
  const names = useDocuments((s) =>
    JSON.stringify(documentsOf(c).map((id) => [id, s.docs[id]?.meta.name ?? ''])),
  );
  const byId = useMemo(() => new Map(JSON.parse(names) as [string, string][]), [names]);
  return (p) => {
    if (!p) return '';
    const page = format.number(p.page + 1);
    return p.file > 0 || documentsOf(c).length > 2
      ? `${byId.get(p.docId) ?? ''} ${page}`.trim()
      : page;
  };
}

/** The sheet list (Q14, Q17): one entry per sheet; arrows move, Enter is not needed. */
function SheetList({
  comparison,
  sheets,
  current,
}: {
  comparison: Comparison;
  sheets: Sheet[];
  current: number;
}) {
  const id = comparison.id;
  const { t } = useTranslation();
  const view = useOverlayView(id);
  const diff = useDiffView(id);
  const headingId = useId();
  const label = usePageLabel(comparison);
  const go = (i: number): void => {
    updateView(id, (v) => goSheet(v, i, sheets.length));
  };
  // Shown in order of percent changed when asked (D-61); the arrows follow the order shown.
  const order = sheetOrder(diff, sheets);
  const at = order.indexOf(current);
  return (
    <section className="overlay-sheets" aria-labelledby={headingId}>
      <h3 id={headingId} className="overlay-side-title">
        {t('compare.overlay.sheets')}
      </h3>
      <label className="overlay-check overlay-sheet-sort">
        <input
          type="checkbox"
          className="ui-focusable"
          data-testid="sheet-sort"
          checked={diff.sortByChange}
          onChange={(e) => {
            const on = e.currentTarget.checked;
            updateDiff(id, (v) => ({ ...v, sortByChange: on }));
          }}
        />
        <span>{t('compare.diff.sortByChange')}</span>
      </label>
      <div
        className="overlay-sheet-list"
        role="listbox"
        aria-label={t('compare.overlay.sheetsList')}
        aria-activedescendant={`${id}-sheet-${String(current)}`}
        tabIndex={0}
        data-testid="overlay-sheets"
        onKeyDown={(e) => {
          const step: Record<string, number> = {
            ArrowDown: 1,
            ArrowUp: -1,
            Home: -Infinity,
            End: Infinity,
          };
          const d = step[e.key];
          if (d === undefined) return;
          e.preventDefault();
          const k = Number.isFinite(d)
            ? Math.max(0, Math.min(order.length - 1, at + d))
            : d > 0
              ? order.length - 1
              : 0;
          go(order[k] ?? current);
        }}
      >
        {order.map((i) => {
          const s = sheets[i];
          if (!s) return null;
          const detail =
            s.a && s.b
              ? t('compare.overlay.sheetPages', { a: label(s.a), b: label(s.b) })
              : s.b
                ? t('compare.overlay.sheetAdded', { b: label(s.b) })
                : t('compare.overlay.sheetRemoved', { a: label(s.a) });
          const al = alignmentOf(view, s);
          const alText = al ? alignmentText(al) : null;
          return (
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- the listbox handles the keys
            <div
              key={i}
              id={`${id}-sheet-${String(i)}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === current}
              className="overlay-sheet"
              data-kind={s.a && s.b ? 'pair' : s.b ? 'added' : 'removed'}
              onClick={() => {
                go(i);
              }}
            >
              <span className="overlay-sheet-name">
                {t('compare.overlay.sheetName', { sheet: format.number(i + 1) })}
              </span>
              <span className="overlay-sheet-detail">{detail}</span>
              {alText ? (
                <span className="overlay-sheet-align" data-status={al?.status}>
                  {i === current && alText.values
                    ? `${alText.status} · ${alText.values}`
                    : alText.status}
                </span>
              ) : null}
              {i === current && alText?.hint ? (
                <span className="overlay-sheet-hint">{alText.hint}</span>
              ) : null}
              <SheetStatus state={sheetState(diff, s)} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** A sheet's differences in the sheet list (D-61): unchanged, how many and how much, or done. */
function SheetStatus({ state }: { state: SheetState | null }) {
  const { t } = useTranslation();
  if (!state) return null;
  const percent = 'percent' in state ? format.percent(state.percent / 100) : '';
  let text: string;
  switch (state.status) {
    case 'pending':
      text = t('compare.diff.sheetPending');
      break;
    case 'unchanged':
      text = t('compare.diff.sheetUnchanged');
      break;
    case 'changed':
      text = t('compare.diff.sheetChanged', { count: state.count, percent });
      break;
    case 'done':
      text = t('compare.diff.sheetDone', { count: state.count });
      break;
  }
  return (
    <span className="overlay-sheet-diff" data-status={state.status} data-testid="sheet-diff">
      {text}
    </span>
  );
}
