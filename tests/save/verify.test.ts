// M1-21: save verification. The comparison, the flow's fallback selection
// (fake workers), and the digest + verify path through two real PDFium
// instances (Render-side tracker, Work-side WorkDocs).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  PDF_FORM_FIELD_TYPE,
  PdfAnnotationBorderStyle,
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
  type PdfDocumentObject,
} from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  SaveVerifyError,
  finishSave,
  prepareSave,
  type IncrementalTail,
  type SaveFallbackLog,
  type SaveFlowDeps,
} from '../../src/engine/saveFlow';
import { digestDocument, hashText, type DocDigest } from '../../src/workers/render/save/digest';
import { SaveTracker } from '../../src/workers/render/save/tracker';
import { WorkDocs } from '../../src/workers/work/docs';
import { verifyCandidate } from '../../src/workers/work/verify';
import { compareDigests } from '../../src/workers/work/verifySave';

const page = (n: number, extra: Partial<DocDigest['pages'][number]> = {}) => ({
  page: n,
  annots: [
    {
      subtype: 5,
      rect: [10, 10, 50, 50] as [number, number, number, number],
      nm: 'a',
      obj: 7,
      contents: 'h1',
    },
    {
      subtype: 1,
      rect: [60, 10, 80, 30] as [number, number, number, number],
      nm: 'b',
      obj: 8,
      contents: 'h2',
    },
  ],
  fields: [{ name: 'n1', value: 'v1', checked: false }],
  ...extra,
});
const doc = (...pages: DocDigest['pages']): DocDigest => ({ pageCount: 3, pages });

describe('compareDigests', () => {
  it('equal digests verify, in any annotation order', () => {
    const a = doc(page(0));
    const b = doc(page(0, { annots: [...page(0).annots].reverse() }));
    expect(compareDigests(a, b)).toEqual({ ok: true });
  });

  it('a missing annotation, a changed rect or a changed form value fails', () => {
    const want = doc(page(1));
    expect(compareDigests(want, doc(page(1, { annots: page(1).annots.slice(1) })))).toEqual({
      ok: false,
      reason: 'annotations',
      page: 1,
    });
    const moved = page(1).annots.map((x, i) =>
      i === 0 ? { ...x, rect: [10, 10, 50, 51] as [number, number, number, number] } : x,
    );
    expect(compareDigests(want, doc(page(1, { annots: moved }))).ok).toBe(false);
    const edited = [{ name: 'n1', value: 'v2', checked: false }];
    expect(compareDigests(want, doc(page(1, { fields: edited })))).toEqual({
      ok: false,
      reason: 'form',
      page: 1,
    });
  });

  it('a checked /NM must survive; an unchecked one (not rewritten by the save) matches any', () => {
    const want = doc(page(0));
    const lost = page(0).annots.map((x) => ({ ...x, nm: '' }));
    expect(compareDigests(want, doc(page(0, { annots: lost }))).ok).toBe(false);
    const unchecked = doc(page(0, { annots: page(0).annots.map((x) => ({ ...x, nm: '*' })) }));
    expect(compareDigests(unchecked, doc(page(0, { annots: lost })))).toEqual({ ok: true });
  });

  it('page count and missing pages', () => {
    expect(compareDigests(doc(page(0)), { pageCount: 2, pages: [page(0)] }).ok).toBe(false);
    expect(compareDigests(doc(page(2)), doc(page(0)))).toEqual({
      ok: false,
      reason: 'missing-page',
      page: 2,
    });
  });

  it('hashText is stable and does not echo the text', () => {
    expect(hashText('secret')).toBe(hashText('secret'));
    expect(hashText('secret')).not.toContain('secret');
    expect(hashText('a')).not.toBe(hashText('b'));
  });
});

describe('prepareSave fallback selection', () => {
  const expected = doc(page(0));
  function fake(opts: { narrowOk?: boolean; keepAllOk?: boolean; empty?: boolean } = {}) {
    const calls: string[] = [];
    const logs: SaveFallbackLog[] = [];
    const tail = (mode: 'narrow' | 'keep-all'): IncrementalTail => ({
      tail: new ArrayBuffer(opts.empty ? 0 : mode === 'narrow' ? 10 : 30),
      mode,
      kept: mode === 'narrow' ? [1, 2] : [1, 2, 3, 4],
      baseLength: 100,
      expected: opts.empty ? null : expected,
    });
    const deps: SaveFlowDeps = {
      saveIncremental: (_d, keepAll) => {
        calls.push(keepAll ? 'save:keep-all' : 'save:narrow');
        return Promise.resolve(tail(keepAll ? 'keep-all' : 'narrow'));
      },
      verify: (_d, piece) => {
        const narrow = piece.byteLength !== 30;
        calls.push(narrow ? 'verify:narrow' : 'verify:keep-all');
        const ok =
          piece.byteLength === 7
            ? false
            : narrow
              ? (opts.narrowOk ?? true)
              : (opts.keepAllOk ?? true);
        return Promise.resolve(ok ? { ok: true } : { ok: false, reason: 'unparsable' });
      },
      commit: () => Promise.resolve({ baseLength: 110 }),
      refreshWork: () => Promise.resolve(),
      logFallback: (e) => logs.push(e),
    };
    return { deps, calls, logs };
  }

  it('a verified narrow tail is used as is', async () => {
    const { deps, calls, logs } = fake();
    const r = await prepareSave('d', deps);
    expect(r).toMatchObject({ mode: 'narrow', fellBack: false, baseLength: 100 });
    expect(calls).toEqual(['save:narrow', 'verify:narrow']);
    expect(logs).toEqual([]);
  });

  it('nothing changed: no verification, null', async () => {
    const { deps, calls } = fake({ empty: true });
    expect(await prepareSave('d', deps)).toBeNull();
    expect(calls).toEqual(['save:narrow']);
  });

  it('an injected corrupt tail falls back to keep-all, logs counts only, and re-verifies', async () => {
    const { deps, calls, logs } = fake();
    const r = await prepareSave('d', deps, { tamper: () => new ArrayBuffer(7) });
    expect(r).toMatchObject({ mode: 'keep-all', fellBack: true });
    expect(r?.tail.byteLength).toBe(30);
    expect(calls).toEqual(['save:narrow', 'verify:narrow', 'save:keep-all', 'verify:keep-all']);
    expect(logs).toEqual([{ code: 'save-fallback:unparsable', objectCount: 2, size: 7 }]);
  });

  it('keep-all failing too is an error, never a success', async () => {
    const { deps } = fake({ narrowOk: false, keepAllOk: false });
    await expect(prepareSave('d', deps)).rejects.toBeInstanceOf(SaveVerifyError);
  });

  it('cancellation before the result is reported', async () => {
    const { deps } = fake();
    const ac = new AbortController();
    ac.abort();
    await expect(prepareSave('d', deps, { signal: ac.signal })).rejects.toThrow();
  });
});

describe('digest + verify through real PDFium', () => {
  const require = createRequire(import.meta.url);
  let mod: WrappedPdfiumModule;
  let render: PdfiumNative;
  let workNative: PdfiumNative;
  let tracker: SaveTracker;
  let work: WorkDocs;
  let seq = 0;

  beforeAll(async () => {
    const wasmBinary = readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
    mod = await init({ wasmBinary });
    render = new PdfiumNative(mod, { fontFallback: null });
    // A second module, like the Work worker's own PDFium instance.
    const workMod = await init({ wasmBinary });
    workNative = new PdfiumNative(workMod, { fontFallback: null });
    work = new WorkDocs(() => workNative);
    workVerify = (docId, piece, expected) =>
      verifyCandidate(workMod, workNative, work, docId, piece, expected);
    tracker = new SaveTracker(mod, render);
  });

  let workVerify: (
    docId: string,
    piece: ArrayBuffer,
    expected: DocDigest,
  ) => Promise<ReturnType<typeof compareDigests>>;

  const fixture = (name: string) =>
    new Uint8Array(readFileSync(`e2e/fixtures/self-made/s1-interop/original__${name}.pdf`));

  async function openBoth(bytes: Uint8Array): Promise<PdfDocumentObject> {
    const id = `v${String(++seq)}`;
    const doc = await render.openDocumentBuffer({ id, content: bytes.slice().buffer }).toPromise();
    tracker.opened(id, bytes);
    await work.open(id, bytes.slice().buffer, undefined);
    return doc;
  }

  function deps(): SaveFlowDeps {
    return {
      saveIncremental: (d, keepAll) => {
        const r = tracker.saveIncremental(d, keepAll ? { keepAll } : {});
        return Promise.resolve({ ...r, tail: r.tail.slice().buffer });
      },
      verify: (d, piece, expected) => workVerify(d, piece, expected),
      commit: (d, n) => Promise.resolve({ baseLength: tracker.commit(d, n) }),
      refreshWork: (d, piece) => {
        work.append(d, piece);
        return Promise.resolve();
      },
      logFallback: () => undefined,
    };
  }

  async function addSquare(d: PdfDocumentObject, i: number) {
    const p = d.pages[0];
    if (!p) throw new Error('no page');
    const annotation: PdfAnnotationObject = {
      id: `sq-${String(i)}`,
      pageIndex: 0,
      type: PdfAnnotationSubtype.SQUARE,
      rect: { origin: { x: 30 + i * 40, y: 30 }, size: { width: 30, height: 30 } },
      flags: ['print'],
      color: 'transparent',
      strokeColor: '#E44234',
      opacity: 1,
      strokeWidth: 2,
      strokeStyle: PdfAnnotationBorderStyle.SOLID,
    };
    await render.createPageAnnotation(d, p, annotation).toPromise();
    tracker.recordMutation('createPageAnnotation', [d, p, annotation]);
  }

  it('the digest is read-only: digesting an annotated file leaves nothing to save', async () => {
    const d = await openBoth(fixture('annotated'));
    const before = digestDocument(mod, render, d.id, 'all');
    expect(before.pages[0]?.annots.length).toBeGreaterThan(0);
    expect(digestDocument(mod, render, d.id, 'all')).toEqual(before);
    expect(tracker.saveIncremental(d.id).tail.length).toBe(0);
    await render.closeDocument(d).toPromise();
  });

  it('a narrow save verifies; commit + a second save verify against the refreshed Work copy', async () => {
    const d = await openBoth(fixture('plain'));
    await addSquare(d, 0);
    const first = await prepareSave(d.id, deps());
    expect(first).toMatchObject({ mode: 'narrow', fellBack: false });
    if (!first) throw new Error('nothing saved');
    await finishSave(first, deps());
    const { appliedTailBytes } = await work.get(d.id);
    expect(appliedTailBytes).toBe(first.tail.byteLength);
    await addSquare(d, 1);
    const second = await prepareSave(d.id, deps());
    expect(second).toMatchObject({ mode: 'narrow', fellBack: false });
    await render.closeDocument(d).toPromise();
  });

  it('form values are part of the check', async () => {
    const d = await openBoth(fixture('form'));
    const p = d.pages[0];
    if (!p) throw new Error('no page');
    const w = (await render.getPageAnnoWidgets(d, p).toPromise()).find(
      (x) => x.field.type === PDF_FORM_FIELD_TYPE.TEXTFIELD,
    );
    if (!w) throw new Error('no text field');
    await render.setFormFieldValue(d, p, w, { kind: 'text', text: 'Verified' }).toPromise();
    tracker.recordMutation('setFormFieldValue', [d, p, w]);
    const r = tracker.saveIncremental(d.id);
    const expected = r.expected;
    if (!expected) throw new Error('no digest');
    expect(expected.pages[0]?.fields.length).toBeGreaterThan(0);
    expect(await workVerify(d.id, r.tail.slice().buffer, expected)).toEqual({
      ok: true,
    });
    // The same tail against a digest with another value does not verify.
    const wrong = structuredClone(expected);
    const f = wrong.pages[0]?.fields.find((x) => x.value !== hashText(''));
    if (f) f.value = hashText('other');
    expect((await workVerify(d.id, r.tail.slice().buffer, wrong)).ok).toBe(false);
    await render.closeDocument(d).toPromise();
  });

  it('a corrupt narrow tail falls back to keep-all, which verifies', async () => {
    const d = await openBoth(fixture('plain'));
    await addSquare(d, 0);
    const corrupt = (t: ArrayBuffer) => {
      const b = new Uint8Array(t.slice(0));
      b.fill(0x20, 0, Math.floor(b.length / 2)); // blank out the new objects
      return b.buffer;
    };
    const r = await prepareSave(d.id, deps(), { tamper: corrupt });
    expect(r).toMatchObject({ mode: 'keep-all', fellBack: true });
    await render.closeDocument(d).toPromise();
  });
});
