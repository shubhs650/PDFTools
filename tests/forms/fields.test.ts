// M2-14: tab order (/Tabs /R, /C, /S) and value normalization per field type.
import {
  PDF_FORM_FIELD_FLAG,
  PDF_FORM_FIELD_TYPE,
  PdfAnnotationSubtype,
  type PdfWidgetAnnoField,
  type PdfWidgetAnnoObject,
} from '@embedpdf/models';
import { describe, expect, it } from 'vitest';
import {
  fieldLabel,
  isReadOnly,
  isRequired,
  kindOf,
  normalizeText,
  resetCalls,
  selectedIndexes,
  tabOrder,
} from '../../src/features/forms/fields';

const box = (x: number, y: number, width = 100, height = 20) => ({
  rect: { origin: { x, y }, size: { width, height } },
});

function widget(field: Partial<PdfWidgetAnnoField> & { type: PDF_FORM_FIELD_TYPE }, extra = {}) {
  return {
    type: PdfAnnotationSubtype.WIDGET,
    id: 'w',
    pageIndex: 0,
    ...box(0, 0),
    field: { flag: 0, name: 'f', alternateName: '', value: '', ...field },
    ...extra,
  } as unknown as PdfWidgetAnnoObject;
}

describe('tabOrder', () => {
  // /Annots order: C (row 2 left), A (row 1 right), B (row 1 left), D (row 2 right)
  const widgets = [box(10, 50), box(200, 10), box(10, 12), box(200, 52)];

  it('keeps /Annots order without /Tabs, and for /S', () => {
    expect(tabOrder(widgets, null)).toEqual([0, 1, 2, 3]);
    expect(tabOrder(widgets, 'S')).toEqual([0, 1, 2, 3]);
  });

  it('/R reads rows top to bottom, left to right; near-equal tops share a row', () => {
    expect(tabOrder(widgets, 'R')).toEqual([2, 1, 0, 3]);
  });

  it('/C reads columns left to right, top to bottom', () => {
    expect(tabOrder(widgets, 'C')).toEqual([2, 0, 1, 3]);
  });

  it('matches the fixture: /Tabs /R with /Annots out of row order', () => {
    // fullFormPdf's widget rects (page space, y down) in /Annots order.
    const fixture = [
      box(60, 198, 240, 24), // required
      box(60, 78, 240, 24), // first
      box(60, 118, 240, 24), // name
      box(60, 158, 240, 24), // readonly
      box(60, 286, 16, 16), // choice A
      box(120, 286, 16, 16), // choice B
      box(60, 328, 240, 24), // size
      box(60, 246, 16, 16), // agree
      box(60, 372, 240, 70), // material
    ];
    expect(tabOrder(fixture, 'R')).toEqual([1, 2, 3, 0, 7, 4, 5, 6, 8]);
  });

  it('handles no widgets', () => {
    expect(tabOrder([], 'R')).toEqual([]);
  });
});

describe('fields', () => {
  it('names a field by its tooltip, else its name', () => {
    expect(
      fieldLabel(widget({ type: PDF_FORM_FIELD_TYPE.TEXTFIELD, name: 'a', alternateName: 'Tip' })),
    ).toBe('Tip');
    expect(fieldLabel(widget({ type: PDF_FORM_FIELD_TYPE.TEXTFIELD, name: 'a' }))).toBe('a');
  });

  it('reads the read-only and required flags', () => {
    const w = widget({ type: PDF_FORM_FIELD_TYPE.TEXTFIELD, flag: 3 as PDF_FORM_FIELD_FLAG });
    expect(isReadOnly(w)).toBe(true);
    expect(isRequired(w)).toBe(true);
    expect(
      isReadOnly(
        widget({ type: PDF_FORM_FIELD_TYPE.TEXTFIELD, flag: PDF_FORM_FIELD_FLAG.REQUIRED }),
      ),
    ).toBe(false);
  });

  it('fills only the five AcroForm types', () => {
    expect(kindOf(widget({ type: PDF_FORM_FIELD_TYPE.PUSHBUTTON }))).toBeNull();
    expect(kindOf(widget({ type: PDF_FORM_FIELD_TYPE.SIGNATURE }))).toBeNull();
    expect(kindOf(widget({ type: PDF_FORM_FIELD_TYPE.LISTBOX }))).toBe('list');
  });
});

describe('normalizeText', () => {
  it('turns line breaks into spaces in single-line fields', () => {
    const w = widget({ type: PDF_FORM_FIELD_TYPE.TEXTFIELD });
    expect(normalizeText(w, 'a\r\nb\nc')).toBe('a b c');
  });

  it('keeps line breaks (as \\n) in multiline fields', () => {
    const w = widget({ type: PDF_FORM_FIELD_TYPE.TEXTFIELD, flag: 1 << 12 });
    expect(normalizeText(w, 'a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('cuts to /MaxLen by characters, not UTF-16 units', () => {
    const w = widget({ type: PDF_FORM_FIELD_TYPE.TEXTFIELD, maxLen: 3 });
    expect(normalizeText(w, 'ab😀cd')).toBe('ab😀');
  });
});

describe('resetCalls', () => {
  it('text: to /DV, or empty', () => {
    const w = widget({ type: PDF_FORM_FIELD_TYPE.TEXTFIELD, value: 'x' });
    expect(resetCalls(w, 'Default')).toEqual([{ kind: 'text', text: 'Default' }]);
    expect(resetCalls(w, null)).toEqual([{ kind: 'text', text: '' }]);
    expect(resetCalls(widget({ type: PDF_FORM_FIELD_TYPE.TEXTFIELD, value: '' }), null)).toEqual(
      [],
    );
  });

  it('checkbox: on when /DV is its export value', () => {
    const off = widget(
      { type: PDF_FORM_FIELD_TYPE.CHECKBOX, value: 'Off' },
      { exportValue: 'Yes' },
    );
    expect(resetCalls(off, 'Yes')).toEqual([{ kind: 'checked', checked: true }]);
    expect(resetCalls(off, null)).toEqual([]);
    const on = widget({ type: PDF_FORM_FIELD_TYPE.CHECKBOX, value: 'Yes' }, { exportValue: 'Yes' });
    expect(resetCalls(on, 'Off')).toEqual([{ kind: 'checked', checked: false }]);
  });

  it('radio: only the default button is switched on; no default turns the on one off', () => {
    const a = widget({ type: PDF_FORM_FIELD_TYPE.RADIOBUTTON, value: 'A' }, { exportValue: 'A' });
    const b = widget({ type: PDF_FORM_FIELD_TYPE.RADIOBUTTON, value: 'A' }, { exportValue: 'B' });
    expect(resetCalls(a, 'B')).toEqual([]);
    expect(resetCalls(b, 'B')).toEqual([{ kind: 'checked', checked: true }]);
    expect(resetCalls(a, null)).toEqual([{ kind: 'checked', checked: false }]);
    expect(resetCalls(b, null)).toEqual([]);
  });

  it('combo: selects /DV (PDFium cannot deselect a combo item)', () => {
    const options = [
      { label: 'DN50', isSelected: false },
      { label: 'DN80', isSelected: true },
    ];
    const w = widget({ type: PDF_FORM_FIELD_TYPE.COMBOBOX, value: 'DN80', options });
    expect(resetCalls(w, 'DN50')).toEqual([{ kind: 'selection', index: 0, isSelected: true }]);
    expect(resetCalls(w, null)).toEqual([]);
    expect(resetCalls(w, 'DN80')).toEqual([]);
  });

  it('list: deselects others and selects /DV', () => {
    const options = [
      { label: 'DN50', isSelected: false },
      { label: 'DN80', isSelected: true },
    ];
    const w = widget({ type: PDF_FORM_FIELD_TYPE.LISTBOX, value: 'DN80', options });
    expect(selectedIndexes(w)).toEqual([1]);
    expect(resetCalls(w, 'DN50')).toEqual([
      { kind: 'selection', index: 1, isSelected: false },
      { kind: 'selection', index: 0, isSelected: true },
    ]);
    expect(resetCalls(w, null)).toEqual([{ kind: 'selection', index: 1, isSelected: false }]);
    expect(resetCalls(w, 'DN80')).toEqual([]);
  });
});
