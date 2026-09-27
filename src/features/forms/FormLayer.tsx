import type { FormFieldValue, PdfWidgetAnnoObject } from '@embedpdf/models';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { securityOf, useDocuments } from '../../app/store/documentStore';
import type { TabOrder } from '../../model/formFacts';
import { allows } from '../../model/permissions';
import { SETTLE_MS } from '../view/pageLinks';
import {
  fieldKey,
  fieldLabel,
  isChecked,
  isMultiline,
  isPassword,
  isReadOnly,
  isRequired,
  kindOf,
  normalizeText,
  optionsOf,
  selectedIndexes,
  tabOrder,
} from './fields';
import { fill, formFactsOf, useForms, widgetsOf } from './formStore';

/** `FPDF_GetFormType`: 0 no AcroForm; 2 a dynamic XFA form, which is not filled (§7.10). */
const NO_FORM = 0;
const XFA_FULL = 2;

interface Loaded {
  version: number;
  widgets: PdfWidgetAnnoObject[];
  tabs: TabOrder;
}

/**
 * Tab / Shift+Tab move between form fields in tab order across the laid-out
 * pages (a page's fields, then the next page's), skipping the page's links.
 */
function moveFocus(e: KeyboardEvent<HTMLElement>): void {
  if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
  const view = e.currentTarget.closest('[data-testid="document-view"]') ?? document;
  const all = [...view.querySelectorAll<HTMLElement>('[data-form-control]')];
  const next = all[all.indexOf(e.currentTarget) + (e.shiftKey ? -1 : 1)];
  if (!next) return; // past the last (or first) field: the browser's own order
  e.preventDefault();
  next.focus();
}

/**
 * AcroForm fields of one page as HTML controls over their widgets (M2-14,
 * D-26): text, checkbox, radio, combo and list, named by /TU or /T (rule 12),
 * in the page's tab order. Read-only fields, and every field when the
 * document forbids filling (rule 9), stay focusable but can't be changed.
 */
export function FormLayer({
  documentId,
  pageIndex,
  scale,
}: {
  documentId: string;
  pageIndex: number;
  scale: number;
}) {
  const { t } = useTranslation();
  const version = useForms((s) => s.version[documentId] ?? 0);
  const canFill = useDocuments((s) => {
    const d = s.docs[documentId];
    return d ? allows(securityOf(d.meta), 'fillForms') : false;
  });
  const formType = useDocuments((s) => s.docs[documentId]?.meta.formType ?? 0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const settled = useRef(false);

  const hasForm = formType !== NO_FORM && formType !== XFA_FULL;
  useEffect(() => {
    // No AcroForm: no Render-worker call for any page (most documents).
    if (!hasForm) return;
    let live = true;
    const load = async (): Promise<void> => {
      const f = await formFactsOf(documentId);
      // Only pages with an /Annots array can hold widgets (when the facts could read the tree).
      if (f.tabs.length > 0 && !f.annotated.includes(pageIndex)) return;
      const w = await widgetsOf(documentId, pageIndex);
      if (live) setLoaded({ version, widgets: w, tabs: f.tabs[pageIndex] ?? null });
    };
    // The first load waits for the page to settle (a fast scroll asks for none); reloads don't.
    const timer = setTimeout(
      () => {
        load().catch(() => undefined);
      },
      settled.current ? 0 : SETTLE_MS,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [documentId, pageIndex, version, hasForm]);
  useEffect(() => {
    if (loaded) settled.current = true;
  }, [loaded]);

  if (!hasForm || !loaded) return null;
  const fillable = loaded.widgets.filter((w) => kindOf(w) !== null);
  if (fillable.length === 0) return null;
  const order = tabOrder(fillable, loaded.tabs);
  const denied = canFill ? null : t('forms.fillDenied');

  const commit = (w: PdfWidgetAnnoObject, value: FormFieldValue): void => {
    void fill(documentId, pageIndex, w, value).catch(() => undefined);
  };

  return (
    <div className="form-layer">
      {order.map((i) => {
        const w = fillable[i];
        if (!w) return null;
        const locked = isReadOnly(w) || !canFill;
        const reason = isReadOnly(w) ? t('forms.readOnly') : denied;
        const label = fieldLabel(w);
        const common = {
          'aria-label': label,
          'aria-required': isRequired(w) || undefined,
          'aria-readonly': locked || undefined,
          title: reason ? `${label} — ${reason}` : label,
          'data-form-control': '',
          'data-field': w.field.name,
          onKeyDown: moveFocus,
          style: {
            left: w.rect.origin.x * scale,
            top: w.rect.origin.y * scale,
            width: w.rect.size.width * scale,
            height: w.rect.size.height * scale,
            fontSize:
              (w.fontSize > 0 ? w.fontSize : Math.min(12, w.rect.size.height * 0.7)) * scale,
          },
        };
        return (
          <Field
            // /Annots position and name: stable across reloads, so focus stays put.
            key={`${String(i)}|${w.field.name}`}
            widget={w}
            locked={locked}
            radioName={`${documentId}|${fieldKey(w)}`}
            common={common}
            onCommit={(value) => {
              commit(w, value);
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * Ctrl+S and Ctrl+P work from a text field (keymap `inText`): the typed value
 * is committed first, so the save or print includes it.
 */
const commitsFirst = (e: KeyboardEvent<HTMLElement>): boolean =>
  (e.ctrlKey || e.metaKey) && !e.altKey && ['s', 'p'].includes(e.key.toLowerCase());

type Common = Record<string, unknown> & { onKeyDown: (e: KeyboardEvent<HTMLElement>) => void };

function Field({
  widget: w,
  locked,
  radioName,
  common,
  onCommit,
}: {
  widget: PdfWidgetAnnoObject;
  locked: boolean;
  radioName: string;
  common: Common;
  onCommit: (value: FormFieldValue) => void;
}) {
  const [draft, setDraft] = useState(w.field.value);
  // A toggle or choice shows the user's pick until the reloaded widget has it.
  const [pending, setPending] = useState<FormFieldValue | null>(null);
  const [focused, setFocused] = useState(false);
  // A reloaded widget: its value wins, except over text being typed.
  const [seen, setSeen] = useState(w);
  if (seen !== w) {
    setSeen(w);
    setPending(null);
    if (!focused) setDraft(w.field.value);
  }
  const kind = kindOf(w);
  const pick = (value: FormFieldValue): void => {
    setPending(value);
    onCommit(value);
  };
  const cls = `form-field form-${kind ?? 'none'}`;

  if (kind === 'text') {
    const save = (): void => {
      const text = normalizeText(w, draft);
      if (text !== draft) setDraft(text);
      if (!locked && text !== w.field.value) onCommit({ kind: 'text', text });
    };
    const maxLen = 'maxLen' in w.field && w.field.maxLen ? w.field.maxLen : undefined;
    return isMultiline(w) ? (
      <textarea
        {...common}
        className={cls}
        value={draft}
        readOnly={locked}
        maxLength={maxLen}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
          save();
        }}
        onKeyDown={(e) => {
          if (commitsFirst(e)) save();
          common.onKeyDown(e);
        }}
      />
    ) : (
      <input
        {...common}
        className={cls}
        type={isPassword(w) ? 'password' : 'text'}
        value={draft}
        readOnly={locked}
        maxLength={maxLen}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
          save();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || commitsFirst(e)) save();
          common.onKeyDown(e);
        }}
      />
    );
  }
  if (kind === 'checkbox' || kind === 'radio') {
    return (
      <input
        {...common}
        className={cls}
        type={kind}
        name={kind === 'radio' ? radioName : undefined}
        checked={pending?.kind === 'checked' ? pending.checked : isChecked(w)}
        onChange={(e) => {
          if (locked) return; // controlled: the box keeps its state
          pick({ kind: 'checked', checked: kind === 'radio' ? true : e.target.checked });
        }}
      />
    );
  }
  if (kind === 'combo' || kind === 'list') {
    const options = optionsOf(w);
    const selected = pending?.kind === 'selection' ? pending.index : (selectedIndexes(w)[0] ?? -1);
    return (
      <select
        {...common}
        className={cls}
        size={kind === 'list' ? Math.max(2, options.length) : undefined}
        value={String(selected)}
        onChange={(e) => {
          const index = Number(e.target.value);
          if (locked || index < 0) return;
          pick({ kind: 'selection', index, isSelected: true });
        }}
      >
        {/* Nothing selected: React would otherwise select the first item. */}
        {selected < 0 ? <option value="-1" disabled hidden /> : null}
        {options.map((o, i) => (
          <option key={i} value={String(i)}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  return null;
}
