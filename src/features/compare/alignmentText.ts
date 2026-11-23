// What a sheet's alignment says to the user (M12-10, D-60; plain words since
// M12-26, ADR-033): Already lined up, Lined up automatically (with the shift,
// scale and rotation found), Check alignment, Lined up by hand, or Checked by
// you — for the sheet list, the Alignment section and the banner.
import { format as appFormat, msg, t } from '../../i18n';
import type { Formatters } from '../../i18n/format';
import {
  alignmentValues,
  type AlignStatus,
  type SheetAlignment,
} from '../../model/compare/align/aligner';

/** The status the user sees: the alignment's own, or "Checked by you" (M12-26). */
export type ShownStatus = AlignStatus | 'checked';

/** "Checked by you" stands for an uncertain alignment the user accepted. */
export const shownStatus = (al: SheetAlignment, checked: boolean): ShownStatus =>
  checked && al.status === 'low' ? 'checked' : al.status;

export interface AlignmentText {
  /** "Already lined up", "Lined up automatically", "Check alignment", "Lined up by hand", "Checked by you". */
  status: string;
  shown: ShownStatus;
  /** The values found ("Shift 14.0, 9.0 pt · scale 98.2% · rotation 0.00°"), or null as is. */
  values: string | null;
  /** What to do about a low-confidence sheet, or null. */
  hint: string | null;
}

const STATUS = {
  'as-is': msg('compare.align.asIs'),
  auto: msg('compare.align.auto'),
  low: msg('compare.align.low'),
  manual: msg('compare.align.manual'),
  checked: msg('compare.align.checked'),
} as const;

export function alignmentText(
  al: SheetAlignment,
  checked = false,
  format: Formatters = appFormat,
): AlignmentText {
  const shown = shownStatus(al, checked);
  const v = alignmentValues(al.place);
  // −0.00 reads as a sign the user never asked for.
  const fixed = (n: number, digits: number): string =>
    format.fixed(Math.abs(n) < 0.5 * 10 ** -digits ? 0 : n, digits);
  const values =
    al.status === 'as-is'
      ? null
      : t('compare.align.values', {
          dx: fixed(v.dx, 1),
          dy: fixed(v.dy, 1),
          scale: format.percent(v.scale, 2),
          deg: fixed(v.deg, 2),
        });
  return {
    status: t(STATUS[shown]),
    shown,
    values,
    hint: shown === 'low' ? t('compare.align.lowHint') : null,
  };
}
