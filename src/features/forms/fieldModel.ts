// Form field design (M6-14, ADR-021 D-39, ADR-022 decision 4), pure: which
// Form-tab command turns on which @embedpdf/plugin-form tool, the readable
// names and radio ids new fields get, field flag bits, the Field Properties
// a widget offers, and a page's tab order setting. No engine or DOM here.
import { PDF_FORM_FIELD_FLAG, PDF_FORM_FIELD_TYPE } from '@embedpdf/models';
import type { TabOrder } from '../../model/formFacts';

/** The plugin's field tools (also our appStore tools and interaction modes). */
export const FIELD_TOOLS = [
  'formTextField',
  'formCheckbox',
  'formRadioButton',
  'formListbox',
  'formCombobox',
] as const;
export type FieldTool = (typeof FIELD_TOOLS)[number];

export const isFieldTool = (t: string): t is FieldTool =>
  (FIELD_TOOLS as readonly string[]).includes(t);

/** Form tab command → field tool. */
export const FIELD_COMMANDS: Record<string, FieldTool> = {
  'form.textField': 'formTextField',
  'form.checkBox': 'formCheckbox',
  'form.radioButton': 'formRadioButton',
  'form.listBox': 'formListbox',
  'form.dropdown': 'formCombobox',
};

/** Tools in which fields are designed, not filled: the fill controls step aside. */
export const isDesignTool = (t: string): boolean => t === 'selectFields' || isFieldTool(t);

export type FieldKindName = 'text' | 'checkbox' | 'radio' | 'list' | 'combo';

export const KIND_OF_TOOL: Record<FieldTool, FieldKindName> = {
  formTextField: 'text',
  formCheckbox: 'checkbox',
  formRadioButton: 'radio',
  formListbox: 'list',
  formCombobox: 'combo',
};

export function kindOfType(type: PDF_FORM_FIELD_TYPE): FieldKindName | null {
  switch (type) {
    case PDF_FORM_FIELD_TYPE.TEXTFIELD:
      return 'text';
    case PDF_FORM_FIELD_TYPE.CHECKBOX:
      return 'checkbox';
    case PDF_FORM_FIELD_TYPE.RADIOBUTTON:
      return 'radio';
    case PDF_FORM_FIELD_TYPE.LISTBOX:
      return 'list';
    case PDF_FORM_FIELD_TYPE.COMBOBOX:
      return 'combo';
    default:
      return null;
  }
}

/**
 * A name prefix as a partial field name: periods separate the parts of a
 * fully qualified name (PDF 32000-1 §12.7.3.2), so they go, and so does
 * leading or trailing space.
 */
export const namePrefix = (label: string): string => label.replace(/\./g, '').trim() || 'Field';

/**
 * The first `<prefix><n>` (n = 1, 2, …) not among `taken` — "Text1",
 * "Check Box2" — so a new field never joins another by name.
 */
export function nextName(prefix: string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const name = `${prefix}${String(n)}`;
    if (!taken.has(name)) return name;
  }
}

/**
 * A radio button's id, which is also its export value (ADR-022 d4: the plugin
 * writes the widget id as the on-state): "Choice1", "Choice2", … unique among
 * the document's annotation ids.
 */
export const nextChoiceId = (ids: ReadonlySet<string>): string => nextName('Choice', ids);

/** Text field flag bits (PDF 32000-1 table 228) beyond the common ones. */
export const FLAG_MULTILINE = 1 << 12;
/** Choice field: several items may be selected (table 230). */
export const FLAG_MULTI_SELECT = 1 << 21;
/** Combo box (table 230), set by the engine for dropdowns. */
export const FLAG_COMBO = 1 << 17;

export type FieldFlag = 'readOnly' | 'required' | 'multiline' | 'multiSelect';

export const FLAG_BITS: Record<FieldFlag, number> = {
  readOnly: PDF_FORM_FIELD_FLAG.READONLY,
  required: PDF_FORM_FIELD_FLAG.REQUIRED,
  multiline: FLAG_MULTILINE,
  multiSelect: FLAG_MULTI_SELECT,
};

export const hasFlag = (flags: number, f: FieldFlag): boolean => (flags & FLAG_BITS[f]) !== 0;

export const withFlag = (flags: number, f: FieldFlag, on: boolean): number =>
  on ? flags | FLAG_BITS[f] : flags & ~FLAG_BITS[f];

/** The rows of Field Properties a field kind shows (the plan's list, per kind). */
export interface FieldRows {
  multiline: boolean;
  maxLength: boolean;
  multiSelect: boolean;
  options: boolean;
  exportValue: boolean;
  /** A text default (/DV); toggles default to on/off, choices to an option. */
  defaultValue: 'text' | 'toggle' | 'option';
  font: boolean;
}

export function rowsOf(kind: FieldKindName): FieldRows {
  const text = kind === 'text';
  const choice = kind === 'list' || kind === 'combo';
  const toggle = kind === 'checkbox' || kind === 'radio';
  return {
    multiline: text,
    maxLength: text,
    multiSelect: kind === 'list',
    options: choice,
    exportValue: toggle,
    defaultValue: text ? 'text' : toggle ? 'toggle' : 'option',
    font: text || choice,
  };
}

/** /MaxLen: a whole number from 0 (no limit) to 32767. */
export const MAX_LENGTH_LIMIT = 32767;

/**
 * The options list editor's text (one option per line) → option labels:
 * trimmed, empty lines dropped, duplicates kept once (a choice field's
 * value is the label, so two equal labels could not be told apart).
 */
export function parseOptions(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const label = line.trim();
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

/** The plugin's options shape, keeping the selection where the label survives. */
export function optionsWith(
  labels: readonly string[],
  selected: readonly string[],
): { label: string; isSelected: boolean }[] {
  return labels.map((label) => ({ label, isSelected: selected.includes(label) }));
}

/** A page's tab order setting (/Tabs): row, column, structure, or none (annotation order). */
export const TAB_ORDERS: readonly ('R' | 'C' | 'S' | 'none')[] = ['R', 'C', 'S', 'none'];

export const tabOrderOf = (t: TabOrder): 'R' | 'C' | 'S' | 'none' =>
  t === 'R' || t === 'C' || t === 'S' ? t : 'none';

/**
 * The /DV a field gets from Field Properties' default (PDF 32000-1 §12.7.3.1):
 * a text string for text and choice fields; for a check box or radio group
 * the on-state name (its export value) or /Off. null removes /DV.
 */
export type DefaultJson = { text: string } | { name: string } | null;

export function defaultJson(kind: FieldKindName, value: string | null): DefaultJson {
  if (value === null || value === '') return null;
  if (kind === 'checkbox' || kind === 'radio') return { name: value };
  return { text: value };
}
