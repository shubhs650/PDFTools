// What a sheet's alignment says to the user (M12-10, D-60): its status — as
// is, auto-aligned with the shift, scale and rotation found, or low
// confidence — for the sheet list of the result (M12-11).
import { format as appFormat, msg, t } from '../../i18n';
import type { Formatters } from '../../i18n/format';
import { alignmentValues, type SheetAlignment } from '../../model/compare/align/aligner';

export interface AlignmentText {
  /** "As is", "Auto-aligned" or "Low confidence". */
  status: string;
  /** The values found ("Shift 14.0, 9.0 pt · scale 98.2% · rotation 0.00°"), or null as is. */
  values: string | null;
  /** What to do about a low-confidence sheet, or null. */
  hint: string | null;
}

const STATUS = {
  'as-is': msg('compare.align.asIs'),
  auto: msg('compare.align.auto'),
  low: msg('compare.align.low'),
} as const;

export function alignmentText(al: SheetAlignment, format: Formatters = appFormat): AlignmentText {
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
    status: t(STATUS[al.status]),
    values,
    hint: al.status === 'low' ? t('compare.align.lowHint') : null,
  };
}
