// M13-08 (D-71, plan M13 §6 "Setting up", C13): the guided steps' rules —
// what a click on the preview places, which field is set next, each step's
// issues, and the first suggestions for a fresh import. TDD; pure.
import { describe, expect, it } from 'vitest';
import { cellOf } from '../../src/model/crs/a1';
import {
  applySuggestions,
  columnMarks,
  detailMarks,
  firstStepWithIssue,
  firstTarget,
  place,
  stepIssues,
  unplaceColumn,
} from '../../src/model/crs/setup';
import { defaultSettings, type CrsTemplateSettings } from '../../src/model/crs/template';

const words = { accepted: 'A', rejected: 'R', cancelled: 'C', completed: 'D', none: '' };
const fresh = (): CrsTemplateSettings => defaultSettings('CRS', 0, words);
const idx = (s: CrsTemplateSettings, f: string) => s.columns.findIndex((c) => c.field === f);

describe('placing by clicking the preview', () => {
  it('sets the start row, and drops a last pre-drawn row above it', () => {
    let s: CrsTemplateSettings = { ...fresh(), startRow: 10, lastPreDrawn: 12 };
    s = place(s, { kind: 'start' }, 14, 3).settings;
    expect(s.startRow).toBe(14);
    expect(s.lastPreDrawn).toBeNull();
    s = place(s, { kind: 'last' }, 30, 1).settings;
    expect(s.lastPreDrawn).toBe(30);
    // Above the start row: the start row itself.
    expect(place(s, { kind: 'last' }, 3, 1).settings.lastPreDrawn).toBe(14);
  });

  it('places a detail cell and moves on to the next one not placed', () => {
    const s = { ...fresh(), startRow: 10, details: { revision: 'G4' } };
    const one = place(s, { kind: 'detail', field: 'docNumber' }, 4, 3);
    expect(one.settings.details).toEqual({ revision: 'G4', docNumber: 'C4' });
    // Revision is placed already: Title is next.
    expect(one.next).toEqual({ kind: 'detail', field: 'title' });
  });

  it('places a field on a column, ticks it, and moves on to the next free field', () => {
    const s = fresh();
    const r = place(s, { kind: 'column', index: 0 }, 9, 1);
    expect(r.settings.columns[0]).toMatchObject({ field: 'srNo', col: 1, on: true });
    expect(r.next).toEqual({ kind: 'column', index: 1 });
    const off = unplaceColumn(r.settings, 0);
    expect(off.columns[0]).toMatchObject({ col: null, on: false });
    expect(columnMarks(r.settings).get(1)).toEqual(['srNo']);
  });

  it('starts each step on the first thing not yet placed', () => {
    const s = { ...fresh(), startRow: 10, details: { docName: 'C2' } };
    expect(firstTarget(s, 'sheet')).toEqual({ kind: 'start' });
    expect(firstTarget(s, 'details')).toEqual({ kind: 'detail', field: 'docNumber' });
    expect(firstTarget(s, 'columns')).toEqual({ kind: 'column', index: 0 });
    expect(firstTarget(s, 'comments')).toBeNull();
  });

  it('marks detail cells by row and column', () => {
    const s = { ...fresh(), details: { docNumber: 'C4', title: 'C4', revision: 'G4' } };
    const m = detailMarks(s, (a) => cellOf(a));
    expect(m.get('4:3')).toEqual(['docNumber', 'title']);
    expect(m.get('4:7')).toEqual(['revision']);
  });
});

describe('each step’s issues', () => {
  it('step 1 needs a sheet and a start row; step 3 a field on a column', () => {
    const s = fresh();
    expect(stepIssues(s, 'sheet', ['CRS'], null).map((i) => i.code)).toEqual(['bad-start-row']);
    expect(stepIssues(s, 'columns', ['CRS'], null).map((i) => i.code)).toEqual(['no-fields']);
    expect(stepIssues(s, 'sheet', ['Other'], null).map((i) => i.code)).toEqual([
      'no-sheet',
      'bad-start-row',
    ]);
    expect(firstStepWithIssue(s, ['CRS'], null)).toBe('sheet');
  });

  it('flags two fields on one column and a detail cell inside the table', () => {
    let s = { ...fresh(), startRow: 10 };
    s = place(s, { kind: 'column', index: idx(s, 'text') }, 9, 5).settings;
    s = place(s, { kind: 'column', index: idx(s, 'author') }, 9, 5).settings;
    expect(stepIssues(s, 'columns', ['CRS'], 24)).toEqual([
      { code: 'same-column', col: 5, fields: ['text', 'author'] },
    ]);
    s = { ...s, details: { docNumber: 'C12' } };
    expect(stepIssues(s, 'details', ['CRS'], 24)).toEqual([
      { code: 'cell-in-table', detail: 'docNumber' },
    ]);
    expect(firstStepWithIssue(s, ['CRS'], 24)).toBe('details');
    s = place(s, { kind: 'column', index: idx(s, 'author') }, 9, 7).settings;
    s = { ...s, details: { docNumber: 'C4' } };
    expect(firstStepWithIssue(s, ['CRS'], 24)).toBeNull();
  });
});

describe('first suggestions for a fresh import', () => {
  const cells = [
    { r: 4, c: 1, text: 'Document No.', bold: true as const, cs: 2 },
    { r: 4, c: 6, text: 'Revision', bold: true as const },
    { r: 9, c: 1, text: 'Sr. No.', bold: true as const },
    { r: 9, c: 2, text: 'Page', bold: true as const },
    { r: 9, c: 3, text: 'Comment', bold: true as const },
    { r: 9, c: 4, text: 'Status', bold: true as const },
  ];

  it('fills the start row, the columns and the detail cells', () => {
    const r = applySuggestions(fresh(), cells);
    expect(r.suggested).toEqual({ start: true, details: true, columns: true });
    expect(r.settings.startRow).toBe(10);
    expect(r.settings.details).toEqual({ docNumber: 'C4', revision: 'G4' });
    expect(columnMarks(r.settings)).toEqual(
      new Map([
        [1, ['srNo']],
        [2, ['page']],
        [3, ['text']],
        [4, ['status']],
      ]),
    );
  });

  it('keeps what is already set', () => {
    const s = { ...fresh(), startRow: 10, details: { title: 'B2' } };
    s.columns = s.columns.map((c) => (c.field === 'text' ? { ...c, col: 8, on: true } : c));
    const r = applySuggestions(s, cells);
    expect(r.suggested).toEqual({ start: false, details: false, columns: false });
    expect(r.settings).toEqual(s);
  });
});
