// What Field Properties changes (M6-14, §7.10, ADR-022 d4). Name, flags,
// /MaxLen, options and the look go through EmbedPDF (renameField /
// shareField, or the annotation plugin's update: one undo step each); the
// tooltip (/TU) and default value (/DV), which EmbedPDF doesn't write, and a
// page's tab order (/Tabs) are staged on our object layer for the next
// Ctrl+S (ADR-007). All of it needs modify + annotate (rule 9); the Render
// worker refuses independently.
import type { PdfWidgetAnnoField, PdfWidgetAnnoObject } from '@embedpdf/models';
import type { FormCapability } from '@embedpdf/plugin-form';
import { recordError } from '../../app/diagnostics';
import { documentStore } from '../../app/store/documentStore';
import type { MessageKey } from '../../i18n';
import { msg } from '../../i18n';
import type { TabOrder } from '../../model/formFacts';
import type { PdfJson } from '../../model/pdf/wire';
import { annotationCapability } from '../annotate/selection';
import { capability, hostStore, renderEngine } from '../view/host';
import { documentWidgets } from './fieldTools';
import { defaultJson, kindOfType } from './fieldModel';
import { designOf, fieldsChanged, updateDesign } from './formStore';

function formCap(): FormCapability | null {
  const registry = hostStore.getState().registry;
  if (!registry) return null;
  try {
    return capability<FormCapability>(registry, 'form');
  } catch {
    return null;
  }
}

/** The widget as PDFium has it now (a value filled on the page is newer than the plugin's copy). */
async function fresh(docId: string, w: PdfWidgetAnnoObject): Promise<PdfWidgetAnnoObject> {
  const doc = hostStore.getState().registry?.getStore().getState().core.documents[docId]?.document;
  const page = doc?.pages[w.pageIndex];
  if (!doc || !page) return w;
  const list = await new Promise<PdfWidgetAnnoObject[]>((resolve) => {
    renderEngine()
      .engine.getPageAnnoWidgets(doc, page)
      .wait(resolve, () => {
        resolve([]);
      });
  });
  return list.find((x) => x.id === w.id) ?? w;
}

/** A field-level change (flags, /MaxLen, options), onto the field as PDFium has it. */
export async function updateField(
  docId: string,
  w: PdfWidgetAnnoObject,
  change: (field: PdfWidgetAnnoField) => PdfWidgetAnnoField,
): Promise<void> {
  const now = await fresh(docId, w);
  annotationCapability()
    ?.forDocument(docId)
    .updateAnnotation(w.pageIndex, w.id, { field: change({ ...w.field, value: now.field.value }) });
  fieldsChanged(docId, w.pageIndex);
}

/** The look (font, size, colours): one update of the widget. */
export function updateLook(
  docId: string,
  w: PdfWidgetAnnoObject,
  patch: Partial<
    Pick<PdfWidgetAnnoObject, 'fontFamily' | 'fontSize' | 'fontColor' | 'strokeColor' | 'color'>
  >,
): void {
  annotationCapability()?.forDocument(docId).updateAnnotation(w.pageIndex, w.id, patch);
  fieldsChanged(docId, w.pageIndex);
}

/** A partial field name: not empty, no period (PDF 32000-1 §12.7.3.2). */
export const validName = (name: string): boolean => name.trim() !== '' && !name.includes('.');

/**
 * Renames the field. A radio button given another radio group's name joins
 * that group; any other clash is refused. Resolves to an error message key,
 * or null when done.
 */
export async function renameField(
  docId: string,
  w: PdfWidgetAnnoObject,
  name: string,
): Promise<MessageKey | null> {
  const next = name.trim();
  if (!validName(next)) return msg('forms.props.nameInvalid');
  if (next === w.field.name) return null;
  const form = formCap();
  if (!form) return null;
  const other = documentWidgets(docId).find((o) => o.id !== w.id && o.field.name === next);
  const before = w.field.name;
  try {
    if (other) {
      if (kindOfType(w.field.type) !== 'radio' || other.field.type !== w.field.type)
        return msg('forms.props.nameTaken');
      await form.shareField(w.id, other.id, docId).toPromise();
    } else {
      const r = await form.renameField(w.id, next, docId).toPromise();
      if (r.outcome === 'conflict') return msg('forms.props.nameTaken');
      // Staged tooltip and default go with the name.
      updateDesign(docId, (d) => ({
        tooltips: moveKey(d.tooltips, before, next),
        defaults: moveKey(d.defaults, before, next),
      }));
    }
  } catch (err) {
    recordError('forms.rename', err);
    return msg('forms.props.denied');
  }
  documentStore.getState().markDirty(docId);
  fieldsChanged(docId, w.pageIndex);
  return null;
}

function moveKey<T>(rec: Record<string, T>, from: string, to: string): Record<string, T> {
  if (!(from in rec)) return rec;
  const { [from]: v, ...rest } = rec;
  return v === undefined ? rest : { ...rest, [to]: v };
}

async function stage(
  docId: string,
  target: { page: number; annot?: string; field?: true },
  key: string,
  value: PdfJson | null,
): Promise<boolean> {
  try {
    await renderEngine().rpc.call('stageObjects', {
      docId,
      target,
      set: value === null ? {} : { [key]: value },
      ...(value === null ? { remove: [key] } : {}),
    }).promise;
    documentStore.getState().markDirty(docId);
    return true;
  } catch (err) {
    recordError('forms.stage', err);
    return false;
  }
}

/** The tooltip (/TU) on the widget's field; empty removes it. */
export async function setTooltip(
  docId: string,
  w: PdfWidgetAnnoObject,
  text: string,
): Promise<void> {
  const value = text.trim();
  const ok = await stage(
    docId,
    { page: w.pageIndex, annot: w.id, field: true },
    'TU',
    value ? { text: value } : null,
  );
  if (ok) updateDesign(docId, (d) => ({ tooltips: { ...d.tooltips, [w.field.name]: value } }));
  fieldsChanged(docId, w.pageIndex);
}

/** The default value (/DV) Reset Form restores; null removes it. */
export async function setDefault(
  docId: string,
  w: PdfWidgetAnnoObject,
  value: string | null,
): Promise<void> {
  const kind = kindOfType(w.field.type);
  if (!kind) return;
  const json = defaultJson(kind, value);
  const ok = await stage(docId, { page: w.pageIndex, annot: w.id, field: true }, 'DV', json);
  if (ok)
    updateDesign(docId, (d) => ({
      defaults: { ...d.defaults, [w.field.name]: json === null ? null : (value ?? null) },
    }));
}

/** The staged tooltip / default of a field, if any (they show only after a reopen otherwise). */
export const stagedTooltip = (docId: string, name: string): string | undefined =>
  designOf(docId).tooltips[name];
export const stagedDefault = (docId: string, name: string): string | null | undefined =>
  designOf(docId).defaults[name];

/** A page's tab order (/Tabs /R, /C, /S; null removes it: annotation order). */
export async function setTabOrder(docId: string, page: number, order: TabOrder): Promise<void> {
  const ok = await stage(docId, { page }, 'Tabs', order ? { name: order } : null);
  if (ok) updateDesign(docId, (d) => ({ tabs: { ...d.tabs, [page]: order } }));
  fieldsChanged(docId, page);
}
