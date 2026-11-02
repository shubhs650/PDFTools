// Form field creation (M6-14, ADR-021 D-39, ADR-022 decision 4, §7.10):
// @embedpdf/plugin-form's five tools, as the Form tab uses them. The plugin
// draws, previews and creates real AcroForm fields (merged /DA, /MK, /AP);
// this module only adapts what it commits:
//
// - a readable, unique name ("Text1", "Check Box2", "Group1", …) instead of
//   the plugin's `TextField_1a2b3c4d`;
// - radio buttons get readable ids — "Choice1", "Choice2", … unique in the
//   document — because the plugin writes the widget id as the export value;
// - radio buttons drawn one after another (the tool still on, same document)
//   join the first one's group (`shareField`); turning the tool off and on
//   starts a new group, and Field Properties' name can join or leave one;
// - a widget that comes back under a name another field already has (an
//   undone delete, a redone create) joins that field again, so a name is
//   never split over two fields.
//
// Creating, changing and deleting fields needs modify + annotate (rule 9);
// the Render worker refuses independently (tracker.checkAllowed).
import type { PluginRegistry } from '@embedpdf/core';
import {
  PdfAnnotationSubtype,
  uuidV4,
  type PdfAnnotationObject,
  type PdfWidgetAnnoObject,
} from '@embedpdf/models';
import type { AnnotationCapability, AnnotationTool } from '@embedpdf/plugin-annotation';
import type { FormCapability } from '@embedpdf/plugin-form';
import { recordError } from '../../app/diagnostics';
import { appStore } from '../../app/store/appStore';
import { documentStore, selectActive } from '../../app/store/documentStore';
import { msg, t } from '../../i18n';
import { centred } from '../annotate/tools/drawModel';
import { wrapFactory, type HandlerContext } from '../annotate/tools/drawTools';
import { capability, hostStore } from '../view/host';
import {
  FIELD_TOOLS,
  KIND_OF_TOOL,
  namePrefix,
  nextChoiceId,
  nextName,
  type FieldKindName,
  type FieldTool,
} from './fieldModel';
import { fieldsChanged } from './formStore';

const PREFIX_KEYS = {
  text: msg('forms.design.prefix.text'),
  checkbox: msg('forms.design.prefix.checkbox'),
  radio: msg('forms.design.prefix.radio'),
  list: msg('forms.design.prefix.list'),
  combo: msg('forms.design.prefix.combo'),
} satisfies Record<FieldKindName, string>;

const isWidget = (a: PdfAnnotationObject): a is PdfWidgetAnnoObject =>
  a.type === PdfAnnotationSubtype.WIDGET;

const activeId = (): string | null => selectActive(documentStore.getState())?.meta.id ?? null;

function annotationCap(): AnnotationCapability | null {
  const registry = hostStore.getState().registry;
  if (!registry) return null;
  try {
    return capability<AnnotationCapability>(registry, 'annotation');
  } catch {
    return null;
  }
}

function formCap(): FormCapability | null {
  const registry = hostStore.getState().registry;
  if (!registry) return null;
  try {
    return capability<FormCapability>(registry, 'form');
  } catch {
    return null;
  }
}

/** Every widget of the document as the plugin has it now (all loaded pages). */
export function documentWidgets(docId: string): PdfWidgetAnnoObject[] {
  const state = annotationCap()?.forDocument(docId).getState();
  if (!state) return [];
  return Object.values(state.byUid)
    .map((tr) => tr.object)
    .filter(isWidget);
}

function takenNames(docId: string): Set<string> {
  return new Set(documentWidgets(docId).map((w) => w.field.name));
}

function takenIds(docId: string): Set<string> {
  const state = annotationCap()?.forDocument(docId).getState();
  return new Set(state ? Object.keys(state.byUid) : []);
}

/** The radio group new radio buttons join while the tool stays on. */
let group: { docId: string; anchorId: string; name: string } | null = null;
/** Radio buttons waiting for their commit to join `group`'s field. */
const joining = new Map<string, string>(); // new widget id → anchor widget id

/** A committed field that just got a name another field has (see the header). */
function rejoinByName(docId: string, w: PdfWidgetAnnoObject): void {
  const other = documentWidgets(docId).find(
    (o) => o.id !== w.id && o.field.name === w.field.name && o.field.type === w.field.type,
  );
  if (other) share(docId, w.id, other.id);
}

function share(docId: string, id: string, anchorId: string): void {
  const form = formCap();
  if (!form) return;
  form.shareField(id, anchorId, docId).wait(
    () => {
      fieldsChanged(docId);
    },
    (err) => {
      recordError('forms.share', err);
    },
  );
}

/** What a field tool commits, with our name and (radio buttons) id. */
export function adaptField(
  tool: FieldTool,
  docId: string,
  anno: PdfWidgetAnnoObject,
): PdfWidgetAnnoObject {
  const kind = KIND_OF_TOOL[tool];
  const prefix = namePrefix(t(PREFIX_KEYS[kind]));
  if (kind !== 'radio') {
    const name = nextName(prefix, takenNames(docId));
    return { ...anno, field: { ...anno.field, name, alternateName: '' } };
  }
  const id = nextChoiceId(takenIds(docId));
  const anchor = group?.docId === docId && takenIds(docId).has(group.anchorId) ? group : null;
  // The first of a group names it; the others carry a name of their own until
  // they join it (a second field under the group's name would split it).
  const name = anchor ? `${anchor.name}_${id}` : nextName(prefix, takenNames(docId));
  if (anchor) joining.set(id, anchor.anchorId);
  else group = { docId, anchorId: id, name };
  return {
    ...anno,
    id,
    exportValue: id,
    field: { ...anno.field, name, alternateName: '' },
  };
}

/** Called once the plugin registry is up (DocumentHost). */
export function installFieldTools(registry: PluginRegistry): () => void {
  let cap: AnnotationCapability;
  try {
    cap = capability<AnnotationCapability>(registry, 'annotation');
  } catch {
    return () => undefined;
  }
  for (const id of FIELD_TOOLS) {
    const base = cap.getTool(id) as AnnotationTool | undefined;
    const handler = base?.pointerHandler;
    if (!base || !handler) continue;
    const adapt = (context: HandlerContext): HandlerContext => ({
      ...context,
      onCommit: (anno, ctx) => {
        const docId = activeId();
        context.onCommit(docId && isWidget(anno) ? adaptField(id, docId, anno) : anno, ctx);
      },
    });
    cap.addTool({
      ...base,
      // The new field is selected, so Field Properties shows it (tools the
      // plugin adds later don't get the configured selectAfterCreate).
      behavior: { ...base.behavior, selectAfterCreate: true },
      pointerHandler: wrapFactory(id, handler, adapt),
    });
  }

  // A new group whenever the radio tool is turned on again.
  const stopTool = appStore.subscribe((s, prev) => {
    if (s.tool !== prev.tool) group = null;
  });

  const stopEvents = cap.onAnnotationEvent((e) => {
    if (e.type === 'loaded' || !isWidget(e.annotation) || !e.committed) return;
    const docId = e.documentId;
    fieldsChanged(docId, e.pageIndex);
    if (e.type !== 'create') return;
    const anchor = joining.get(e.annotation.id);
    joining.delete(e.annotation.id);
    if (anchor) share(docId, e.annotation.id, anchor);
    else rejoinByName(docId, e.annotation);
  });
  return () => {
    stopTool();
    stopEvents();
  };
}

/**
 * Keyboard creation (rule 12): Enter with a field tool on puts a field of the
 * tool's default size in the middle of the current page, then selects it.
 */
export function placeFieldAtCentre(docId: string, pageIndex: number, tool: FieldTool): void {
  const registry = hostStore.getState().registry;
  const cap = annotationCap();
  const page = registry?.getStore().getState().core.documents[docId]?.document?.pages[pageIndex];
  const base = cap?.getTool(tool) as
    | (AnnotationTool & { clickBehavior?: { defaultSize?: { width: number; height: number } } })
    | undefined;
  if (!cap || !page || !base) return;
  const size = base.clickBehavior?.defaultSize ?? { width: 150, height: 24 };
  const draft = {
    ...base.defaults,
    id: uuidV4(),
    pageIndex,
    rect: centred(page.size, size),
    created: new Date(),
  } as PdfWidgetAnnoObject;
  const anno = adaptField(tool, docId, draft);
  cap.forDocument(docId).createAnnotation(pageIndex, anno);
  cap.forDocument(docId).selectAnnotation(pageIndex, anno.id);
}
