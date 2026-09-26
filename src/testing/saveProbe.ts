// E2E-only probe for the save core (M1-20). Never part of a production build.
// Adds annotations and form values through the engine, so save and recovery
// can be tested before M3's annotation UI, and exposes the save RPCs.
import {
  PDF_FORM_FIELD_TYPE,
  PdfAnnotationBorderStyle,
  PdfAnnotationSubtype,
  TaskRejectedError,
  type PdfDocumentObject,
} from '@embedpdf/models';
import { diagnostics } from '../app/diagnostics';
import { finishSave, prepareSave } from '../engine/saveFlow';
import { saveDeps } from '../features/save/deps';
import { documentManager, renderEngine, workClient } from '../features/view/host';
import type { TestHook } from './hook';

const toB64 = (buf: ArrayBuffer): string => {
  let s = '';
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

async function docOf(docId: string): Promise<PdfDocumentObject> {
  const doc = (await documentManager()).getDocument(docId);
  if (!doc) throw new Error('document not open');
  return doc;
}

const rpc = () => renderEngine().rpc;

function blankHalf(tail: ArrayBuffer): ArrayBuffer {
  const b = new Uint8Array(tail.slice(0));
  b.fill(0x20, 0, Math.floor(b.length / 2));
  return b.buffer;
}

/**
 * Returns the error code instead of throwing (permission refusals): the engine
 * rejects with a PdfErrorReason, e.g. PdfErrorCode.Security → 'pdfium:5'.
 */
async function codeOf(job: Promise<unknown>): Promise<string | null> {
  try {
    await job;
    return null;
  } catch (e) {
    if (e instanceof TaskRejectedError) {
      const code = (e.reason as { code?: unknown } | undefined)?.code;
      if (typeof code === 'number') return `pdfium:${String(code)}`;
    }
    return String(e);
  }
}

export function registerSaveProbe(hook: TestHook): void {
  hook.capabilities['save'] = {
    /** Adds `n` square annotations to page 1; resolves the error code or null. */
    async addSquares(docId: string, n: number, from = 0) {
      const doc = await docOf(docId);
      const page = doc.pages[0];
      if (!page) throw new Error('no page');
      for (let i = from; i < from + n; i++) {
        const code = await codeOf(
          renderEngine()
            .engine.createPageAnnotation(doc, page, {
              id: `e2e-square-${String(i)}`,
              pageIndex: 0,
              type: PdfAnnotationSubtype.SQUARE,
              rect: { origin: { x: 20 + (i % 10) * 30, y: 20 }, size: { width: 20, height: 20 } },
              flags: ['print'],
              color: 'transparent',
              strokeColor: '#E44234',
              opacity: 1,
              strokeWidth: 2,
              strokeStyle: PdfAnnotationBorderStyle.SOLID,
            })
            .toPromise(),
        );
        if (code) return code;
      }
      return null;
    },
    /** Sets every text field on page 1 to `text`; resolves the field names. */
    async fillText(docId: string, text: string) {
      const doc = await docOf(docId);
      const page = doc.pages[0];
      if (!page) return [];
      const { engine } = renderEngine();
      const names: string[] = [];
      for (const w of await engine.getPageAnnoWidgets(doc, page).toPromise()) {
        if (w.field.type !== PDF_FORM_FIELD_TYPE.TEXTFIELD) continue;
        await engine.setFormFieldValue(doc, page, w, { kind: 'text', text }).toPromise();
        names.push(w.field.name);
      }
      return names;
    },
    async saveIncremental(docId: string, keepAll = false) {
      const r = await rpc().call('saveIncremental', { docId, keepAll }).promise;
      return { ...r, tail: toB64(r.tail), tailLength: r.tail.byteLength };
    },
    commit: (docId: string, tailLength: number) =>
      rpc().call('commitSave', { docId, tailLength }).promise,
    async saveRewrite(docId: string) {
      return toB64((await rpc().call('saveRewrite', { docId }).promise).bytes);
    },
    state: (docId: string) => rpc().call('saveState', { docId }).promise,
    /**
     * The M1-21 flow: save, verify in the Work worker (keep-all fallback), then
     * commit as if written. `corrupt` blanks half of the first tail first.
     */
    async verifiedSave(docId: string, corrupt = false) {
      const deps = saveDeps();
      const p = await prepareSave(docId, deps, corrupt ? { tamper: blankHalf } : {});
      if (!p) return null;
      const baseLength = await finishSave(p, deps);
      return {
        mode: p.mode,
        fellBack: p.fellBack,
        from: p.baseLength,
        baseLength,
        tail: toB64(p.tail),
        tailLength: p.tail.byteLength,
      };
    },
    workDigest: (docId: string, pages: number[]) =>
      workClient().run('digest', { docId, pages }).promise,
    workState: (docId: string) => workClient().run('docState', { docId }).promise,
    fallbacks: () =>
      diagnostics()
        .filter((e) => e.where === 'save')
        .map(({ code, counts }) => ({ code, counts })),
  };
}
