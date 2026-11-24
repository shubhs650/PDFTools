// M13-07 (D-71, plan M13 §6, ADR-034 Amendment 1): the CRS template model —
// A1 reference rules, typed cells and columns, sheet names, the set-up's
// checks, validation of stored records, the file-name rule (C10) and the
// template file (C14).
import { describe, expect, it } from 'vitest';
import {
  cellOf,
  columnOf,
  renameSheetRefs,
  shiftRows,
  shiftSqref,
  slideRows,
} from '../../src/model/crs/a1';
import { readFileName } from '../../src/model/crs/fileNameRule';
import { sheetName } from '../../src/model/crs/sheetName';
import {
  checkSettings,
  columnLabel,
  CRS_FIELDS,
  CRS_TYPES,
  defaultSettings,
  ruleParts,
  settingsOf,
  templateOf,
  templatesOf,
  uniqueName,
  type CrsTemplateSettings,
  type StatusWord,
} from '../../src/model/crs/template';
import {
  readTemplateFile,
  TEMPLATE_FORMAT,
  writeTemplateFile,
} from '../../src/model/crs/templateFile';

const APP: Record<StatusWord, string> = {
  accepted: 'Accepted',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  completed: 'Completed',
  none: '',
};

const at = (after: number, n: number, sheet = 'CRS', home: string | null = 'CRS') => ({
  sheet,
  home,
  after,
  n,
});

describe('A1 references (Amendment 1 item 3)', () => {
  it('moves rows below the table and grows ranges that reach its last row', () => {
    const s = at(24, 25);
    expect(shiftRows('COUNTA(E10:E24)', s)).toBe('COUNTA(E10:E49)');
    expect(shiftRows('SUM($E$10:$E$24)+A30', s)).toBe('SUM($E$10:$E$49)+A55');
    expect(shiftRows('A1+K4', s)).toBe('A1+K4');
    expect(shiftRows('A26:K26', s)).toBe('A51:K51');
    expect(shiftRows('$9:$9', s)).toBe('$9:$9');
    expect(shiftRows('A1:K30', s)).toBe('A1:K55');
    expect(shiftRows('E24', s)).toBe('E24');
    expect(shiftSqref('A10:K24 M30', s)).toBe('A10:K49 M55');
  });

  it('leaves text, function names, structured references and other sheets alone', () => {
    const s = at(24, 5);
    expect(shiftRows('IF(A30="A30","x",LOG10(A30))', s)).toBe('IF(A35="A30","x",LOG10(A35))');
    expect(shiftRows('Lists!A30+CRS!A30', s)).toBe('Lists!A30+CRS!A35');
    expect(shiftRows("'My CRS'!A30", at(24, 5, 'My CRS', 'Notes'))).toBe("'My CRS'!A35");
    expect(shiftRows('A30', at(24, 5, 'CRS', 'Notes'))).toBe('A30');
    expect(shiftRows('Table1[Col 30]', s)).toBe('Table1[Col 30]');
  });

  it('slides relative rows like a fill down', () => {
    expect(slideRows('IF(H10="","",TODAY()-H10)', 15)).toBe('IF(H25="","",TODAY()-H25)');
    expect(slideRows('$A$1+A$1+$A1+SUM(B10:B11)', 2)).toBe('$A$1+A$1+$A3+SUM(B12:B13)');
  });

  it('renames sheet references, quoting when needed', () => {
    expect(renameSheetRefs("CRS!K4+'CRS'!K5+Lists!A1", 'CRS', 'A-101')).toBe(
      "'A-101'!K4+'A-101'!K5+Lists!A1",
    );
    expect(renameSheetRefs('"CRS!K4"&CRS!K4', 'CRS', 'Page1')).toBe('"CRS!K4"&Page1!K4');
  });

  it('reads typed cells and columns (number or letter, C13)', () => {
    expect(cellOf(' b4 ')).toEqual({ col: 2, row: 4 });
    expect(cellOf('$C$12')).toEqual({ col: 3, row: 12 });
    expect(cellOf('XFE1')).toBeNull();
    expect(cellOf('A0')).toBeNull();
    expect(cellOf('4B')).toBeNull();
    expect(columnOf('3')).toBe(3);
    expect(columnOf('c')).toBe(3);
    expect(columnOf('AA')).toBe(27);
    expect(columnOf('0')).toBeNull();
    expect(columnOf('16385')).toBeNull();
    expect(columnOf('C3')).toBeNull();
    expect(columnLabel(3)).toBe('3 (C)');
    expect(columnLabel(28)).toBe('28 (AB)');
  });
});

describe('sheet names (C5, C15; Amendment 1 item 4)', () => {
  it("keeps to Excel's rules", () => {
    const taken = new Set(['lists']);
    expect(sheetName('B:102/Sec*?', taken)).toBe('B-102-Sec--');
    expect(sheetName("'quoted'", taken)).toBe('quoted');
    expect(sheetName('x'.repeat(40), taken)).toHaveLength(31);
    expect(sheetName('History', taken)).toBe('History 1');
    expect(sheetName('LISTS', taken)).toBe('LISTS (2)');
    expect(sheetName('', taken)).toBe('Sheet');
    expect(sheetName('  ', taken, 'Page')).toBe('Page');
    expect(sheetName(`${'a'.repeat(30)}😀`, taken)).toBe('a'.repeat(30));
    expect(sheetName('y'.repeat(31), new Set(['y'.repeat(31)]))).toBe(`${'y'.repeat(27)} (2)`);
    expect(sheetName('tab\tname', taken)).toBe('tabname');
  });
});

const settings = (over: Partial<CrsTemplateSettings> = {}): CrsTemplateSettings => {
  const s = defaultSettings('CRS', 10, APP);
  const cols = s.columns.map((c) =>
    c.field === 'srNo'
      ? { ...c, on: true, col: 1 }
      : c.field === 'text'
        ? { ...c, on: true, col: 5 }
        : c,
  );
  return { ...s, columns: cols, ...over };
};

describe('template settings', () => {
  it('starts with every field listed, every type ticked, Ignore highlights on, app status words', () => {
    const s = defaultSettings('CRS', 10, APP);
    expect(s.columns.map((c) => c.field)).toEqual([...CRS_FIELDS]);
    expect(s.columns.every((c) => !c.on && c.col === null)).toBe(true);
    expect(CRS_TYPES.every((k) => s.types[k])).toBe(true);
    expect(s.ignoreHighlights).toBe(true);
    expect(s.status).toEqual(APP);
    expect(s.sheetPerPage).toBe(false);
    expect(s.lastPreDrawn).toBeNull();
  });

  it('flags what stops an export', () => {
    expect(checkSettings(settings(), ['CRS', 'Lists'])).toEqual([]);
    expect(checkSettings(settings({ sheet: 'Gone' }), ['CRS'])).toEqual([{ code: 'no-sheet' }]);
    expect(checkSettings(settings({ startRow: 0 }))).toContainEqual({ code: 'bad-start-row' });
    expect(checkSettings(settings({ lastPreDrawn: 5 }))).toEqual([{ code: 'bad-last-row' }]);
    const none = settings();
    none.columns = none.columns.map((c) => ({ ...c, on: false }));
    expect(checkSettings(none)).toEqual([{ code: 'no-fields' }]);

    // Two fields on one column; a ticked field without a column.
    const clash = settings();
    clash.columns = clash.columns.map((c) =>
      c.field === 'author'
        ? { ...c, on: true, col: 5 }
        : c.field === 'page'
          ? { ...c, on: true }
          : c,
    );
    expect(checkSettings(clash)).toEqual([
      { code: 'no-column', field: 'page', index: CRS_FIELDS.indexOf('page') },
      { code: 'same-column', col: 5, fields: ['text', 'author'] },
    ]);

    // Detail cells: a bad address; one inside the comment rows.
    expect(checkSettings(settings({ details: { docNumber: 'C4', revision: 'Q' } }))).toEqual([
      { code: 'bad-cell', detail: 'revision' },
    ]);
    expect(checkSettings(settings({ details: { title: 'C12' } }), null, 24)).toEqual([
      { code: 'cell-in-table', detail: 'title' },
    ]);
    expect(checkSettings(settings({ details: { title: 'C25' } }), null, 24)).toEqual([]);
    expect(checkSettings(settings({ fileNameRule: '{docNo}{rev}' }))).toEqual([
      { code: 'bad-rule' },
    ]);
  });

  it('reads stored settings, dropping what is damaged', () => {
    const s = settingsOf(
      {
        sheet: 'CRS',
        startRow: 10,
        lastPreDrawn: 3, // above the start row: detected instead
        details: { docNumber: '$c$4', title: 'nope', reviewer: 7 },
        fileNameRule: '{docNo}_Rev{rev}',
        columns: [
          { field: 'text', col: 5, on: true },
          { field: 'text', col: 6, on: true }, // a second entry for one field
          { field: 'fixed', col: 8, on: true, text: 'Open' },
          { field: 'fixed', col: 9, on: true, text: 'Rev A' },
          { field: 'page', col: null, on: true }, // ticked without a column: off
          { field: 'bogus', col: 2, on: true },
        ],
        types: { highlight: false, note: 'no' },
        ignoreHighlights: false,
        status: { accepted: 'A', rejected: 5 },
        snapshotMaxPx: 9000,
        sheetPerPage: true,
      },
      APP,
    );
    expect(s).not.toBeNull();
    if (!s) return;
    expect(s.lastPreDrawn).toBeNull();
    expect(s.details).toEqual({ docNumber: 'C4' });
    expect(s.fileNameRule).toBe('{docNo}_Rev{rev}');
    expect(s.columns.filter((c) => c.on)).toEqual([
      { field: 'text', col: 5, on: true },
      { field: 'fixed', col: 8, on: true, text: 'Open' },
      { field: 'fixed', col: 9, on: true, text: 'Rev A' },
    ]);
    // Every field still listed for the set-up.
    expect(new Set(s.columns.map((c) => c.field))).toEqual(new Set(CRS_FIELDS));
    expect(s.types.highlight).toBe(false);
    expect(s.types.note).toBe(true);
    expect(s.ignoreHighlights).toBe(false);
    expect(s.status).toEqual({ ...APP, accepted: 'A' });
    expect(s.snapshotMaxPx).toBe(240);
    expect(s.sheetPerPage).toBe(true);
    expect(settingsOf({ sheet: '', startRow: 10 }, APP)).toBeNull();
    expect(settingsOf({ sheet: 'CRS', startRow: 0 }, APP)).toBeNull();
  });

  it('reads stored templates; refuses those without a workbook, id or name', () => {
    const workbook = new ArrayBuffer(4);
    const base = { ...settings(), id: 't1', name: ' Project ', fileName: 'p.xlsx', workbook };
    const ok = templateOf({ ...base, kind: 'xltx', created: 5, modified: 6 }, APP);
    expect(ok).toMatchObject({ id: 't1', name: 'Project', kind: 'xltx', created: 5, modified: 6 });
    expect(templateOf({ ...base, workbook: 'x' }, APP)).toBeNull();
    expect(templateOf({ ...base, id: undefined }, APP)).toBeNull();
    expect(templateOf({ ...base, name: '  ' }, APP)).toBeNull();
    expect(
      templatesOf(
        [{ ...base, id: 'b', name: 'Beta' }, null, { ...base, id: 'a', name: 'alpha' }],
        APP,
      ).map((x) => x.id),
    ).toEqual(['a', 'b']);
  });

  it('makes names unique without regard to case', () => {
    expect(uniqueName('Project CRS', [])).toBe('Project CRS');
    expect(uniqueName('Project CRS', ['project crs'])).toBe('Project CRS (2)');
    expect(uniqueName('Project CRS', ['Project CRS', 'Project CRS (2)'])).toBe('Project CRS (3)');
    expect(uniqueName('  ', [])).toBe('CRS');
  });
});

describe('file-name rule (C10)', () => {
  it('reads number, revision and title from the file name', () => {
    expect(readFileName('{docNo}_Rev{rev}', 'PA-1200-ME-DWG-0042_RevB.pdf')).toEqual({
      docNo: 'PA-1200-ME-DWG-0042',
      rev: 'B',
    });
    expect(readFileName('{docNo}_rev{rev}', 'X-1_REV02.PDF')).toEqual({ docNo: 'X-1', rev: '02' });
    expect(readFileName('{docNo} {rev} {title}', 'A-101 C Pump skid GA.pdf')).toEqual({
      docNo: 'A-101',
      rev: 'C',
      title: 'Pump skid GA',
    });
    expect(readFileName('{*}_{docNo}_R{rev}', 'Vendor_A-7_R3.pdf')).toEqual({
      docNo: 'A-7',
      rev: '3',
    });
    expect(readFileName('{docNo}(rev.{rev})', 'D-9(rev.1).pdf')).toEqual({
      docNo: 'D-9',
      rev: '1',
    });
    expect(readFileName('{docNo}_Rev{rev}', 'no-match.pdf')).toBeNull();
    expect(readFileName('{bogus}', 'x.pdf')).toBeNull();
  });

  it('accepts only rules it can read', () => {
    expect(ruleParts('{docNo}_Rev{rev}')).toEqual([{ field: 'docNo' }, '_Rev', { field: 'rev' }]);
    expect(ruleParts('{docNo}{rev}')).toBeNull(); // side by side
    expect(ruleParts('{docNo}_{docNo}')).toBeNull();
    expect(ruleParts('{*}')).toBeNull(); // nothing to read
    expect(ruleParts('{docNo')).toBeNull();
    expect(ruleParts('docNo}')).toBeNull();
    expect(ruleParts('Rev')).toBeNull();
  });
});

describe('template file (C14)', () => {
  const workbook = Uint8Array.from([0x50, 0x4b, 3, 4, 9, 8, 7]).buffer;
  const tpl = {
    ...settings(),
    name: 'Project CRS',
    fileName: 'crs.xlsx',
    kind: 'xltx' as const,
    workbook,
  };

  it('round-trips the workbook and the settings', () => {
    const text = writeTemplateFile(tpl);
    expect(JSON.parse(text)).toMatchObject({ format: TEMPLATE_FORMAT, version: 1 });
    const read = readTemplateFile(text, APP);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const { workbook: wb, ...rest } = read.template;
    expect([...new Uint8Array(wb)]).toEqual([0x50, 0x4b, 3, 4, 9, 8, 7]);
    expect({ ...rest, workbook: tpl.workbook }).toEqual(tpl);
  });

  it('refuses other files, newer versions and damaged ones plainly', () => {
    const v = JSON.parse(writeTemplateFile(tpl)) as Record<string, unknown>;
    expect(readTemplateFile('not json', APP)).toEqual({ ok: false, reason: 'not-template' });
    expect(readTemplateFile('[]', APP)).toEqual({ ok: false, reason: 'not-template' });
    expect(readTemplateFile(JSON.stringify({ ...v, format: 'other' }), APP)).toEqual({
      ok: false,
      reason: 'not-template',
    });
    expect(readTemplateFile(JSON.stringify({ ...v, version: 2 }), APP)).toEqual({
      ok: false,
      reason: 'newer',
    });
    expect(readTemplateFile(JSON.stringify({ ...v, workbook: '%%%' }), APP)).toEqual({
      ok: false,
      reason: 'damaged',
    });
    expect(readTemplateFile(JSON.stringify({ ...v, settings: {} }), APP)).toEqual({
      ok: false,
      reason: 'damaged',
    });
    // Unknown keys are ignored.
    expect(readTemplateFile(JSON.stringify({ ...v, extra: 1 }), APP).ok).toBe(true);
  });
});
