// M2-14: form values save narrow and verify (ADR-013 finding 3): a radio
// change also dirties its field (/Parent, holding /V) and sibling widgets
// (/AS), so the narrow tail reopens with the new value instead of falling
// back to keep-all.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  PDF_FORM_FIELD_TYPE,
  type PdfDocumentObject,
  type PdfWidgetAnnoObject,
} from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { fullFormPdf } from '../../e2e/fixtures/generate';
import { finishSave, prepareSave, type SaveFlowDeps } from '../../src/engine/saveFlow';
import { SaveTracker } from '../../src/workers/render/save/tracker';
import { WorkDocs } from '../../src/workers/work/docs';
import { verifyCandidate } from '../../src/workers/work/verify';

const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let render: PdfiumNative;
let tracker: SaveTracker;
let work: WorkDocs;
let workMod: WrappedPdfiumModule;
let workNative: PdfiumNative;
let seq = 0;

beforeAll(async () => {
  const wasmBinary = readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
  mod = await init({ wasmBinary });
  render = new PdfiumNative(mod, { fontFallback: null });
  workMod = await init({ wasmBinary });
  workNative = new PdfiumNative(workMod, { fontFallback: null });
  work = new WorkDocs(() => workNative);
  tracker = new SaveTracker(mod, render);
});

async function openBoth(bytes: Uint8Array): Promise<PdfDocumentObject> {
  const id = `f${String(++seq)}`;
  const doc = await render.openDocumentBuffer({ id, content: bytes.slice().buffer }).toPromise();
  tracker.opened(id, bytes);
  await work.open(id, bytes.slice().buffer, undefined);
  return doc;
}

const deps = (): SaveFlowDeps => ({
  saveIncremental: (d, keepAll) => {
    const r = tracker.saveIncremental(d, keepAll ? { keepAll } : {});
    return Promise.resolve({ ...r, tail: r.tail.slice().buffer });
  },
  verify: (d, piece, expected) => verifyCandidate(workMod, workNative, work, d, piece, expected),
  commit: (d, n) => Promise.resolve({ baseLength: tracker.commit(d, n) }),
  refreshWork: (d, piece) => {
    work.append(d, piece);
    return Promise.resolve();
  },
  logFallback: () => undefined,
});

async function widgets(d: PdfDocumentObject): Promise<PdfWidgetAnnoObject[]> {
  const p = d.pages[0];
  if (!p) throw new Error('page');
  return render.getPageAnnoWidgets(d, p).toPromise();
}

describe('form saves', () => {
  it('a radio change saves narrow and verifies; the value reopens', async () => {
    const d = await openBoth(fullFormPdf());
    const p = d.pages[0];
    if (!p) throw new Error('page');
    const radios = (await widgets(d)).filter(
      (w) => w.field.type === PDF_FORM_FIELD_TYPE.RADIOBUTTON,
    );
    const second = radios[1];
    if (!second) throw new Error('radio');
    await render.setFormFieldValue(d, p, second, { kind: 'checked', checked: true }).toPromise();
    tracker.recordMutation('setFormFieldValue', [d, p, second]);
    const r = await prepareSave(d.id, deps());
    expect(r).toMatchObject({ mode: 'narrow', fellBack: false });
    if (!r) throw new Error('nothing saved');
    await finishSave(r, deps());

    // Reopen original + tail: the second button is the selected one.
    const bytes = new Uint8Array([...fullFormPdf(), ...new Uint8Array(r.tail)]);
    const again = await render
      .openDocumentBuffer({ id: `re${String(++seq)}`, content: bytes.buffer })
      .toPromise();
    const reopened = (await widgets(again)).filter(
      (w) => w.field.type === PDF_FORM_FIELD_TYPE.RADIOBUTTON,
    );
    expect(reopened.map((w) => w.field.value === w.exportValue)).toEqual([false, true]);
    await render.closeDocument(again).toPromise();
    await render.closeDocument(d).toPromise();
  });

  it('text, checkbox, combo and list values save narrow together', async () => {
    const d = await openBoth(fullFormPdf());
    const p = d.pages[0];
    if (!p) throw new Error('page');
    const all = await widgets(d);
    const by = (name: string) => {
      const w = all.find((x) => x.field.name === name);
      if (!w) throw new Error(name);
      return w;
    };
    const set = async (
      w: PdfWidgetAnnoObject,
      v: Parameters<PdfiumNative['setFormFieldValue']>[3],
    ) => {
      await render.setFormFieldValue(d, p, w, v).toPromise();
      tracker.recordMutation('setFormFieldValue', [d, p, w]);
    };
    await set(by('name'), { kind: 'text', text: 'Changed' });
    await set(by('agree'), { kind: 'checked', checked: true });
    await set(by('size'), { kind: 'selection', index: 2, isSelected: true });
    await set(by('material'), { kind: 'selection', index: 0, isSelected: true });
    const r = await prepareSave(d.id, deps());
    expect(r).toMatchObject({ mode: 'narrow', fellBack: false });
    await render.closeDocument(d).toPromise();
  });
});
