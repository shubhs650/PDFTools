// Status schemes (D-23, §7.3, M3-13): the review codes a stamp and the CRS
// header use (1/2/3/4, A/B/C/D, Approved / … / For Information, or the user's
// own). Presets are read-only data with i18n labels; custom schemes are
// stored on this device and move between devices as `.pdftools-scheme.json`,
// validated strictly on import (never executed). Pure.
import { msg } from '../i18n/keys';

export interface StatusCode {
  code: string;
  /** Custom schemes: the label as typed. */
  label?: string;
  /** Presets: an i18n key (rule 11). */
  labelKey?: string;
  /** #rrggbb, the stamp's colour. */
  color: string;
}

export interface StatusScheme {
  id: string;
  name?: string;
  nameKey?: string;
  codes: StatusCode[];
  preset?: true;
}

export const FORMAT = 'pdftools-scheme';
export const VERSION = 1;
export const MAX_FILE_BYTES = 64 * 1024;
export const MAX_CODES = 20;
export const LIMITS = { name: 64, code: 8, label: 64 } as const;

const GREEN = '#1e7a34';
const BLUE = '#1f5fa8';
const ORANGE = '#a15c07';
const RED = '#b3261e';
const GREY = '#555555';

const NUMERIC: StatusScheme = {
  id: 'preset-numeric',
  nameKey: msg('schemes.preset.numeric.name'),
  preset: true,
  codes: [
    { code: '1', labelKey: msg('schemes.preset.numeric.1'), color: GREEN },
    { code: '2', labelKey: msg('schemes.preset.numeric.2'), color: BLUE },
    { code: '3', labelKey: msg('schemes.preset.numeric.3'), color: ORANGE },
    { code: '4', labelKey: msg('schemes.preset.numeric.4'), color: RED },
  ],
};

const ALPHA: StatusScheme = {
  id: 'preset-alpha',
  nameKey: msg('schemes.preset.alpha.name'),
  preset: true,
  codes: [
    { code: 'A', labelKey: msg('schemes.preset.alpha.A'), color: GREEN },
    { code: 'B', labelKey: msg('schemes.preset.alpha.B'), color: BLUE },
    { code: 'C', labelKey: msg('schemes.preset.alpha.C'), color: ORANGE },
    { code: 'D', labelKey: msg('schemes.preset.alpha.D'), color: RED },
  ],
};

const APPROVAL: StatusScheme = {
  id: 'preset-approval',
  nameKey: msg('schemes.preset.approval.name'),
  preset: true,
  codes: [
    { code: 'AP', labelKey: msg('schemes.preset.approval.AP'), color: GREEN },
    { code: 'AN', labelKey: msg('schemes.preset.approval.AN'), color: BLUE },
    { code: 'RR', labelKey: msg('schemes.preset.approval.RR'), color: ORANGE },
    { code: 'RJ', labelKey: msg('schemes.preset.approval.RJ'), color: RED },
    { code: 'FI', labelKey: msg('schemes.preset.approval.FI'), color: GREY },
  ],
};

export const PRESETS: readonly StatusScheme[] = [NUMERIC, ALPHA, APPROVAL];

/** The scheme used until the user picks one. */
export const DEFAULT_SCHEME: StatusScheme = APPROVAL;
export const DEFAULT_SCHEME_ID = APPROVAL.id;

/** A preset copied into an editable scheme, labels resolved in the UI language. */
export function duplicateScheme(
  s: StatusScheme,
  id: string,
  translate: (key: string) => string,
  name: string,
): StatusScheme {
  return {
    id,
    name,
    codes: s.codes.map((c) => ({
      code: c.code,
      label: c.label ?? (c.labelKey ? translate(c.labelKey) : ''),
      color: c.color,
    })),
  };
}

export type SchemeError =
  | 'name'
  | 'noCodes'
  | 'tooManyCodes'
  | 'code'
  | 'label'
  | 'color'
  | 'duplicate'
  | 'tooLarge'
  | 'json'
  | 'format'
  | 'version'
  | 'unknownKey'
  | 'codes';

const CONTROL = /\p{Cc}/u;
const HEX = /^#[0-9a-f]{6}$/iu;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
/** Length in user-perceived characters. */
const len = (s: string) => Array.from(segmenter.segment(s)).length;
const okText = (s: unknown, max: number): boolean =>
  typeof s === 'string' && s.trim() !== '' && len(s) <= max && !CONTROL.test(s);

/** Problems with a custom scheme (empty when it is valid). Presets are always valid. */
export function validateScheme(s: StatusScheme): SchemeError[] {
  if (s.preset) return [];
  const out = new Set<SchemeError>();
  if (!okText(s.name, LIMITS.name)) out.add('name');
  if (s.codes.length === 0) out.add('noCodes');
  if (s.codes.length > MAX_CODES) out.add('tooManyCodes');
  const seen = new Set<string>();
  for (const c of s.codes) {
    if (!okText(c.code, LIMITS.code)) out.add('code');
    if (!okText(c.label, LIMITS.label)) out.add('label');
    if (!HEX.test(c.color)) out.add('color');
    const key = c.code.trim().toLocaleUpperCase('en');
    if (seen.has(key)) out.add('duplicate');
    seen.add(key);
  }
  return [...out];
}

/** WCAG contrast ratio of `hex` against the white page (stamps are drawn on it). */
export function contrastOnWhite(hex: string): number {
  const ch = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
  return 1.05 / (l + 0.05);
}

export function exportScheme(s: StatusScheme): string {
  return JSON.stringify(
    {
      format: FORMAT,
      version: VERSION,
      scheme: {
        name: s.name ?? '',
        codes: s.codes.map((c) => ({ code: c.code, label: c.label ?? '', color: c.color })),
      },
    },
    null,
    2,
  );
}

const onlyKeys = (o: object, allowed: readonly string[]): boolean =>
  Object.keys(o).every((k) => allowed.includes(k));

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A `.pdftools-scheme.json` file's text → a custom scheme, or why not. */
export function importScheme(
  text: string,
  id: string,
): { scheme: StatusScheme; errors: [] } | { scheme: null; errors: SchemeError[] } {
  const fail = (e: SchemeError) => ({ scheme: null, errors: [e] });
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) return fail('tooLarge');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fail('json');
  }
  if (!isObject(data) || data['format'] !== FORMAT) return fail('format');
  if (!onlyKeys(data, ['format', 'version', 'scheme'])) return fail('unknownKey');
  if (data['version'] !== VERSION) return fail('version');
  const s = data['scheme'];
  if (!isObject(s)) return fail('format');
  if (!onlyKeys(s, ['name', 'codes'])) return fail('unknownKey');
  const codes = s['codes'];
  if (!Array.isArray(codes)) return fail('codes');
  if (codes.length > MAX_CODES) return fail('tooManyCodes');
  const parsed: StatusCode[] = [];
  for (const c of codes as unknown[]) {
    if (!isObject(c)) return fail('codes');
    if (!onlyKeys(c, ['code', 'label', 'color'])) return fail('unknownKey');
    const { code, label, color } = c;
    if (typeof code !== 'string' || typeof label !== 'string' || typeof color !== 'string')
      return fail('codes');
    parsed.push({ code: code.trim(), label: label.trim(), color: color.toLowerCase() });
  }
  const name = s['name'];
  const scheme: StatusScheme = {
    id,
    name: typeof name === 'string' ? name.trim() : '',
    codes: parsed,
  };
  const errors = validateScheme(scheme);
  return errors.length ? { scheme: null, errors } : { scheme, errors: [] };
}
