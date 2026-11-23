import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from '../../i18n';
import { scoreOf, setPartner } from '../../model/compare/pairing';
import { Dialog } from '../../ui/components';
import { dialogHelp } from '../help/openHelp';
import { PagePicture } from './PagePicture';
import { editPairing, usePairing } from './pairingFlow';
import { usePageLabel } from './pairingLabels';
import type { SideId } from './model';

/** The box a page picture of the grid fits in. */
const BOX = { width: 128, height: 104 };

/** "None": no page on this side (the sheet is added in B or removed from A). */
const NONE = -1;

/**
 * The page picker (M12-24, ADR-033): a grid of every page of one side of an
 * overlay, opened from a pairing row's picture. "None" comes first, the
 * sheet's page is marked, and a click (or Enter) pairs the page with the
 * sheet, as the row's list does. Arrow keys, Home and End move in the grid.
 */
export function PagePicker({
  id,
  row,
  side,
  onClose,
}: {
  id: string;
  row: number;
  side: SideId;
  /** `picked`: a page was chosen (the row was edited). */
  onClose: (picked: boolean) => void;
}) {
  const { t } = useTranslation();
  const p = usePairing(id);
  const label = usePageLabel(p);
  const r = p?.rows[row];
  const current = r?.[side] ?? null;
  const choices = p ? [NONE, ...p.pages[side].keys()] : [];
  const [focus, setFocus] = useState(() => Math.max(0, choices.indexOf(current ?? NONE)));
  const grid = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  if (!p || !r) return null;
  const other = side === 'a' ? r.b : r.a;
  const sideName = side === 'a' ? t('compare.side.a') : t('compare.side.b');
  const sheet = format.number(row + 1);

  const pick = (k: number): void => {
    editPairing(id, (rows) => setPartner(rows, row, side, k === NONE ? null : k));
    onClose(true);
  };
  const move = (to: number): void => {
    const i = Math.max(0, Math.min(choices.length - 1, to));
    setFocus(i);
    grid.current?.querySelectorAll<HTMLButtonElement>('button')[i]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const buttons = [...(grid.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const top = buttons[0]?.offsetTop ?? 0;
    const cols = Math.max(1, buttons.filter((b) => b.offsetTop === top).length);
    const step: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -cols,
      ArrowDown: cols,
    };
    if (e.key in step) move(focus + (step[e.key] ?? 0));
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(choices.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose(false);
      }}
      title={t('compare.picker.title', { side: sideName, sheet })}
      description={t('compare.picker.description')}
      help={dialogHelp('compare-start')}
      closeIcon={<Dismiss20Regular />}
      className="compare-picker-dialog"
      initialFocus={first}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- arrow keys move between its buttons (roving focus) */}
      <div
        ref={grid}
        className="compare-picker"
        role="group"
        aria-label={t('compare.picker.pages', { side: sideName })}
        data-testid="compare-picker"
        onKeyDown={onKeyDown}
      >
        {choices.map((k, i) => {
          const chosen = (k === NONE ? null : k) === current;
          const score =
            k === NONE || other === null || !p.result
              ? null
              : side === 'a'
                ? scoreOf(p.result, k, other)
                : scoreOf(p.result, other, k);
          const page = k === NONE ? undefined : p.pages[side][k];
          return (
            <button
              key={k}
              ref={i === focus ? first : undefined}
              type="button"
              className="compare-picker-page ui-focusable"
              aria-pressed={chosen}
              tabIndex={i === focus ? 0 : -1}
              data-page={k === NONE ? '' : k}
              onFocus={() => {
                setFocus(i);
              }}
              onClick={() => {
                pick(k);
              }}
            >
              <span className="compare-picker-frame">
                {page ? (
                  <PagePicture docId={page.docId} page={page.page} box={BOX} priority={i} />
                ) : (
                  <span className="compare-picker-none" aria-hidden="true" />
                )}
              </span>
              <span className="compare-picker-label">
                {k === NONE
                  ? side === 'a'
                    ? t('compare.pairing.noneA')
                    : t('compare.pairing.noneB')
                  : label(side, k)}
              </span>
              {score === null ? null : (
                <span className="compare-picker-score">
                  {' '}
                  {t('compare.picker.match', {
                    match: format.percent(Math.min(1, Math.max(0, score)), 0),
                  })}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}
