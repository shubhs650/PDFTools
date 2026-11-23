import { Eye20Regular } from '@fluentui/react-icons/svg/eye';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from '../../i18n';
import {
  rowCheck,
  scoreOf,
  setExcluded,
  setPartner,
  type PairRow,
} from '../../model/compare/pairing';
import { Button, IconButton, ProgressBar } from '../../ui/components';
import { CheckMark } from './CheckMark';
import { PagePicker } from './PagePicker';
import { PagePicture } from './PagePicture';
import { PairPreview } from './PairPreview';
import { usePageLabel } from './pairingLabels';
import {
  editPairing,
  pairingEdited,
  partnerOptions,
  resetPairing,
  usePairing,
  type PairingState,
} from './pairingFlow';
import { SIDES, type SideId } from './model';

const NONE = '';

/**
 * The pairing table of an overlay comparison (M12-09, D-60, ARCHITECTURE
 * §7.16): which page of Document A is compared with which page of Document B,
 * found automatically and editable. Each row is a sheet: change a partner,
 * choose None to mark a page as added (B only) or removed (A only), or leave a
 * sheet out of the comparison. With several files on a side, pages are shown
 * with their file's name.
 *
 * M12-24 (ADR-033): each row shows a picture of its A and B page; a picture
 * opens the page picker; the eye button opens Preview pair; a sheet that
 * needs a look (a weak match, a page added or removed) is marked "Check".
 */
export function PairingTable({ id }: { id: string }) {
  const { t } = useTranslation();
  const headingId = useId();
  const p = usePairing(id);
  if (!p) return null;
  const done = p.status === 'done';
  const edited = done && pairingEdited(p);
  return (
    <section
      className="compare-pairing"
      aria-labelledby={headingId}
      aria-busy={!done && p.status !== 'failed'}
      data-testid="compare-pairing"
      data-status={p.status}
    >
      <div className="compare-pairing-head">
        <h3 id={headingId} className="compare-side-title">
          {t('compare.pairing.title')}
        </h3>
        {edited ? (
          <span className="compare-pairing-edited">{t('compare.pairing.edited')}</span>
        ) : null}
        <Button
          label={t('compare.pairing.reset')}
          size="small"
          disabled={!edited}
          onClick={() => {
            resetPairing(id);
          }}
        />
      </div>
      <PairingStatus p={p} />
      {done ? <Rows id={id} p={p} /> : null}
    </section>
  );
}

function PairingStatus({ p }: { p: PairingState }) {
  const { t } = useTranslation();
  if (p.status === 'reading' || p.status === 'matching') {
    const label =
      p.status === 'reading'
        ? t('compare.pairing.reading', {
            done: format.number(p.done),
            total: format.number(p.total),
          })
        : t('compare.pairing.matching');
    return (
      <div className="compare-pairing-progress" role="status">
        <span>{label}</span>
        <ProgressBar
          label={t('compare.pairing.title')}
          value={p.status === 'reading' && p.total > 0 ? p.done / p.total : null}
        />
      </div>
    );
  }
  if (p.status === 'failed')
    return (
      <p className="compare-pairing-status" role="status">
        {t('compare.pairing.failed')}
      </p>
    );
  let compared = 0;
  let added = 0;
  let removed = 0;
  for (const r of p.rows) {
    if (r.a !== null && r.b !== null) compared += r.excluded ? 0 : 1;
    else if (r.a !== null) removed++;
    else added++;
  }
  return (
    <p className="compare-pairing-status" role="status">
      {t('compare.pairing.summary', {
        sheets: t('compare.pairing.sheets', { count: compared }),
        added: format.number(added),
        removed: format.number(removed),
      })}
    </p>
  );
}

/** The box a row's page picture fits in (about 160 px wide, ADR-033). */
const ROW_BOX = { width: 160, height: 120 };

function Rows({ id, p }: { id: string; p: PairingState }) {
  const { t } = useTranslation();
  const label = usePageLabel(p);
  const [picker, setPicker] = useState<{ row: number; side: SideId } | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  // A pick re-keys the sheet's row: focus goes back to the new row's picture.
  const [refocus, setRefocus] = useState<{ row: number; side: SideId } | null>(null);
  useEffect(() => {
    if (!refocus) return;
    const timer = setTimeout(() => {
      const row = scroll.current?.querySelectorAll('tbody tr')[refocus.row];
      const el = row?.querySelector<HTMLElement>(
        `[data-testid="compare-pairing-picture-${refocus.side}"]`,
      );
      if (el && !el.contains(document.activeElement)) el.focus();
      setRefocus(null);
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [refocus]);
  const edit = (fn: (rows: PairRow[]) => PairRow[]): void => {
    editPairing(id, fn);
  };
  const choose = (row: number, side: SideId, value: string): void => {
    edit((rows) => setPartner(rows, row, side, value === NONE ? null : Number(value)));
  };
  const sideLabel = { a: t('compare.side.a'), b: t('compare.side.b') };
  return (
    <div ref={scroll} className="compare-pairing-scroll">
      <table className="compare-pairing-table">
        <caption className="ui-visually-hidden">{t('compare.pairing.caption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('compare.pairing.sheet')}</th>
            <th scope="col">{sideLabel.a}</th>
            <th scope="col">{sideLabel.b}</th>
            <th scope="col">{t('compare.pairing.match')}</th>
            <th scope="col">{t('compare.pairing.compare')}</th>
          </tr>
        </thead>
        <tbody>
          {p.rows.map((r, i) => {
            const sheet = format.number(i + 1);
            const score = p.result ? scoreOf(p.result, r.a, r.b) : null;
            const paired = r.a !== null && r.b !== null;
            const check = rowCheck(r, score);
            return (
              <tr
                key={`${String(r.a)}:${String(r.b)}`}
                data-testid="compare-pairing-row"
                data-a={r.a ?? ''}
                data-b={r.b ?? ''}
                data-excluded={r.excluded ? '' : undefined}
                data-check={check ?? undefined}
              >
                <th scope="row">{sheet}</th>
                {SIDES.map((side) => {
                  const k = r[side];
                  const page = k === null ? undefined : p.pages[side][k];
                  return (
                    <td key={side} className="compare-pairing-side">
                      <button
                        type="button"
                        className="compare-pairing-picture ui-focusable"
                        aria-label={t('compare.picker.open', { side: sideLabel[side], sheet })}
                        aria-haspopup="dialog"
                        data-testid={`compare-pairing-picture-${side}`}
                        onClick={() => {
                          setPicker({ row: i, side });
                        }}
                      >
                        {page ? (
                          <PagePicture
                            docId={page.docId}
                            page={page.page}
                            box={ROW_BOX}
                            priority={i}
                          />
                        ) : (
                          <span className="compare-pairing-nopage" aria-hidden="true">
                            {t('compare.pairing.none')}
                          </span>
                        )}
                      </button>
                      <select
                        className="ui-field-input compare-pairing-select"
                        aria-label={t('compare.pairing.choose', { side: sideLabel[side], sheet })}
                        value={k === null ? NONE : String(k)}
                        onChange={(e) => {
                          choose(i, side, e.currentTarget.value);
                        }}
                      >
                        <option value={NONE}>
                          {side === 'a' ? t('compare.pairing.noneA') : t('compare.pairing.noneB')}
                        </option>
                        {partnerOptions(p, side, r).map((o) => (
                          <option key={o} value={String(o)}>
                            {label(side, o)}
                          </option>
                        ))}
                      </select>
                    </td>
                  );
                })}
                <td className="compare-pairing-match">
                  <span className="compare-pairing-score">
                    {paired
                      ? score === null
                        ? ''
                        : format.percent(Math.min(1, Math.max(0, score)), 0)
                      : r.a === null
                        ? t('compare.pairing.added')
                        : t('compare.pairing.removed')}
                  </span>
                  {check ? <CheckMark check={check} /> : null}
                  <IconButton
                    label={t('compare.pairPreview.open', { sheet })}
                    icon={<Eye20Regular />}
                    size="small"
                    aria-haspopup="dialog"
                    onClick={() => {
                      setPreview(i);
                    }}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    className="ui-focusable"
                    aria-label={t('compare.pairing.include', { sheet })}
                    checked={paired && !r.excluded}
                    disabled={!paired}
                    onChange={(e) => {
                      const on = e.currentTarget.checked;
                      edit((rows) => setExcluded(rows, i, !on));
                    }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {picker ? (
        <PagePicker
          id={id}
          row={picker.row}
          side={picker.side}
          onClose={(picked) => {
            if (picked) setRefocus(picker);
            setPicker(null);
          }}
        />
      ) : null}
      {preview !== null ? (
        <PairPreview
          id={id}
          row={Math.min(preview, p.rows.length - 1)}
          onRow={setPreview}
          onClose={() => {
            setPreview(null);
          }}
        />
      ) : null}
    </div>
  );
}
