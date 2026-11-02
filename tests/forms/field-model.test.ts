import { PDF_FORM_FIELD_FLAG, PDF_FORM_FIELD_TYPE } from '@embedpdf/models';
import { describe, expect, it } from 'vitest';
import {
  FIELD_COMMANDS,
  FIELD_TOOLS,
  KIND_OF_TOOL,
  defaultJson,
  hasFlag,
  isDesignTool,
  isFieldTool,
  kindOfType,
  namePrefix,
  nextChoiceId,
  nextName,
  optionsWith,
  parseOptions,
  rowsOf,
  tabOrderOf,
  withFlag,
} from '../../src/features/forms/fieldModel';
import { isFieldDesign } from '../../src/engine/mutations';

// Form field design (M6-14, ADR-021 D-39, ADR-022 decision 4, §7.10).

describe('field tools', () => {
  it('every Form tab field command turns on one of the plugin’s five tools', () => {
    expect(Object.values(FIELD_COMMANDS).sort()).toEqual([...FIELD_TOOLS].sort());
    for (const t of FIELD_TOOLS) expect(KIND_OF_TOOL[t]).toBeTruthy();
  });

  it('fields are designed with Select Fields or a field tool; filled with the others', () => {
    expect(isFieldTool('formTextField')).toBe(true);
    expect(isFieldTool('square')).toBe(false);
    expect(isDesignTool('selectFields')).toBe(true);
    expect(isDesignTool('formCombobox')).toBe(true);
    expect(isDesignTool('select')).toBe(false);
    expect(isDesignTool('hand')).toBe(false);
  });

  it('maps PDF field types to the five kinds (push buttons and signatures are not designed)', () => {
    expect(kindOfType(PDF_FORM_FIELD_TYPE.TEXTFIELD)).toBe('text');
    expect(kindOfType(PDF_FORM_FIELD_TYPE.CHECKBOX)).toBe('checkbox');
    expect(kindOfType(PDF_FORM_FIELD_TYPE.RADIOBUTTON)).toBe('radio');
    expect(kindOfType(PDF_FORM_FIELD_TYPE.LISTBOX)).toBe('list');
    expect(kindOfType(PDF_FORM_FIELD_TYPE.COMBOBOX)).toBe('combo');
    expect(kindOfType(PDF_FORM_FIELD_TYPE.PUSHBUTTON)).toBeNull();
    expect(kindOfType(PDF_FORM_FIELD_TYPE.SIGNATURE)).toBeNull();
  });
});

describe('names', () => {
  it('a new field takes the first free readable name', () => {
    expect(nextName('Text', new Set())).toBe('Text1');
    expect(nextName('Text', new Set(['Text1', 'Text2', 'Text4']))).toBe('Text3');
    expect(nextName('Check Box', new Set(['Text1']))).toBe('Check Box1');
  });

  it('a name prefix is a partial field name: no periods', () => {
    expect(namePrefix('Check Box')).toBe('Check Box');
    expect(namePrefix(' a.b. ')).toBe('ab');
    expect(namePrefix('...')).toBe('Field');
  });

  it('radio ids (their export values) are Choice1, Choice2, … unique among annotation ids', () => {
    expect(nextChoiceId(new Set())).toBe('Choice1');
    expect(nextChoiceId(new Set(['Choice1', 'x']))).toBe('Choice2');
  });
});

describe('flags', () => {
  it('sets and clears one bit, leaving the others', () => {
    const f = PDF_FORM_FIELD_FLAG.REQUIRED | (1 << 17);
    expect(hasFlag(f, 'required')).toBe(true);
    expect(hasFlag(f, 'readOnly')).toBe(false);
    const on = withFlag(f, 'multiline', true);
    expect(on & (1 << 12)).toBe(1 << 12);
    expect(on & (1 << 17)).toBe(1 << 17);
    expect(withFlag(on, 'required', false) & PDF_FORM_FIELD_FLAG.REQUIRED).toBe(0);
    expect(withFlag(0, 'multiSelect', true)).toBe(1 << 21);
    expect(withFlag(0, 'readOnly', true)).toBe(1);
  });
});

describe('Field Properties rows', () => {
  it('text fields: multi-line, maximum length, a text default, a font', () => {
    expect(rowsOf('text')).toEqual({
      multiline: true,
      maxLength: true,
      multiSelect: false,
      options: false,
      exportValue: false,
      defaultValue: 'text',
      font: true,
    });
  });

  it('check boxes and radio buttons: an export value and an on/off default, no font', () => {
    for (const k of ['checkbox', 'radio'] as const)
      expect(rowsOf(k)).toMatchObject({
        exportValue: true,
        defaultValue: 'toggle',
        options: false,
        font: false,
      });
  });

  it('list boxes and dropdowns: items and an item default; only list boxes multi-select', () => {
    expect(rowsOf('list')).toMatchObject({
      options: true,
      defaultValue: 'option',
      multiSelect: true,
    });
    expect(rowsOf('combo')).toMatchObject({
      options: true,
      defaultValue: 'option',
      multiSelect: false,
    });
  });
});

describe('options', () => {
  it('one item per line: trimmed, no empty lines, each label once', () => {
    expect(parseOptions(' DN50\r\n\nDN80 \nDN50\n  \nDN100')).toEqual(['DN50', 'DN80', 'DN100']);
    expect(parseOptions('')).toEqual([]);
  });

  it('keeps the selection where the label survives', () => {
    expect(optionsWith(['a', 'b'], ['b', 'gone'])).toEqual([
      { label: 'a', isSelected: false },
      { label: 'b', isSelected: true },
    ]);
  });
});

describe('defaults and tab order', () => {
  it('/DV: a name for toggles, a text string otherwise; empty removes it', () => {
    expect(defaultJson('text', 'n/a')).toEqual({ text: 'n/a' });
    expect(defaultJson('combo', 'DN80')).toEqual({ text: 'DN80' });
    expect(defaultJson('checkbox', 'Yes')).toEqual({ name: 'Yes' });
    expect(defaultJson('radio', 'Choice2')).toEqual({ name: 'Choice2' });
    expect(defaultJson('text', '')).toBeNull();
    expect(defaultJson('radio', null)).toBeNull();
  });

  it('/Tabs R, C, S; anything else is annotation order', () => {
    expect(tabOrderOf('R')).toBe('R');
    expect(tabOrderOf('S')).toBe('S');
    expect(tabOrderOf(null)).toBe('none');
  });
});

describe('isFieldDesign (the Render worker asks modify + annotate, rule 9)', () => {
  const doc = { id: 'd' };
  const page = { index: 0 };
  it('creating, changing or deleting a widget, renaming or sharing a field', () => {
    for (const m of ['createPageAnnotation', 'updatePageAnnotation', 'removePageAnnotation'])
      expect(isFieldDesign(m, [doc, page, { type: 20 }])).toBe(true);
    expect(isFieldDesign('renameWidgetField', [])).toBe(true);
    expect(isFieldDesign('shareWidgetField', [])).toBe(true);
  });

  it('not other annotations, and not filling a field in', () => {
    expect(isFieldDesign('createPageAnnotation', [doc, page, { type: 9 }])).toBe(false);
    expect(isFieldDesign('setFormFieldValue', [doc, page, { type: 20 }])).toBe(false);
  });
});
