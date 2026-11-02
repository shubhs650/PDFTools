/* eslint-disable */
// @ts-nocheck -- @embedpdf/plugin-form is only installed for the spike run
// (npm install --no-save @embedpdf/plugin-form@2.15.1); M6-14 adds it for real.
//
// S19 — Form field creation (ADR-021 D-39). @embedpdf/plugin-form 2.15.1's five
// tools, driven through their own pointer handlers, over EmbedPDF's PdfEngine
// orchestrator and our Render-worker executor (tracked). Checks: what each
// creates (PDFium + qpdf: /AcroForm /Fields, /NeedAppearances, /AP, /DA),
// Ctrl+S narrow + verification, reopen, fill with the calls FormLayer makes
// (setFormFieldValue), a radio group (shareField), field properties, tab order,
// an existing AcroForm, permissions.
import { PluginRegistry } from '@embedpdf/core';
import { PDF_FORM_FIELD_FLAG, PDF_FORM_FIELD_TYPE, PdfAnnotationSubtype } from '@embedpdf/models';
import { AnnotationPluginPackage } from '@embedpdf/plugin-annotation';
import { DocumentManagerPluginPackage } from '@embedpdf/plugin-document-manager';
import { FormPluginPackage } from '@embedpdf/plugin-form';
import { HistoryPluginPackage } from '@embedpdf/plugin-history';
import { InteractionManagerPluginPackage } from '@embedpdf/plugin-interaction-manager';
import { SelectionPluginPackage } from '@embedpdf/plugin-selection';
import { ScrollPluginPackage } from '@embedpdf/plugin-scroll';
import { ViewportPluginPackage } from '@embedpdf/plugin-viewport';
import { qpdfEncrypt } from '../../e2e/fixtures/encrypted.ts';
import { fullFormPdf, simplePdf } from '../../e2e/fixtures/generate.ts';
import {
  closeDoc,
  ctrlS,
  engine,
  exec,
  installBrowserGlobals,
  native,
  openDoc,
  openPlain,
  qpdfCheck,
  qpdfJson,
  tick,
  tracker,
  work,
} from './harness.ts';

const TYPE = (t) => Object.keys(PDF_FORM_FIELD_TYPE).find((k) => PDF_FORM_FIELD_TYPE[k] === t);

async function makeRegistry() {
  installBrowserGlobals();
  const registry = new PluginRegistry(engine);
  registry.registerPlugin(DocumentManagerPluginPackage, { maxDocuments: 8 });
  registry.registerPlugin(ViewportPluginPackage, { viewportGap: 10 });
  registry.registerPlugin(ScrollPluginPackage, { defaultPageGap: 10 });
  registry.registerPlugin(InteractionManagerPluginPackage, {});
  registry.registerPlugin(SelectionPluginPackage, {});
  registry.registerPlugin(HistoryPluginPackage, {});
  registry.registerPlugin(AnnotationPluginPackage, { autoCommit: true, annotationAuthor: 'Spike' });
  registry.registerPlugin(FormPluginPackage, {});
  await registry.initialize();
  return registry;
}

async function openInRegistry(registry, bytes, id, password) {
  const dm = registry.getPlugin('document-manager').provides();
  await dm
    .openDocumentBuffer({
      buffer: bytes.slice().buffer,
      name: `${id}.pdf`,
      documentId: id,
      ...(password ? { password } : {}),
    })
    .toPromise();
  const store = registry.getStore();
  for (let i = 0; i < 60 && store.getState().core.documents[id]?.status !== 'loaded'; i++)
    await tick();
  await tick(3);
  await tracker.securityReady(id);
  await work.open(id, bytes.slice().buffer, undefined, password);
  return store.getState().core.documents[id].document;
}

/** Drive a tool's own pointer handler: drag from a to b (page points, top-left origin). */
async function drawWith(registry, docId, toolId, a, b) {
  const annotation = registry.getPlugin('annotation');
  const tool = annotation
    .provides()
    .getTools()
    .find((t) => t.id === toolId);
  if (!tool) throw new Error(`no tool ${toolId}`);
  const doc = registry.getStore().getState().core.documents[docId].document;
  const page = doc.pages[0];
  const committed = [];
  const handler = tool.pointerHandler.create({
    pageIndex: 0,
    pageSize: page.size,
    pageRotation: 0,
    scale: 1,
    services: {},
    onPreview: () => {},
    onCommit: (anno, ctx) => {
      committed.push(anno);
      annotation.createAnnotation(0, anno, ctx, docId, {});
    },
    getTool: () => tool,
    getToolContext: () => undefined,
  });
  const evt = { setPointerCapture() {}, releasePointerCapture() {} };
  handler.onPointerDown?.(a, evt);
  handler.onPointerMove?.({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, evt);
  handler.onPointerMove?.(b, evt);
  handler.onPointerUp?.(b, evt);
  await tick(5);
  return committed[0];
}

async function widgetsOf(doc) {
  return native.getPageAnnoWidgets(doc, doc.pages[0]).toPromise();
}

function describeWidgets(ws) {
  return ws.map((w) => ({
    name: w.field.name,
    type: TYPE(w.field.type),
    value: w.field.value,
    flag: w.field.flag,
    options: w.field.options?.map((o) => `${o.label}${o.isSelected ? '*' : ''}`),
    exportValue: w.exportValue,
    rect: [
      Math.round(w.rect.origin.x),
      Math.round(w.rect.origin.y),
      Math.round(w.rect.size.width),
      Math.round(w.rect.size.height),
    ],
  }));
}

function acroFormFacts(bytes, password) {
  const j = qpdfJson(bytes, password);
  const objs = j.qpdf[1];
  const get = (ref) =>
    typeof ref === 'string' ? (objs[`obj:${ref}`]?.value ?? objs[`obj:${ref}`]?.stream?.dict) : ref;
  const trailer = objs.trailer.value;
  const cat = get(trailer['/Root']);
  const acro = get(cat['/AcroForm']);
  if (!acro) return { acroForm: null };
  const fields = get(acro['/Fields']) ?? [];
  const page = get(get(get(cat['/Pages'])['/Kids'])[0]);
  const annots = get(page['/Annots']) ?? [];
  const widgets = annots.map(get).filter((a) => a['/Subtype'] === '/Widget');
  const fieldOf = (w) => (w['/T'] !== undefined ? w : get(w['/Parent']));
  return {
    acroFormKeys: Object.keys(acro).sort(),
    needAppearances: acro['/NeedAppearances'] ?? '(absent)',
    DA: acro['/DA'],
    DR: acro['/DR'] ? Object.keys(get(acro['/DR'])) : '(absent)',
    fieldCount: fields.length,
    annotsOrder: widgets.map((w) => fieldOf(w)?.['/T']),
    widgets: widgets.map((w) => {
      const f = fieldOf(w);
      const ap = get(w['/AP']);
      return {
        T: f?.['/T'],
        FT: f?.['/FT'] ?? get(f?.['/Parent'])?.['/FT'],
        Ff: f?.['/Ff'],
        V: f?.['/V'],
        DA: w['/DA'] ?? f?.['/DA'],
        MK: w['/MK'],
        hasAP: !!ap,
        apStates:
          ap?.['/N'] && typeof get(ap['/N']) === 'object' && !get(ap['/N'])['/Type']
            ? Object.keys(get(ap['/N']))
            : undefined,
        Opt: f?.['/Opt'],
        TU: f?.['/TU'],
        P: !!w['/P'],
        F: w['/F'],
      };
    }),
  };
}

export async function run() {
  const out = {};
  const registry = await makeRegistry();
  const annotationCap = registry.getPlugin('annotation').provides();
  const formCap = registry.getPlugin('form').provides();
  out.toolsRegistered = annotationCap
    .getTools()
    .filter((t) => t.categories?.includes('form'))
    .map((t) => t.id);

  // 1. All five types on a page with no AcroForm, by their own handlers.
  const src = simplePdf(1);
  const doc = await openInRegistry(registry, src, 'forms1');
  const made = {};
  made.text = await drawWith(
    registry,
    'forms1',
    'formTextField',
    { x: 72, y: 120 },
    { x: 272, y: 144 },
  );
  made.check = await drawWith(
    registry,
    'forms1',
    'formCheckbox',
    { x: 72, y: 170 },
    { x: 92, y: 190 },
  );
  made.radioA = await drawWith(
    registry,
    'forms1',
    'formRadioButton',
    { x: 72, y: 210 },
    { x: 92, y: 230 },
  );
  made.radioB = await drawWith(
    registry,
    'forms1',
    'formRadioButton',
    { x: 112, y: 210 },
    { x: 132, y: 230 },
  );
  made.combo = await drawWith(
    registry,
    'forms1',
    'formCombobox',
    { x: 72, y: 250 },
    { x: 272, y: 274 },
  );
  made.list = await drawWith(
    registry,
    'forms1',
    'formListbox',
    { x: 72, y: 290 },
    { x: 272, y: 350 },
  );
  // A click (no drag) uses the tool's default size.
  made.textClick = await drawWith(
    registry,
    'forms1',
    'formTextField',
    { x: 400, y: 120 },
    { x: 400, y: 120 },
  );
  out.created = Object.fromEntries(
    Object.entries(made).map(([k, a]) => [
      k,
      a ? { name: a.field.name, type: TYPE(a.field.type), exportValue: a.exportValue } : null,
    ]),
  );
  out.inPdfiumAfterCreate = describeWidgets(await widgetsOf(doc));

  // Radio group: share radioB into radioA's field.
  try {
    const r = await formCap.shareField(made.radioB.id, made.radioA.id, 'forms1').toPromise();
    await tick(5);
    out.shareField = { result: r };
  } catch (e) {
    out.shareField = { threw: String(e?.message ?? JSON.stringify(e)) };
  }
  // Rename a field (the Properties pane's name).
  try {
    const r = await formCap.renameField(made.text.id, 'customer.name', 'forms1').toPromise();
    await tick(5);
    out.renameField = r;
  } catch (e) {
    out.renameField = { threw: String(e?.message ?? JSON.stringify(e)) };
  }
  // Properties through the annotation plugin (required, tooltip, font size, colours, options).
  try {
    const list = await widgetsOf(doc);
    const textW = list.find((w) => w.field.name === 'customer.name');
    annotationCap.forDocument('forms1').updateAnnotation(0, textW.id, {
      fontSize: 10,
      fontColor: '#FF0000',
      color: '#FFFFE0',
      strokeColor: '#0000FF',
      field: {
        ...textW.field,
        flag: PDF_FORM_FIELD_FLAG.REQUIRED,
        alternateName: 'Customer name (tooltip)',
      },
    });
    const comboW = list.find((w) => w.field.type === PDF_FORM_FIELD_TYPE.COMBOBOX);
    annotationCap.forDocument('forms1').updateAnnotation(0, comboW.id, {
      field: {
        ...comboW.field,
        options: [
          { label: 'DN50', isSelected: false },
          { label: 'DN80', isSelected: true },
          { label: 'DN100', isSelected: false },
        ],
      },
    });
    await tick(10);
    out.propertiesUpdate = describeWidgets(await widgetsOf(doc)).filter(
      (w) => w.name === 'customer.name' || w.type === 'COMBOBOX',
    );
  } catch (e) {
    out.propertiesUpdate = { threw: String(e?.message ?? JSON.stringify(e)) };
  }

  // Ctrl+S → narrow tail? verified? reopen.
  const saved = await ctrlS(doc, src);
  await closeDoc(doc);
  out.save = { mode: saved.mode, fellBack: saved.fellBack, tailBytes: saved.tailBytes };
  out.qpdfCheck = qpdfCheck(saved.bytes);
  out.structure = acroFormFacts(saved.bytes);
  const re = await openPlain(saved.bytes);
  out.reopened = 'doc' in re ? describeWidgets(await widgetsOf(re.doc)) : re;
  if ('doc' in re) await native.closeDocument(re.doc).toPromise();

  // 2. Fill the reopened file with the calls FormLayer makes; Ctrl+S; reopen.
  {
    const d = await openDoc(saved.bytes);
    const page = d.pages[0];
    const ws = await widgetsOf(d);
    const by = (pred) => ws.find(pred);
    const results = {};
    const set = async (label, w, v) => {
      if (!w) return (results[label] = 'missing');
      try {
        results[label] = await exec('setFormFieldValue', d, page, w, v);
      } catch (e) {
        results[label] = `threw: ${e.message}`;
      }
    };
    await set(
      'text',
      by((w) => w.field.name === 'customer.name'),
      { kind: 'text', text: 'Ada Lovelace' },
    );
    await set(
      'check',
      by((w) => w.field.type === PDF_FORM_FIELD_TYPE.CHECKBOX),
      { kind: 'checked', checked: true },
    );
    const radios = ws.filter((w) => w.field.type === PDF_FORM_FIELD_TYPE.RADIOBUTTON);
    await set('radio2', radios[1], { kind: 'checked', checked: true });
    await set(
      'combo',
      by((w) => w.field.type === PDF_FORM_FIELD_TYPE.COMBOBOX),
      { kind: 'selection', index: 2, isSelected: true },
    );
    await set(
      'list',
      by((w) => w.field.type === PDF_FORM_FIELD_TYPE.LISTBOX),
      { kind: 'selection', index: 1, isSelected: true },
    );
    const filled = await ctrlS(d, saved.bytes);
    await closeDoc(d);
    const r2 = await openPlain(filled.bytes);
    out.fill = {
      results,
      save: { mode: filled.mode, fellBack: filled.fellBack, tailBytes: filled.tailBytes },
      qpdfCheck: qpdfCheck(filled.bytes),
      reopened:
        'doc' in r2
          ? describeWidgets(await widgetsOf(r2.doc)).map(
              (w) => `${w.name}=${w.value}${w.options ? ` [${w.options.join(',')}]` : ''}`,
            )
          : r2,
      structure: acroFormFacts(filled.bytes).widgets.map((w) => ({
        T: w.T,
        V: w.V,
        hasAP: w.hasAP,
        apStates: w.apStates,
      })),
    };
    if ('doc' in r2) await native.closeDocument(r2.doc).toPromise();
  }

  // 3. An existing AcroForm: add one text field; the other fields keep their values.
  {
    const src3 = fullFormPdf();
    const d = await openInRegistry(registry, src3, 'forms3');
    const before = describeWidgets(await widgetsOf(d)).length;
    await drawWith(registry, 'forms3', 'formTextField', { x: 300, y: 700 }, { x: 500, y: 724 });
    const s3 = await ctrlS(d, src3);
    await closeDoc(d);
    const r3 = await openPlain(s3.bytes);
    const after = 'doc' in r3 ? describeWidgets(await widgetsOf(r3.doc)) : [];
    if ('doc' in r3) await native.closeDocument(r3.doc).toPromise();
    out.existingAcroForm = {
      widgetsBefore: before,
      widgetsAfter: after.length,
      save: { mode: s3.mode, fellBack: s3.fellBack, tailBytes: s3.tailBytes },
      qpdfCheck: qpdfCheck(s3.bytes),
      fieldCount: acroFormFacts(s3.bytes).fieldCount,
      needAppearances: acroFormFacts(s3.bytes).needAppearances,
    };
  }

  // 4. Permissions: what the tracker's gate says for field creation and renaming
  //    on a file that allows forms + annotations but not "modify" (bit 4).
  {
    const enc = qpdfEncrypt(simplePdf(1), '', 'owner', ['256', '--modify=annotate']);
    const d = await openDoc(enc);
    const gate = (m) => {
      try {
        tracker.checkAllowed(m, d.id);
        return 'allowed';
      } catch {
        return 'refused';
      }
    };
    out.permissions = {
      qpdfModify: 'annotate (bits 6 + 9 + 11 set, bit 4 clear)',
      createWidget: gate('createPageAnnotation'),
      renameWidgetField: gate('renameWidgetField'),
      shareWidgetField: gate('shareWidgetField'),
      note: 'ISO 32000-1 table 22: creating or modifying form fields needs bit 4 and bit 6',
    };
    await closeDoc(d);
  }

  // 5. Creation-time values the tools don't expose: a radio export value and a
  //    text field tooltip (/TU) passed in the created object.
  {
    const src5 = simplePdf(1);
    const d = await openInRegistry(registry, src5, 'forms5');
    const scope = annotationCap.forDocument('forms5');
    scope.createAnnotation(0, {
      type: PdfAnnotationSubtype.WIDGET,
      id: 'radio-choice-1',
      pageIndex: 0,
      rect: { origin: { x: 72, y: 100 }, size: { width: 16, height: 16 } },
      strokeColor: '#000000',
      color: '#FFFFFF',
      strokeWidth: 1,
      exportValue: 'Choice1',
      field: {
        type: PDF_FORM_FIELD_TYPE.RADIOBUTTON,
        flag: PDF_FORM_FIELD_FLAG.BUTTON_RADIO | PDF_FORM_FIELD_FLAG.BUTTON_NOTOGGLETOOFF,
        name: 'pipe.material',
        alternateName: 'Pipe material',
        value: 'Off',
        options: [],
      },
    });
    scope.createAnnotation(0, {
      type: PdfAnnotationSubtype.WIDGET,
      id: 'text-tip',
      pageIndex: 0,
      rect: { origin: { x: 72, y: 140 }, size: { width: 200, height: 24 } },
      fontFamily: 0,
      fontSize: 10,
      fontColor: '#000000',
      strokeColor: '#000000',
      color: '#FFFFFF',
      strokeWidth: 1,
      field: {
        type: PDF_FORM_FIELD_TYPE.TEXTFIELD,
        flag: PDF_FORM_FIELD_FLAG.REQUIRED,
        name: 'tag.number',
        alternateName: 'Tag number (tooltip)',
        value: 'P-101',
      },
    });
    await tick(10);
    const s5 = await ctrlS(d, src5);
    await closeDoc(d);
    const facts = acroFormFacts(s5.bytes);
    out.creationValues = {
      save: { mode: s5.mode, fellBack: s5.fellBack },
      widgets: facts.widgets.map((w) => ({
        T: w.T,
        TU: w.TU ?? '(absent)',
        V: w.V,
        Ff: w.Ff,
        apStates: w.apStates,
      })),
    };
  }
  return out;
}
