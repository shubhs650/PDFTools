// Locale-aware formatting through Intl only (D-30, §8.2). The UI language is
// English at launch, but numbers, dates and units follow the user's locale.

export interface Formatters {
  readonly locale: string;
  number(value: number, maximumFractionDigits?: number): string;
  /** Exactly `digits` decimals: measured values show their precision ("20.00 m"). */
  fixed(value: number, digits: number): string;
  /** 0.256 → "25.6 %" (locale-dependent spacing and separators). */
  percent(fraction: number, maximumFractionDigits?: number): string;
  /** Zoom factor 1.25 → "125 %"; below 10 % keeps one decimal. */
  zoom(factor: number): string;
  /** File sizes in decimal units: 1_500_000 → "1.5 MB". */
  bytes(count: number): string;
  date(value: Date | number): string;
  dateTime(value: Date | number): string;
  /** Relative to `now`: "3 minutes ago", "yesterday". */
  relative(value: Date | number, now?: Date | number): string;
  /** ["a", "b", "c"] → "a, b, and c" (conjunction, locale-dependent). */
  list(items: readonly string[]): string;
}

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;

const RELATIVE_STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.34524],
  ['month', 12],
  ['year', Number.POSITIVE_INFINITY],
];

export function createFormatters(locale: string): Formatters {
  const cache = new Map<string, Intl.NumberFormat>();
  const nf = (key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat => {
    let f = cache.get(key);
    if (!f) {
      f = new Intl.NumberFormat(locale, options);
      cache.set(key, f);
    }
    return f;
  };
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const dateTimeFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const lf = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' });

  return {
    locale,
    list: (items) => lf.format(items),
    number: (value, max = 2) => nf(`n${String(max)}`, { maximumFractionDigits: max }).format(value),
    fixed: (value, digits) =>
      nf(`f${String(digits)}`, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(value),
    percent: (fraction, max = 1) =>
      nf(`p${String(max)}`, { style: 'percent', maximumFractionDigits: max }).format(fraction),
    zoom: (factor) =>
      nf(factor < 0.1 ? 'z1' : 'z0', {
        style: 'percent',
        maximumFractionDigits: factor < 0.1 ? 1 : 0,
      }).format(factor),
    bytes: (count) => {
      let value = count;
      let i = 0;
      while (Math.abs(value) >= 1000 && i < BYTE_UNITS.length - 1) {
        value /= 1000;
        i++;
      }
      const unit = BYTE_UNITS[i] ?? 'byte';
      return nf(`b${unit}`, {
        style: 'unit',
        unit,
        unitDisplay: 'short',
        maximumFractionDigits: i === 0 ? 0 : 1,
      }).format(value);
    },
    date: (value) => dateFmt.format(value),
    dateTime: (value) => dateTimeFmt.format(value),
    relative: (value, now = Date.now()) => {
      let delta = (Number(value) - Number(now)) / 1000;
      for (const [unit, size] of RELATIVE_STEPS) {
        if (Math.abs(delta) < size) return rtf.format(Math.round(delta), unit);
        delta /= size;
      }
      return rtf.format(Math.round(delta), 'year');
    },
  };
}

/**
 * Parses a number typed in the user's locale: its digits, decimal separator
 * and grouping ("1.234,5" in de, "١٢" in ar). Returns null if it isn't one.
 */
export function parseLocaleNumber(text: string, locale: string): number | null {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const group = parts.find((p) => p.type === 'group')?.value ?? ',';
  const decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.';
  const native = new Intl.NumberFormat(locale, { useGrouping: false });
  let s = text.trim().replace(/\s/g, '');
  if (group.trim() !== '') s = s.split(group).join('');
  for (let d = 0; d <= 9; d++) s = s.replaceAll(native.format(d), String(d));
  if (decimal !== '.') s = s.replace(decimal, '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  return Number(s);
}
