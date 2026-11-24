// CRS project templates (M13-07, D-71, plan M13 §6, the owner's answers
// C1 – C15): what a template holds, its defaults, the checks a set-up must
// pass, and the validation of a stored record (IndexedDB, the template file).
// Pure. The workbook's bytes travel with the settings but are only ever read
// in the Work worker; a template never leaves the device except in a template
// file the person exports, and never appears in an error report (rule 10).
import { cellOf, colLetters, MAX_COL, MAX_ROW } from './a1';

/** The fields a row can carry (C4, C6, C9, plan §6 "Columns"), in the set-up's order. */
export const CRS_FIELDS = [
  'srNo',
  'commentNo',
  'page',
  'pageLabel',
  'type',
  'text',
  'author',
  'discipline',
  'created',
  'modified',
  'status',
  'allReplies',
  'firstReply',
  'lastReply',
  'lastReplyAuthor',
  'snapshot',
  'commentId',
  'fixed',
] as const;
export type CrsField = (typeof CRS_FIELDS)[number];

/** Cells filled once per sheet (plan §6 "Detail cells"), in the set-up's order. */
export const DETAIL_FIELDS = [
  'docName',
  'docNumber',
  'revision',
  'title',
  'reviewer',
  'reviewDate',
  'scheme',
  'commentCount',
  'pageCount',
] as const;
export type DetailField = (typeof DETAIL_FIELDS)[number];

/** The app's review statuses a template maps to its own words (C7). */
export const STATUS_WORDS = ['accepted', 'rejected', 'cancelled', 'completed', 'none'] as const;
export type StatusWord = (typeof STATUS_WORDS)[number];

/**
 * Comment types for the ticks (C8): the Comments pane's type names
 * (`annotate.type.<id>`), measurements by kind.
 */
export const CRS_TYPES = [
  'note',
  'freeText',
  'callout',
  'typewriter',
  'line',
  'arrow',
  'rectangle',
  'oval',
  'polygon',
  'cloud',
  'polyline',
  'ink',
  'highlight',
  'underline',
  'squiggly',
  'strikeout',
  'caret',
  'stamp',
  'fileAttachment',
  'distance',
  'perimeter',
  'area',
  'other',
] as const;
export type CrsType = (typeof CRS_TYPES)[number];

export type WorkbookKind = 'xlsx' | 'xltx';

export interface CrsColumn {
  field: CrsField;
  /** 1-based column, or null while not placed. */
  col: number | null;
  /** The tick: written when on. */
  on: boolean;
  /** Fixed text only: what every row gets. */
  text?: string;
}

/** Everything but the workbook: what the set-up edits and the template file carries. */
export interface CrsTemplateSettings {
  /** The one sheet the export fills (C1). */
  sheet: string;
  /** The first comment row (required). */
  startRow: number;
  /** "Last pre-drawn row" (C3): null = detected from the start row's borders. */
  lastPreDrawn: number | null;
  /** Detail cells by field: A1 addresses on `sheet` (all optional). */
  details: Partial<Record<DetailField, string>>;
  /** C10: e.g. "{docNo}_Rev{rev}"; empty = none. */
  fileNameRule: string;
  /** One entry per field (Fixed text may repeat). */
  columns: CrsColumn[];
  /** C8: which comment types go in. */
  types: Record<CrsType, boolean>;
  /** C12: leave out every comment under 70 % opacity. */
  ignoreHighlights: boolean;
  /** C7: the template's word or code for each app status. */
  status: Record<StatusWord, string>;
  /** C9: the snapshot's height limit in pixels. */
  snapshotMaxPx: number;
  /** C5: a copy of the sheet per commented page. */
  sheetPerPage: boolean;
}

export interface CrsTemplate extends CrsTemplateSettings {
  id: string;
  name: string;
  /** The imported workbook's file name (shown in the manager). */
  fileName: string;
  kind: WorkbookKind;
  /** The workbook as imported. */
  workbook: ArrayBuffer;
  /** Epoch ms. */
  created: number;
  modified: number;
}

/** C12 (the owner's words): a comment under 70 % opacity is a highlight. */
export const HIGHLIGHT_OPACITY = 0.7;

/** C9: Excel's 409-point row limit leaves about 540 px for a picture. */
export const SNAPSHOT_MIN_PX = 32;
export const SNAPSHOT_MAX_PX = 540;
export const SNAPSHOT_DEFAULT_PX = 240;

/** Template names are kept short enough for a menu. */
export const MAX_NAME = 80;

/** A field list with every field present, nothing ticked or placed. */
export function emptyColumns(): CrsColumn[] {
  return CRS_FIELDS.map((field) =>
    field === 'fixed' ? { field, col: null, on: false, text: '' } : { field, col: null, on: false },
  );
}

const allTypes = (): Record<CrsType, boolean> =>
  Object.fromEntries(CRS_TYPES.map((k) => [k, true])) as Record<CrsType, boolean>;

/**
 * The settings a freshly imported template starts with: its first sheet's
 * choice is the caller's, every comment type ticked, Ignore highlights on,
 * the app's own status words (C7: "starts with the app's words").
 */
export function defaultSettings(
  sheet: string,
  startRow: number,
  appStatus: Record<StatusWord, string>,
): CrsTemplateSettings {
  return {
    sheet,
    startRow,
    lastPreDrawn: null,
    details: {},
    fileNameRule: '',
    columns: emptyColumns(),
    types: allTypes(),
    ignoreHighlights: true,
    status: { ...appStatus },
    snapshotMaxPx: SNAPSHOT_DEFAULT_PX,
    sheetPerPage: false,
  };
}

/** "3 (C)": a column as the set-up shows it. */
export const columnLabel = (col: number): string => `${String(col)} (${colLetters(col)})`;

// ---------------------------------------------------------------------------
// Checks before a template is saved or used (the set-up shows each one).

export type TemplateIssue =
  | { code: 'no-sheet' }
  | { code: 'bad-start-row' }
  | { code: 'bad-last-row' }
  | { code: 'no-fields' }
  | { code: 'no-column'; field: CrsField; index: number }
  | { code: 'same-column'; col: number; fields: CrsField[] }
  | { code: 'bad-cell'; detail: DetailField }
  | { code: 'cell-in-table'; detail: DetailField }
  | { code: 'bad-rule' };

const RULE_FIELDS = new Set(['docNo', 'rev', 'title', '*']);

/** The placeholders of a file-name rule, or null when it is not one (C10). */
export function ruleParts(rule: string): (string | { field: string })[] | null {
  const parts: (string | { field: string })[] = [];
  const seen = new Set<string>();
  let i = 0;
  while (i < rule.length) {
    const open = rule.indexOf('{', i);
    const close = rule.indexOf('}', i);
    if (close !== -1 && (open === -1 || close < open)) return null; // a stray "}"
    if (open === -1) {
      parts.push(rule.slice(i));
      break;
    }
    if (open > i) parts.push(rule.slice(i, open));
    const end = rule.indexOf('}', open);
    if (end === -1) return null;
    const field = rule.slice(open + 1, end);
    if (!RULE_FIELDS.has(field)) return null;
    if (field !== '*' && seen.has(field)) return null;
    // Two placeholders side by side cannot be told apart.
    if (typeof parts[parts.length - 1] === 'object') return null;
    seen.add(field);
    parts.push({ field });
    i = end + 1;
  }
  return seen.has('docNo') || seen.has('rev') || seen.has('title') ? parts : null;
}

/**
 * What stops the settings from filling a sheet. `rows` is the table's first
 * and last row as the export will see it (start row and the last pre-drawn
 * row), so detail cells inside it are flagged.
 */
export function checkSettings(
  s: CrsTemplateSettings,
  sheets: readonly string[] | null = null,
  lastPreDrawn: number | null = s.lastPreDrawn,
): TemplateIssue[] {
  const out: TemplateIssue[] = [];
  if (!s.sheet || (sheets && !sheets.includes(s.sheet))) out.push({ code: 'no-sheet' });
  const startOk = Number.isInteger(s.startRow) && s.startRow >= 1 && s.startRow <= MAX_ROW;
  if (!startOk) out.push({ code: 'bad-start-row' });
  if (
    s.lastPreDrawn !== null &&
    (!Number.isInteger(s.lastPreDrawn) || s.lastPreDrawn < s.startRow || s.lastPreDrawn > MAX_ROW)
  )
    out.push({ code: 'bad-last-row' });
  const on = s.columns.filter((c) => c.on);
  if (on.length === 0) out.push({ code: 'no-fields' });
  const byCol = new Map<number, CrsField[]>();
  s.columns.forEach((c, index) => {
    if (!c.on) return;
    if (c.col === null) {
      out.push({ code: 'no-column', field: c.field, index });
      return;
    }
    byCol.set(c.col, [...(byCol.get(c.col) ?? []), c.field]);
  });
  for (const [col, fields] of [...byCol].sort((a, b) => a[0] - b[0])) {
    if (fields.length > 1) out.push({ code: 'same-column', col, fields });
  }
  const last = lastPreDrawn ?? s.startRow;
  for (const detail of DETAIL_FIELDS) {
    const addr = s.details[detail];
    if (addr === undefined || addr === '') continue;
    const cell = cellOf(addr);
    if (!cell) out.push({ code: 'bad-cell', detail });
    else if (startOk && cell.row >= s.startRow && cell.row <= last)
      out.push({ code: 'cell-in-table', detail });
  }
  if (s.fileNameRule.trim() && !ruleParts(s.fileNameRule.trim())) out.push({ code: 'bad-rule' });
  return out;
}

// ---------------------------------------------------------------------------
// Validation of stored data (IndexedDB, a template file): anything unexpected
// is dropped or replaced by its default, so a damaged record never breaks the
// export; a record without its essentials is refused (null).

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A stored record's keys, each still to be checked. */
type Raw<K extends string> = Partial<Record<K, unknown>>;
type RawTemplate = Raw<
  | keyof CrsTemplateSettings
  | 'id'
  | 'name'
  | 'fileName'
  | 'kind'
  | 'workbook'
  | 'created'
  | 'modified'
>;
const str = (v: unknown, max = 1000): string | null =>
  typeof v === 'string' && v.length <= max ? v : null;
const int = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null;

function columnsOf(v: unknown): CrsColumn[] {
  const fields = new Set<string>(CRS_FIELDS);
  const seen = new Set<CrsField>();
  const out: CrsColumn[] = [];
  if (Array.isArray(v)) {
    for (const item of v.slice(0, 200)) {
      if (!isObj(item)) continue;
      const c = item as Raw<keyof CrsColumn>;
      if (typeof c.field !== 'string' || !fields.has(c.field)) continue;
      const field = c.field as CrsField;
      if (field !== 'fixed' && seen.has(field)) continue;
      seen.add(field);
      const col = c.col === null ? null : int(c.col, 1, MAX_COL);
      const entry: CrsColumn = { field, col, on: c.on === true && col !== null };
      if (field === 'fixed') entry.text = str(c.text) ?? '';
      out.push(entry);
    }
  }
  // Every field is listed, so the set-up can tick any of them.
  for (const field of CRS_FIELDS) {
    if (!seen.has(field))
      out.push(
        field === 'fixed'
          ? { field, col: null, on: false, text: '' }
          : { field, col: null, on: false },
      );
  }
  return out;
}

function detailsOf(v: unknown): Partial<Record<DetailField, string>> {
  const out: Partial<Record<DetailField, string>> = {};
  if (!isObj(v)) return out;
  for (const k of DETAIL_FIELDS) {
    const a = str(v[k], 20);
    if (a && cellOf(a)) out[k] = a.trim().toUpperCase().replace(/\$/gu, '');
  }
  return out;
}

/** The settings in `v`, or null when the sheet or start row is missing. */
export function settingsOf(
  raw: unknown,
  appStatus: Record<StatusWord, string>,
): CrsTemplateSettings | null {
  if (!isObj(raw)) return null;
  const v = raw as RawTemplate;
  const sheet = str(v.sheet, 31);
  const startRow = int(v.startRow, 1, MAX_ROW);
  if (!sheet || startRow === null) return null;
  const last =
    v.lastPreDrawn === null || v.lastPreDrawn === undefined
      ? null
      : int(v.lastPreDrawn, startRow, MAX_ROW);
  const types = allTypes();
  const rawTypes = v.types;
  if (isObj(rawTypes)) for (const k of CRS_TYPES) if (rawTypes[k] === false) types[k] = false;
  const status = { ...appStatus };
  const rawStatus = v.status;
  if (isObj(rawStatus)) {
    for (const k of STATUS_WORDS) {
      const w = str(rawStatus[k], 200);
      if (w !== null) status[k] = w;
    }
  }
  const px = int(v.snapshotMaxPx, SNAPSHOT_MIN_PX, SNAPSHOT_MAX_PX);
  const rule = str(v.fileNameRule, 200) ?? '';
  return {
    sheet,
    startRow,
    lastPreDrawn: last,
    details: detailsOf(v.details),
    fileNameRule: ruleParts(rule.trim()) ? rule.trim() : '',
    columns: columnsOf(v.columns),
    types,
    ignoreHighlights: v.ignoreHighlights !== false,
    status,
    snapshotMaxPx: px ?? SNAPSHOT_DEFAULT_PX,
    sheetPerPage: v.sheetPerPage === true,
  };
}

/** Only the settings (for the template file and for copies). */
export function settingsPart(t: CrsTemplateSettings): CrsTemplateSettings {
  return {
    sheet: t.sheet,
    startRow: t.startRow,
    lastPreDrawn: t.lastPreDrawn,
    details: { ...t.details },
    fileNameRule: t.fileNameRule,
    columns: t.columns.map((c) => ({ ...c })),
    types: { ...t.types },
    ignoreHighlights: t.ignoreHighlights,
    status: { ...t.status },
    snapshotMaxPx: t.snapshotMaxPx,
    sheetPerPage: t.sheetPerPage,
  };
}

/** A stored template (IndexedDB), or null when it cannot be used. */
export function templateOf(
  raw: unknown,
  appStatus: Record<StatusWord, string>,
): CrsTemplate | null {
  if (!isObj(raw)) return null;
  const v = raw as RawTemplate;
  const id = str(v.id, 200);
  const name = str(v.name, MAX_NAME);
  const settings = settingsOf(raw, appStatus);
  if (!id || !name?.trim() || !settings || !(v.workbook instanceof ArrayBuffer)) return null;
  const kind: WorkbookKind = v.kind === 'xltx' ? 'xltx' : 'xlsx';
  const now = Date.now();
  return {
    ...settings,
    id,
    name: name.trim(),
    fileName: str(v.fileName, 260) ?? '',
    kind,
    workbook: v.workbook,
    created: int(v.created, 0, Number.MAX_SAFE_INTEGER) ?? now,
    modified: int(v.modified, 0, Number.MAX_SAFE_INTEGER) ?? now,
  };
}

/** Stored templates, valid ones only, by name. */
export function templatesOf(
  list: readonly unknown[],
  appStatus: Record<StatusWord, string>,
): CrsTemplate[] {
  return list
    .map((v) => templateOf(v, appStatus))
    .filter((t): t is CrsTemplate => t !== null)
    .sort((a, b) => a.name.localeCompare(b.name) || a.created - b.created);
}

/** A name not yet used ("Project CRS", "Project CRS (2)", …; compared without case). */
export function uniqueName(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  const root = base.trim().slice(0, MAX_NAME) || 'CRS';
  if (!used.has(root.toLowerCase())) return root;
  for (let i = 2; ; i++) {
    const tail = ` (${String(i)})`;
    const name = root.slice(0, MAX_NAME - tail.length) + tail;
    if (!used.has(name.toLowerCase())) return name;
  }
}
