// Tokens for the word-level text comparison (M12-17, D-63, Q27, spike S30).
// Engineering values stay whole: a number with its separators, sign, currency
// and unit (`1,450.00 mm`, `$3,200`, `18%`, `≥50 MΩ`, `bar(g)`), a tag or
// document number (`P-101A`, `DOC-4410-REV2`, `HT-99241-A`), a date
// (`2026-11-22`, `22.11.2026`). Words of spaced scripts are one token each;
// scripts written without spaces (Han, kana, Thai, …) are one token per
// character (grapheme cluster), so a changed character is a changed character.
// Each token keeps a normalised key: NFKC (ligatures, full-width forms),
// dashes and quotes unified, the space between a number and its unit dropped.
// Pure code.

/** Token kinds, as stored in a Uint8Array. */
export const TOKEN_KINDS = ['number', 'value', 'tag', 'date', 'word', 'char', 'punct'] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];
export const kindCode = (k: TokenKind): number => TOKEN_KINDS.indexOf(k);

export interface Token {
  /** Text as read (spaces inside a value kept). */
  text: string;
  /** Comparison key. */
  key: string;
  kind: TokenKind;
  /** Offsets in the source string (UTF-16). */
  start: number;
  end: number;
  /** For numbers and values: the numeric value (percent change). */
  num?: number;
}

/** Units recognised after a number (longer forms before their prefixes). */
const UNITS = [
  'bar\\(g\\)',
  'bar\\(a\\)',
  'kN·m',
  'kN\\.m',
  'kNm',
  'N·m',
  'N\\/mm²',
  'N\\/mm2',
  'kN\\/m²',
  'kN\\/m',
  'mm\\/s',
  'm\\/s²',
  'm\\/s',
  'm³\\/h',
  'm3\\/h',
  'l\\/min',
  'L\\/min',
  'kg\\/m³',
  'MPa',
  'GPa',
  'kPa',
  'Pa',
  'bar',
  'psi',
  'MΩ',
  'kΩ',
  'Ω',
  'kN',
  'MN',
  'kW',
  'MW',
  'kV',
  'kVA',
  'Hz',
  'rpm',
  'mm²',
  'mm',
  'cm',
  'km',
  'm²',
  'm³',
  'µm',
  'μm',
  'um',
  'm',
  'kg',
  't',
  'g',
  '°C',
  '°F',
  '℃',
  '°',
  'K',
  '%',
  'mo',
  'months?',
  'days?',
  'weeks?',
  'years?',
  'hrs?',
  'h',
  'min',
  's',
  'ms',
  'dB\\(A\\)',
  'dB',
  'V',
  'A',
  'W',
  'N',
  'mm\\/m',
];
const UNIT = `(?:${UNITS.join('|')})`;

/** A number: optional sign or comparison, currency, digits with group separators, decimals. */
const NUM = String.raw`(?:[≥≤><±~≈]\s?)?[+\-−]?(?:[$€£₹¥]\s?)?(?:\d{1,3}(?:,\d{3})+|\d+)(?:[.,]\d+)?`;
const DATE = String.raw`\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{2,4}`;
// A tag: letters and digits joined by - / . _ , at least one letter and one digit (checked after).
const TAG = String.raw`[\p{L}\p{N}]+(?:[-/._][\p{L}\p{N}]+)+|\p{Lu}+\d+[\p{L}\d]*|\d+\p{Lu}+[\p{L}\d]*`;

/**
 * Scripts written without spaces between words: one token per grapheme.
 * Script extensions, so the long-vowel mark and the middle dot shared by kana
 * count.
 */
const NO_SPACE_RUN =
  /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Thai}\p{scx=Lao}\p{scx=Khmer}\p{scx=Myanmar}\p{scx=Tibetan}]+/gu;
/**
 * A run counts only with a letter of such a script in it: shared marks alone
 * (the middle dot of `kN·m` is also a Han script extension) stay with their
 * neighbours.
 */
const NO_SPACE_LETTER =
  /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}\p{sc=Tibetan}]/u;

const RE = new RegExp(
  [
    `(?<date>${DATE})(?![\\p{L}\\p{N}])`,
    `(?<value>${NUM}(?:\\s?${UNIT})(?![\\p{L}\\p{N}]))`,
    `(?<number>${NUM})(?![\\p{L}\\p{N}]|[-/_.][\\p{L}\\p{N}])`,
    `(?<tag>${TAG})`,
    `(?<word>[\\p{L}\\p{M}\\p{N}][\\p{L}\\p{M}\\p{N}'’·]*)`,
    `(?<punct>[^\\s])`,
  ].join('|'),
  'gu',
);

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The normalisation of every key. */
export function normKey(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/μ/g, 'µ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The numeric value of a number or value token, or undefined. */
export function numberOf(text: string): number | undefined {
  const m = /[+\-−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:[.,]\d+)?/.exec(text.normalize('NFKC'));
  if (!m) return undefined;
  let s = m[0].replace('−', '-');
  // "1,450.00" → grouping commas; "3,5" (one comma, not 3 digits after) → decimal comma.
  if (/,\d{3}(?:\D|$)/.test(s) || /,\d{3},/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
}

/** The tokens of a text (NFC first: a combined character is one unit). */
export function tokenize(src: string): Token[] {
  const s = src.normalize('NFC');
  const out: Token[] = [];
  // Runs of a no-space script are cut out first, so a Latin run or a number
  // next to them ("板厚8.0 mm", "SUS316L") is tokenised as usual.
  let last = 0;
  for (const m of s.matchAll(NO_SPACE_RUN)) {
    if (!NO_SPACE_LETTER.test(m[0])) continue;
    spaced(s.slice(last, m.index), last, out);
    for (const { segment, index } of segmenter.segment(m[0]))
      out.push(tok(segment, 'char', m.index + index));
    last = m.index + m[0].length;
  }
  spaced(s.slice(last), last, out);
  return out;
}

/** A date only when one of day and month can be a month: "17/15/12" is a code. */
function plausibleDate(t: string): boolean {
  if (/^\d{4}-/.test(t)) {
    const [, mo = 0, d = 0] = t.split('-').map(Number);
    return mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
  }
  const [a = 0, b = 0] = t.split(/[./]/).map(Number);
  return a >= 1 && b >= 1 && Math.min(a, b) <= 12 && Math.max(a, b) <= 31;
}

function spaced(s: string, offset: number, out: Token[]): void {
  for (const m of s.matchAll(RE)) {
    const g = m.groups ?? {};
    const text = m[0];
    let kind: TokenKind = 'punct';
    if (g['date']) kind = plausibleDate(text) ? 'date' : 'tag';
    else if (g['value']) kind = 'value';
    else if (g['tag'])
      kind =
        /\p{L}/u.test(text) && /\p{N}/u.test(text)
          ? 'tag'
          : /\p{N}/u.test(text)
            ? 'number'
            : 'word';
    else if (g['number']) kind = 'number';
    else if (g['word']) kind = 'word';
    out.push(tok(text, kind, offset + m.index));
  }
}

function tok(text: string, kind: TokenKind, start: number): Token {
  let key = normKey(text);
  // "6 mm" and "6mm" are the same value; "$ 1,450" and "$1,450" too.
  if (kind === 'value' || kind === 'number') key = key.replace(/\s+/g, '');
  const t: Token = { text, key, kind, start, end: start + text.length };
  if (kind === 'value' || kind === 'number') {
    const v = numberOf(text);
    if (v !== undefined) t.num = v;
  }
  return t;
}

/** Percent change from one number to another (undefined when the old one is 0). */
export function percentChange(a: number, b: number): number | undefined {
  if (a === 0) return undefined;
  return ((b - a) / Math.abs(a)) * 100;
}

/** Typical OCR confusions (S30): two texts the same under these are a "possible OCR error". */
const OCR_FOLD: [RegExp, string][] = [
  [/rn/g, 'm'],
  [/[O0oQD]/g, '0'],
  [/[Il1|!]/g, '1'],
  [/[S5$]/g, '5'],
  [/[B8]/g, '8'],
  [/[Z2]/g, '2'],
  [/[G6]/g, '6'],
  [/vv/g, 'w'],
  [/cl/g, 'd'],
];

/** A text with the typical OCR confusions folded together. */
export function ocrFold(s: string): string {
  let t = s;
  for (const [re, to] of OCR_FOLD) t = t.replace(re, to);
  return t;
}
