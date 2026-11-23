// The wording of a text comparison's changes (M12-19, D-64): each kind's own
// name and the labels a change carries. Shared by the list and the change
// register (M12-21).
import type { TFunction } from 'i18next';
import { format, msg, type MessageKey } from '../../../i18n';
import type { TextChange, TextChangeKind } from '../../../model/compare/text/match';

export const KIND_LABEL: Record<TextChangeKind, MessageKey> = {
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

/** The kind's own wording ("Header changed", "Clauses renumbered"). */
export function kindLabel(t: TFunction, c: TextChange): string {
  return t(KIND_LABEL[c.kind]);
}

/**
 * The labels a change carries: percent, OCR, its table row and column, a
 * figure's difference, … (the register has a column of its own for the percent).
 */
export function badges(t: TFunction, c: TextChange, percent = true): string[] {
  const out: string[] = [];
  if (percent && c.pct !== undefined)
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
