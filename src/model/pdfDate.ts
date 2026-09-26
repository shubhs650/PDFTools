// PDF date strings (ISO 32000-1 §7.9.4): D:YYYYMMDDHHmmSSOHH'mm' where every
// part after the year is optional and O is +, - or Z. Used by attachments
// (M2-11) and Document Properties (M2-12). Pure.

/** The instant a PDF date names, or null when it isn't one. Missing parts default (month 1, day 1, 00:00:00 UTC). */
export function parsePdfDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const m =
    /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([+\-Zz])(?:(\d{2})'?(?:(\d{2})'?)?)?)?\s*$/.exec(
      raw.trim(),
    );
  if (!m) return null;
  const n = (s: string | undefined, d: number) => (s === undefined ? d : Number(s));
  const year = n(m[1], 0);
  const month = n(m[2], 1);
  const day = n(m[3], 1);
  const hour = n(m[4], 0);
  const minute = n(m[5], 0);
  const second = n(m[6], 0);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59)
    return null;
  let offset = 0;
  const sign = m[7];
  if (sign === '+' || sign === '-') {
    offset = (n(m[8], 0) * 60 + n(m[9], 0)) * (sign === '+' ? 1 : -1);
  }
  const utc = Date.UTC(year, month - 1, day, hour, minute, second) - offset * 60_000;
  return new Date(utc);
}
