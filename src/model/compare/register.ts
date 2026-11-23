// The change register (M12-21, D-65, Q34, ARCHITECTURE §7.16): every
// difference the list shows, in the list's order, as rows of cells for a
// spreadsheet (Excel through the CRS workbook builder) or CSV. A column set
// per comparison type: a PDF overlay names the sheet and each revision's
// page, a text comparison the pages; both give kind, old, new, percent and
// checked. Wording comes in through `labels` (i18n stays in the feature);
// numbers are written plainly so a spreadsheet takes them as numbers. Pure.
import type { DiffEntry, DiffKind, DiffType } from './detect/entries';
import type { TextChange, TextChangeKind } from './text/match';
import { numberOf, percentChange, tokenize } from './text/tokens';

/** The columns of each register, in order (their titles are i18n keys in the feature). */
export const OVERLAY_COLUMNS = [
  'number',
  'sheet',
  'pageA',
  'pageB',
  'kind',
  'type',
  'old',
  'new',
  'percent',
  'checked',
] as const;
export const TEXT_COLUMNS = [
  'number',
  'pageA',
  'pageB',
  'kind',
  'old',
  'new',
  'percent',
  'notes',
  'checked',
] as const;

export type RegisterColumn = (typeof OVERLAY_COLUMNS)[number] | (typeof TEXT_COLUMNS)[number];

/** Columns a spreadsheet takes as numbers. */
const NUMBER_COLUMNS: readonly RegisterColumn[] = ['number', 'sheet', 'percent'];

/** The longest text a spreadsheet cell holds is 32,767 characters; a little less is kept. */
export const MAX_CELL = 32000;

/** A page of one revision: the file of its side (0-based) and the page in it (0-based). */
export interface PageRef {
  file: number;
  page: number;
}

export interface RegisterLabels {
  /** A difference's kind (overlay: added, removed, changed; text: the engine's kinds). */
  kind: (kind: DiffKind | TextChangeKind) => string;
  /** Text, geometry or both (overlay). */
  type: (type: DiffType) => string;
  /** A page as the reader finds it ("RevA.pdf, page 3", or "3" for a single file). */
  page: (side: 'a' | 'b', ref: PageRef) => string;
  /** The checked column's word for a ticked difference. */
  yes: string;
  /** The labels a text change carries (its table row and column, OCR, …). */
  notes: (change: TextChange) => string[];
}

const clip = (s: string): string => (s.length > MAX_CELL ? `${s.slice(0, MAX_CELL - 1)}…` : s);

/** Two decimals at most, written with a full stop (a spreadsheet's number). */
const num = (v: number | null | undefined): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '' : String(Math.round(v * 100) / 100);

/**
 * The percent change of a value written as one number on each side ("Ø120"
 * → "Ø128": 6.67); null for words, several numbers, or an old value of 0.
 */
export function valuePercent(oldText: string, newText: string): number | null {
  const a = valueOf(oldText);
  const b = valueOf(newText);
  // A tag compares when its letters agree ("Ø120" and "Ø128", not "M12" and "Ø16").
  if (a?.unit === undefined || a.unit !== b?.unit) return null;
  const p = percentChange(a.value, b.value);
  return p === undefined ? null : Math.round(p * 100) / 100;
}

/** The one number a text holds, with the letters around it when it is a tag ("Ø120"). */
function valueOf(s: string): { value: number; unit: string } | null {
  const toks = tokenize(s);
  const nums = toks.filter((t) => t.num !== undefined);
  if (nums.length === 1) {
    const value = nums[0]?.num;
    return value === undefined ? null : { value, unit: '' };
  }
  const only = toks.length === 1 ? toks[0] : undefined;
  if (only?.kind !== 'tag') return null;
  const m = /^(\D*)(\d[\d,.]*)(\D*)$/u.exec(only.text.normalize('NFKC'));
  const value = m ? numberOf(m[2] ?? '') : undefined;
  return m && value !== undefined ? { value, unit: `${m[1] ?? ''}|${m[3] ?? ''}` } : null;
}

/** A sheet of a PDF overlay: each revision's page, or null on a side without one. */
export interface RegisterSheet {
  a: PageRef | null;
  b: PageRef | null;
}

/** A difference of a PDF overlay as the list shows it. */
export interface OverlayItem {
  /** Its id in the list (`pair|key`): ticks are kept by it. */
  id: string;
  /** Its sheet, the index in the result's sheets (0-based). */
  sheet: number;
  entry: DiffEntry;
}

/** The register of a PDF overlay: one row per difference, numbered from 1 (OVERLAY_COLUMNS). */
export function overlayRegister(
  items: readonly OverlayItem[],
  sheets: readonly RegisterSheet[],
  checked: ReadonlySet<string>,
  labels: RegisterLabels,
): string[][] {
  return items.map(({ id, sheet, entry: e }, i) => {
    const s = sheets[sheet];
    return [
      String(i + 1),
      String(sheet + 1),
      s?.a ? labels.page('a', s.a) : '',
      s?.b ? labels.page('b', s.b) : '',
      labels.kind(e.kind),
      labels.type(e.type),
      clip(e.old),
      clip(e.new),
      num(valuePercent(e.old, e.new)),
      checked.has(id) ? labels.yes : '',
    ];
  });
}

/** A change of a text comparison as the list shows it. */
export interface TextItem {
  /** Its key (`changeKey`): ticks are kept by it. */
  key: string;
  change: TextChange;
}

/** The compared pages of a side → the document's pages (the page range). */
export interface TextPages {
  a: (sidePage: number) => number | undefined;
  b: (sidePage: number) => number | undefined;
}

/** The register of a text comparison: one row per change, numbered from 1 (TEXT_COLUMNS). */
export function textRegister(
  items: readonly TextItem[],
  pages: TextPages,
  checked: ReadonlySet<string>,
  labels: RegisterLabels,
): string[][] {
  const pageOf = (side: 'a' | 'b', span: TextChange['a']): string => {
    if (!span) return '';
    const page = pages[side](span.page);
    return page === undefined ? '' : labels.page(side, { file: 0, page });
  };
  return items.map(({ key, change: c }, i) => {
    const oldText = c.a?.text ?? '';
    const newText = c.b?.text ?? '';
    const pct = c.pct ?? (c.a && c.b ? valuePercent(oldText, newText) : null);
    return [
      String(i + 1),
      pageOf('a', c.a),
      pageOf('b', c.b),
      labels.kind(c.kind),
      clip(oldText),
      clip(newText),
      num(pct),
      labels.notes(c).join('; '),
      checked.has(key) ? labels.yes : '',
    ];
  });
}

/** A register's columns and the ones a spreadsheet takes as numbers (their indexes). */
export function registerCells(type: 'overlay' | 'text'): {
  columns: readonly RegisterColumn[];
  numberColumns: number[];
} {
  const columns = type === 'overlay' ? OVERLAY_COLUMNS : TEXT_COLUMNS;
  const numberColumns = columns.flatMap((c, i) => (NUMBER_COLUMNS.includes(c) ? [i] : []));
  return { columns, numberColumns };
}
