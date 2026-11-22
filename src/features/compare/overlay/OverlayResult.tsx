import { ChevronLeft20Regular } from '@fluentui/react-icons/svg/chevron-left';
import { ChevronRight20Regular } from '@fluentui/react-icons/svg/chevron-right';
import { useEffect, useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { documentStore, useDocuments } from '../../../app/store/documentStore';
import { format } from '../../../i18n';
import { comparedPairs } from '../../../model/compare/pairing';
import { Button, IconButton, ProgressBar } from '../../../ui/components';
import { CommandIcon } from '../../../ui/icons/CommandIcon';
import { updateInputs } from '../compareFlow';
import type { Comparison } from '../model';
import { startComparing, syncPairing, usePairing } from '../pairingFlow';
import { typeLabel } from '../title';
import { OverlayLayers } from './OverlayLayers';
import { OverlayWindow } from './OverlayWindow';
import {
  dropView,
  goSheet,
  overlayStore,
  sheetsOf,
  updateView,
  useOverlayView,
  type Sheet,
} from './overlayState';
import { renderEngine } from '../../view/host';
import { documentsOf } from '../model';

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
      void renderEngine()
        .rpc.call('overlayRelease', { docIds })
        .promise.catch(() => undefined);
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
  const docs = useDocuments((s) => s.docs);
  // A restored comparison pairs its pages again (M12-09: pairing edits are not restored).
  useEffect(() => {
    syncPairing(c);
    watchClosing(c);
  }, [c, docs]);
  const pairing = usePairing(c.id);
  const sheets = useMemo(
    () => (pairing?.status === 'done' ? sheetsOf(pairing.rows, pairing.pages) : []),
    [pairing],
  );
  const pairsKey =
    pairing?.status === 'done' ? JSON.stringify(comparedPairs(pairing.rows)) : null;
  useEffect(() => {
    if (pairsKey !== null) startComparing(c.id);
  }, [c.id, pairsKey]);
  const view = useOverlayView(c.id);
  const index = Math.min(view.sheet, Math.max(0, sheets.length - 1));
  const sheet = sheets[index];

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
          <SheetList id={c.id} sheets={sheets} current={index} />
          <OverlayLayers comparison={c} sheet={sheet} />
        </aside>
        <OverlayWindow id={c.id} sheet={sheet} index={index} />
      </div>
    );
  }

  return (
    <section
      className="compare-result overlay-result"
      aria-labelledby={titleId}
      data-testid="compare-result"
      data-type="overlay"
    >
      <header className="overlay-head">
        <span className="overlay-head-icon" aria-hidden="true">
          <CommandIcon id="compare.overlay" />
        </span>
        <h2 id={titleId} className="overlay-head-title">
          {typeLabel(c.type)}
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
        <Button
          label={t('compare.result.inputs')}
          size="small"
          onClick={() => {
            updateInputs(c.id, (cur) => ({ ...cur, stage: 'input' }));
          }}
        />
      </header>
      {body}
    </section>
  );
}

/** A page of a side, as the list names it: "3", or "Sheets-B.pdf 3" for a set. */
function usePageLabel(): (p: Sheet['a']) => string {
  const docs = useDocuments((s) => s.docs);
  return (p) => {
    if (!p) return '';
    const page = format.number(p.page + 1);
    return p.file > 0 || Object.keys(docs).length > 2
      ? `${docs[p.docId]?.meta.name ?? ''} ${page}`.trim()
      : page;
  };
}

/** The sheet list (Q14, Q17): one entry per sheet; arrows move, Enter is not needed. */
function SheetList({ id, sheets, current }: { id: string; sheets: Sheet[]; current: number }) {
  const { t } = useTranslation();
  const headingId = useId();
  const label = usePageLabel();
  const go = (i: number): void => {
    updateView(id, (v) => goSheet(v, i, sheets.length));
  };
  return (
    <section className="overlay-sheets" aria-labelledby={headingId}>
      <h3 id={headingId} className="overlay-side-title">
        {t('compare.overlay.sheets')}
      </h3>
      <ul
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
          go(Number.isFinite(d) ? current + d : d > 0 ? sheets.length - 1 : 0);
        }}
      >
        {sheets.map((s, i) => {
          const detail =
            s.a && s.b
              ? t('compare.overlay.sheetPages', { a: label(s.a), b: label(s.b) })
              : s.b
                ? t('compare.overlay.sheetAdded', { b: label(s.b) })
                : t('compare.overlay.sheetRemoved', { a: label(s.a) });
          return (
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- the listbox handles the keys
            <li
              key={i}
              id={`${id}-sheet-${String(i)}`}
              role="option"
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
            </li>
          );
        })}
      </ul>
    </section>
  );
}
