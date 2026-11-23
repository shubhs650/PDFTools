import { ArrowLeft20Regular } from '@fluentui/react-icons/svg/arrow-left';
import { ArrowRight20Regular } from '@fluentui/react-icons/svg/arrow-right';
import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useTranslation } from 'react-i18next';
import { format } from '../../i18n';
import { rowCheck, scoreOf } from '../../model/compare/pairing';
import { Button, Dialog } from '../../ui/components';
import { dialogHelp } from '../help/openHelp';
import { PagePicture } from './PagePicture';
import { usePairing } from './pairingFlow';
import { usePageLabel } from './pairingLabels';
import { SIDES } from './model';
import { CheckMark } from './CheckMark';

/** The box each page of the pair fits in. */
const BOX = { width: 520, height: 440 };

/**
 * Preview pair (M12-24, ADR-033): a sheet's A and B page large, side by side,
 * with Previous pair and Next pair, so the whole pairing can be checked before
 * Compare. A sheet with one page shows "None" on the other side.
 */
export function PairPreview({
  id,
  row,
  onRow,
  onClose,
}: {
  id: string;
  row: number;
  onRow: (row: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const p = usePairing(id);
  const label = usePageLabel(p);
  const r = p?.rows[row];
  if (!p || !r) return null;
  const count = p.rows.length;
  const score = p.result ? scoreOf(p.result, r.a, r.b) : null;
  const check = rowCheck(r, score);
  const match =
    r.a !== null && r.b !== null
      ? score === null
        ? ''
        : t('compare.pairPreview.match', {
            match: format.percent(Math.min(1, Math.max(0, score)), 0),
          })
      : r.a === null
        ? t('compare.pairing.added')
        : t('compare.pairing.removed');
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('compare.pairPreview.title', {
        sheet: format.number(row + 1),
        count: format.number(count),
      })}
      help={dialogHelp('compare-start')}
      closeIcon={<Dismiss20Regular />}
      className="compare-pairview-dialog"
      footer={
        <>
          <Button
            label={t('compare.pairPreview.previous')}
            icon={<ArrowLeft20Regular />}
            disabled={row === 0}
            onClick={() => {
              onRow(row - 1);
            }}
          />
          <Button
            label={t('compare.pairPreview.next')}
            icon={<ArrowRight20Regular />}
            disabled={row >= count - 1}
            onClick={() => {
              onRow(row + 1);
            }}
          />
        </>
      }
    >
      <p className="compare-pairview-match" role="status" data-testid="compare-pairview-match">
        <span>{match}</span>
        {check ? <CheckMark check={check} /> : null}
      </p>
      <div className="compare-pairview-pair" data-testid="compare-pairview">
        {SIDES.map((side) => {
          const k = r[side];
          const page = k === null ? undefined : p.pages[side][k];
          const sideName = side === 'a' ? t('compare.side.a') : t('compare.side.b');
          return (
            <figure key={side} className="compare-pairview-side" data-side={side}>
              <figcaption>
                <span className="compare-pairview-side-name">{sideName}</span>{' '}
                <span>
                  {k === null
                    ? side === 'a'
                      ? t('compare.pairing.noneA')
                      : t('compare.pairing.noneB')
                    : label(side, k)}
                </span>
              </figcaption>
              <div className="compare-pairview-frame">
                {page ? (
                  <PagePicture docId={page.docId} page={page.page} box={BOX} priority={0} />
                ) : (
                  <span className="compare-pairview-none">{t('compare.pairPreview.noPage')}</span>
                )}
              </div>
            </figure>
          );
        })}
      </div>
    </Dialog>
  );
}
