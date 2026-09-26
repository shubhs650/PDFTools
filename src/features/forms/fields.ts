// Pure form logic (M2-14, D-26, ADR-013 decision 4): which widgets are
// fillable, their tab order (/Tabs /R, /C; /S or none = /Annots order), value
// normalization per field type, and what Reset Form sets from /DV.
import {
  PDF_FORM_FIELD_FLAG,
  PDF_FORM_FIELD_TYPE,
  type FormFieldValue,
  type PdfWidgetAnnoObject,
} from '@embedpdf/models';
import type { TabOrder } from '../../model/formFacts';

export type FieldKind = 'text' | 'checkbox' | 'radio' | 'combo' | 'list';

/** Text field flag bits (PDF 32000-1 table 228). */
const MULTILINE = 1 << 12;
const PASSWORD = 1 << 13;
/** Choice field: several items may be selected. */
const MULTI_SELECT = 1 << 21;

export function kindOf(w: PdfWidgetAnnoObject): FieldKind | null {
  // Hidden widgets aren't shown, so they aren't filled either.
  if (w.flags?.some((f) => f === 'hidden' || f === 'invisible' || f === 'noView')) return null;
  switch (w.field.type) {
    case PDF_FORM_FIELD_TYPE.TEXTFIELD:
      return 'text';
    case PDF_FORM_FIELD_TYPE.CHECKBOX:
      return 'checkbox';
    case PDF_FORM_FIELD_TYPE.RADIOBUTTON:
      return 'radio';
    case PDF_FORM_FIELD_TYPE.COMBOBOX:
      return 'combo';
    case PDF_FORM_FIELD_TYPE.LISTBOX:
      return 'list';
    default:
      return null; // push buttons, signatures, XFA: not filled here
  }
}

export const isReadOnly = (w: PdfWidgetAnnoObject): boolean =>
  (w.field.flag & PDF_FORM_FIELD_FLAG.READONLY) !== 0;
export const isRequired = (w: PdfWidgetAnnoObject): boolean =>
  (w.field.flag & PDF_FORM_FIELD_FLAG.REQUIRED) !== 0;
export const isMultiline = (w: PdfWidgetAnnoObject): boolean => (w.field.flag & MULTILINE) !== 0;
export const isPassword = (w: PdfWidgetAnnoObject): boolean => (w.field.flag & PASSWORD) !== 0;
export const isMultiSelect = (w: PdfWidgetAnnoObject): boolean =>
  (w.field.flag & MULTI_SELECT) !== 0;

/** The accessible name: the tooltip (/TU), else the field name (/T). */
export const fieldLabel = (w: PdfWidgetAnnoObject): string =>
  w.field.alternateName.trim() || w.field.name;

interface Placed {
  rect: { origin: { x: number; y: number }; size: { width: number; height: number } };
}

/**
 * Indexes of `widgets` (given in /Annots order) in tab order. Rows (/R):
 * top to bottom, then left to right, where widgets whose vertical centres
 * fall within the first one's height share a row. Columns (/C): left to
 * right, then top to bottom, likewise. Rects are in page space, y down.
 */
export function tabOrder(widgets: readonly Placed[], tabs: TabOrder): number[] {
  const idx = widgets.map((_, i) => i);
  if (tabs !== 'R' && tabs !== 'C') return idx;
  const main = tabs === 'R' ? 'y' : 'x';
  const cross = tabs === 'R' ? 'x' : 'y';
  const extent = (w: Placed): number => (main === 'y' ? w.rect.size.height : w.rect.size.width);
  const start = (w: Placed, axis: 'x' | 'y'): number => w.rect.origin[axis];
  const centre = (w: Placed): number => start(w, main) + extent(w) / 2;
  const byMain = [...idx].sort((a, b) => {
    const wa = widgets[a];
    const wb = widgets[b];
    if (!wa || !wb) return 0;
    return start(wa, main) - start(wb, main) || a - b;
  });
  const out: number[] = [];
  let band: number[] = [];
  let bandEnd = -Infinity;
  const flush = (): void => {
    band.sort((a, b) => {
      const wa = widgets[a];
      const wb = widgets[b];
      if (!wa || !wb) return 0;
      return start(wa, cross) - start(wb, cross) || a - b;
    });
    out.push(...band);
    band = [];
  };
  for (const i of byMain) {
    const w = widgets[i];
    if (!w) continue;
    if (band.length > 0 && centre(w) > bandEnd) flush();
    if (band.length === 0) bandEnd = start(w, main) + extent(w);
    band.push(i);
  }
  flush();
  return out;
}

/** Text as it would be stored: single-line fields lose line breaks; /MaxLen cuts. */
export function normalizeText(w: PdfWidgetAnnoObject, text: string): string {
  let v = text.replace(/\r\n?/g, '\n');
  if (!isMultiline(w)) v = v.replace(/\n/g, ' ');
  const max = w.field.type === PDF_FORM_FIELD_TYPE.TEXTFIELD ? w.field.maxLen : undefined;
  if (max !== undefined && max > 0) v = Array.from(v).slice(0, max).join('');
  return v;
}

/** The option labels of a choice field (from /Opt). */
export const optionsOf = (w: PdfWidgetAnnoObject): string[] =>
  'options' in w.field ? w.field.options.map((o) => o.label) : [];

/** Indexes of the selected options (from the options' flags, else the value). */
export function selectedIndexes(w: PdfWidgetAnnoObject): number[] {
  if (!('options' in w.field)) return [];
  const flagged = w.field.options.flatMap((o, i) => (o.isSelected ? [i] : []));
  if (flagged.length > 0) return flagged;
  const at = w.field.options.findIndex((o) => o.label === w.field.value);
  return at >= 0 ? [at] : [];
}

/** A checkbox or radio widget is on when the field value is its export value. */
export const isChecked = (w: PdfWidgetAnnoObject): boolean =>
  w.exportValue !== undefined && w.field.value === w.exportValue;

/**
 * The calls that put a widget's field back to `dv` (null = no default: empty,
 * off, nothing selected). For a radio group, call it for each widget: the one
 * whose export value is the default is switched on, the others give none
 * (turning one off would turn the group's value off after it was set).
 */
export function resetCalls(w: PdfWidgetAnnoObject, dv: string | null): FormFieldValue[] {
  switch (kindOf(w)) {
    case 'text':
      return w.field.value === (dv ?? '') ? [] : [{ kind: 'text', text: dv ?? '' }];
    case 'checkbox': {
      const on = dv !== null && dv !== 'Off' && dv === w.exportValue;
      return isChecked(w) === on ? [] : [{ kind: 'checked', checked: on }];
    }
    case 'radio': {
      if (dv !== null && dv !== 'Off')
        return dv === w.exportValue && !isChecked(w) ? [{ kind: 'checked', checked: true }] : [];
      return isChecked(w) ? [{ kind: 'checked', checked: false }] : [];
    }
    case 'combo': {
      // PDFium can't deselect a combo box's item (ADR-013 note in M2-14): select the default only.
      const want = dv === null ? -1 : optionsOf(w).indexOf(dv);
      return want >= 0 && !selectedIndexes(w).includes(want)
        ? [{ kind: 'selection', index: want, isSelected: true }]
        : [];
    }
    case 'list': {
      const options = optionsOf(w);
      const want = dv === null ? -1 : options.indexOf(dv);
      const now = selectedIndexes(w);
      const calls: FormFieldValue[] = now
        .filter((i) => i !== want)
        .map((index) => ({ kind: 'selection', index, isSelected: false }));
      if (want >= 0 && !now.includes(want))
        calls.push({ kind: 'selection', index: want, isSelected: true });
      return calls;
    }
    default:
      return [];
  }
}

/** The field a widget belongs to (radio kids share their parent's). */
export const fieldKey = (w: PdfWidgetAnnoObject): string =>
  w.field.fieldObjectId !== undefined ? String(w.field.fieldObjectId) : `name:${w.field.name}`;
