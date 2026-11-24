// The four guided steps of a CRS template's set-up (M13-08, D-71, plan M13 §6
// "Setting up", C13): what each step checks, what a click on the sheet
// preview places (the field being set), which field is set next, and the
// first suggestions applied to a fresh import. Pure.
import { cellName } from './a1';
import { guessColumns, guessDetails, guessHeaderRow, guessStartRow, type GuessCell } from './guess';
import {
  checkSettings,
  DETAIL_FIELDS,
  type CrsField,
  type CrsTemplateSettings,
  type DetailField,
  type TemplateIssue,
} from './template';

export const SETUP_STEPS = ['sheet', 'details', 'columns', 'comments'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

/** What a click on the preview sets. */
export type PlaceTarget =
  | { kind: 'start' }
  | { kind: 'last' }
  | { kind: 'detail'; field: DetailField }
  | { kind: 'column'; index: number };

/** The issues each step shows (and must clear before Save). */
const STEP_OF: Record<TemplateIssue['code'], SetupStep> = {
  'no-sheet': 'sheet',
  'bad-start-row': 'sheet',
  'bad-last-row': 'sheet',
  'bad-cell': 'details',
  'cell-in-table': 'details',
  'bad-rule': 'details',
  'no-fields': 'columns',
  'no-column': 'columns',
  'same-column': 'columns',
};

export function stepIssues(
  s: CrsTemplateSettings,
  step: SetupStep,
  sheets: readonly string[] | null,
  lastPreDrawn: number | null,
): TemplateIssue[] {
  return checkSettings(s, sheets, lastPreDrawn).filter((i) => STEP_OF[i.code] === step);
}

/** The first step with an issue, or null when the set-up can be saved. */
export function firstStepWithIssue(
  s: CrsTemplateSettings,
  sheets: readonly string[] | null,
  lastPreDrawn: number | null,
): SetupStep | null {
  const issues = checkSettings(s, sheets, lastPreDrawn);
  for (const step of SETUP_STEPS) if (issues.some((i) => STEP_OF[i.code] === step)) return step;
  return null;
}

/** The target a step starts with: the first thing not yet placed. */
export function firstTarget(s: CrsTemplateSettings, step: SetupStep): PlaceTarget | null {
  switch (step) {
    case 'sheet':
      return { kind: 'start' };
    case 'details': {
      const field = DETAIL_FIELDS.find((f) => !s.details[f]) ?? DETAIL_FIELDS[0];
      return { kind: 'detail', field };
    }
    case 'columns': {
      const i = s.columns.findIndex((c) => c.col === null);
      return { kind: 'column', index: Math.max(0, i) };
    }
    case 'comments':
      return null;
  }
}

/**
 * A click on the preview at (row, col) — a merge's first cell — for `target`:
 * the new settings and the target to set next (the next one not placed).
 */
export function place(
  s: CrsTemplateSettings,
  target: PlaceTarget,
  row: number,
  col: number,
): { settings: CrsTemplateSettings; next: PlaceTarget } {
  switch (target.kind) {
    case 'start': {
      const last = s.lastPreDrawn !== null && s.lastPreDrawn < row ? null : s.lastPreDrawn;
      return { settings: { ...s, startRow: row, lastPreDrawn: last }, next: target };
    }
    case 'last':
      return {
        settings: { ...s, lastPreDrawn: Math.max(row, s.startRow || row) },
        next: target,
      };
    case 'detail': {
      const details = { ...s.details, [target.field]: cellName(col, row) };
      const i = DETAIL_FIELDS.indexOf(target.field);
      const after = [...DETAIL_FIELDS.slice(i + 1), ...DETAIL_FIELDS.slice(0, i)];
      const field = after.find((f) => !details[f]);
      return {
        settings: { ...s, details },
        next: field ? { kind: 'detail', field } : target,
      };
    }
    case 'column': {
      const columns = s.columns.map((c, i) => (i === target.index ? { ...c, col, on: true } : c));
      const n = columns.length;
      let next = target.index;
      for (let k = 1; k < n; k++) {
        const j = (target.index + k) % n;
        if (columns[j]?.col === null) {
          next = j;
          break;
        }
      }
      return { settings: { ...s, columns }, next: { kind: 'column', index: next } };
    }
  }
}

/** Takes a column off a field (its tick goes too). */
export function unplaceColumn(s: CrsTemplateSettings, index: number): CrsTemplateSettings {
  return {
    ...s,
    columns: s.columns.map((c, i) => (i === index ? { ...c, col: null, on: false } : c)),
  };
}

/** Every field's placed column, by column (the preview's marks). */
export function columnMarks(s: CrsTemplateSettings): Map<number, CrsField[]> {
  const out = new Map<number, CrsField[]>();
  for (const c of s.columns)
    if (c.on && c.col !== null) out.set(c.col, [...(out.get(c.col) ?? []), c.field]);
  return out;
}

/** Every placed detail cell, by "row:col" (the preview's marks). */
export function detailMarks(
  s: CrsTemplateSettings,
  parse: (addr: string) => { row: number; col: number } | null,
): Map<string, DetailField[]> {
  const out = new Map<string, DetailField[]>();
  for (const f of DETAIL_FIELDS) {
    const a = s.details[f];
    const p = a ? parse(a) : null;
    if (!p) continue;
    const key = `${String(p.row)}:${String(p.col)}`;
    out.set(key, [...(out.get(key) ?? []), f]);
  }
  return out;
}

export interface Suggested {
  start: boolean;
  details: boolean;
  columns: boolean;
}

/**
 * A fresh import's first suggestions, from the sheet preview's cells: the
 * start row under the header, the fields its header names, the detail cells
 * next to their labels. Only what is still empty is filled.
 */
export function applySuggestions(
  s: CrsTemplateSettings,
  cells: readonly GuessCell[],
): { settings: CrsTemplateSettings; suggested: Suggested } {
  const suggested: Suggested = { start: false, details: false, columns: false };
  let out = s;
  if (!out.startRow) {
    const start = guessStartRow(cells);
    if (start !== null) {
      out = { ...out, startRow: start };
      suggested.start = true;
    }
  }
  const head = guessHeaderRow(cells);
  if (head !== null && out.startRow > head && !out.columns.some((c) => c.col !== null)) {
    const found = guessColumns(cells, head);
    if (found.length) {
      const by = new Map(found.map((f) => [f.field, f.col]));
      out = {
        ...out,
        columns: out.columns.map((c) => {
          const col = by.get(c.field);
          return col === undefined ? c : { ...c, col, on: true };
        }),
      };
      suggested.columns = true;
    }
  }
  if (out.startRow && Object.keys(out.details).length === 0) {
    const details = guessDetails(cells, head ?? out.startRow);
    if (Object.keys(details).length) {
      out = { ...out, details };
      suggested.details = true;
    }
  }
  return { settings: out, suggested };
}
