// M4-20, M4-21 (ADR-018) on real PDFium: comments of Rev A (one per M3 tool
// plus other-viewer-style markups with replies, a review state and a grouped
// label) imported into Rev B through the Work worker's jobs, applied by the
// Render worker's tracker (reopen), saved as one narrow revision — qpdf-clean,
// reopened with every annotation; plain and encrypted targets; restricted
// sources refused; the clipboard's mini-PDF pasted back with new /NMs.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { PdfDocumentObject } from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { OWNER_PW, USER_PW, qpdfEncrypt } from '../../e2e/fixtures/encrypted';
import { everyToolAnnotation } from '../../spikes/s1-save/annotations';
import { A4, foreignAnnotations, revDoc } from '../../spikes/s16-comment-transfer/fixtures';
import { isDict, nameOf, PdfRef, PdfString } from '../../src/model/pdf/objects';
import { PdfReader } from '../../src/model/pdf/reader';
import { concatBytes } from '../../src/workers/render/save/bytes';
import { SaveTracker } from '../../src/workers/render/save/tracker';
import { WorkDocs } from '../../src/workers/work/docs';
import {
  commentSource,
  copyComments,
  transferComments,
  type TransferSpec,
} from '../../src/workers/work/transferJobs';

const require = createRequire(import.meta.url);
const hasQpdf = spawnSync('qpdf', ['--version']).status === 0;
const tmp = mkdtempSync(join(tmpdir(), 'pdftools-transfer-'));

let mod: WrappedPdfiumModule;
let native: PdfiumNative;
let tracker: SaveTracker;
let docs: WorkDocs;
let revA: Uint8Array;
let seq = 0;

const inflate = (b: Uint8Array) => Promise.resolve(new Uint8Array(inflateSync(b)));
const slice = { checkpoint: () => Promise.resolve(), signal: new AbortController().signal };
const buf = (b: Uint8Array) => b.slice().buffer;

async function open(bytes: Uint8Array, password?: string): Promise<PdfDocumentObject> {
  const id = `t${String(++seq)}`;
  const doc = await native
    .openDocumentBuffer({ id, content: buf(bytes) }, password === undefined ? {} : { password })
    .toPromise();
  tracker.opened(id, bytes, password);
  await tracker.securityReady(id);
  await docs.open(id, buf(bytes), undefined, password);
  return doc;
}

async function close(docId: string): Promise<void> {
  tracker.closed(docId);
  await docs.close(docId);
  await native.closeDocument({ id: docId } as PdfDocumentObject).toPromise();
}

/** Rev A: one comment per M3 tool on page 1, other viewers' markups on page 3. */
async function buildRevA(): Promise<Uint8Array> {
  const f = foreignAnnotations(10, 8);
  const base = revDoc('Rev A', 3, () => A4, f.objs, f.annots);
  const doc = await open(base);
  const page = doc.pages[0];
  if (!page) throw new Error('page');
  for (const t of everyToolAnnotation(0)) {
    if (t.tool === 'link' || t.stampPng) continue;
    await native.createPageAnnotation(doc, page, t.annotation).toPromise();
    tracker.recordMutation('createPageAnnotation', [doc, page, t.annotation]);
  }
  const r = await tracker.save(doc.id);
  await close(doc.id);
  return concatBytes([base, r.tail]);
}

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
  tracker = new SaveTracker(mod, native);
  docs = new WorkDocs(() => native);
  revA = await buildRevA();
});

/** Markup annotations per page: subtype, /NM, author, /IRT's /NM. */
async function annots(bytes: Uint8Array, password?: string) {
  const r = await PdfReader.open(bytes, inflate, password === undefined ? {} : { password });
  const out: { page: number; type: string; nm: string; author: string; irt: string }[] = [];
  for (const [i, p] of (await r.pages()).entries()) {
    const list = await r.resolve(p.dict.get('Annots'));
    for (const a of Array.isArray(list) ? list : []) {
      const d = await r.resolve(a);
      if (!isDict(d)) continue;
      const type = nameOf(d.get('Subtype')) ?? '';
      if (type === 'Popup' || type === 'Link' || type === 'Widget') continue;
      const nm = d.get('NM');
      const t = d.get('T');
      const irt = d.get('IRT');
      let irtNm = '';
      if (irt instanceof PdfRef) {
        const parent = await r.get(irt);
        const pn = isDict(parent) ? parent.get('NM') : undefined;
        irtNm = pn instanceof PdfString ? pn.text() : '?';
      }
      out.push({
        page: i,
        type,
        nm: nm instanceof PdfString ? nm.text() : '',
        author: t instanceof PdfString ? t.text() : '',
        irt: irtNm,
      });
    }
  }
  return out;
}

function qpdfOk(bytes: Uint8Array, password?: string): boolean {
  if (!hasQpdf) return true;
  const file = join(tmp, `f${String(++seq)}.pdf`);
  writeFileSync(file, bytes);
  const pw = password === undefined ? [] : [`--password=${password}`];
  return spawnSync('qpdf', [...pw, '--check', file]).status === 0;
}

/** What the main thread does: live copy current, Work transfer, Render apply. */
async function importInto(
  docId: string,
  source: { bytes: ArrayBuffer; password?: string },
  spec: TransferSpec = {},
) {
  const { tail } = await tracker.snapshot(docId);
  docs.setLive(docId, tail.byteLength ? tail.buffer : null);
  const r = await transferComments(
    mod,
    native,
    docs,
    docId,
    source,
    spec,
    inflate,
    slice,
    () => undefined,
  );
  if (!spec.dryRun) await tracker.applyObjects(docId, r.objects, r.firstNew);
  return r.counts;
}

async function save(docId: string, file: Uint8Array) {
  const r = await tracker.save(docId);
  const saved = concatBytes([file, r.tail]);
  tracker.commit(docId, r.tail.length);
  docs.append(docId, buf(r.tail));
  return { saved, tail: r.tail };
}

const pairs = (list: { type: string; nm: string; irt: string }[]) =>
  list.map((a) => `${a.type}:${a.nm}<${a.irt}`).sort();

describe('comment transfer: the Work worker jobs and the Render apply', () => {
  it('summarizes a source: comments, replies and the latest state', async () => {
    const s = await commentSource(mod, native, { bytes: buf(revA) }, inflate);
    expect(s.copyAllowed).toBe(true);
    expect(s.pages).toBe(3);
    const square = s.comments.find((c) => c.nm === 'fx-square');
    expect(square).toMatchObject({ page: 2, type: 'square', replies: 1, state: 'Accepted' });
    expect(s.comments.some((c) => c.nm === 'fx-reply')).toBe(false);
    expect(s.comments.filter((c) => c.page === 0).length).toBeGreaterThan(8);
  });

  it.skipIf(!hasQpdf)('Rev A → Rev B: every comment, saved narrow and qpdf-clean', async () => {
    const file = revDoc('Rev B', 3);
    const doc = await open(file);
    const preview = await importInto(doc.id, { bytes: buf(revA) }, { dryRun: true });
    const want = await annots(revA);
    expect(preview.selected).toBe(want.length);
    const counts = await importInto(doc.id, { bytes: buf(revA) });
    expect(counts.selected).toBe(want.length);
    const { saved, tail } = await save(doc.id, file);
    expect(qpdfOk(saved)).toBe(true);
    expect([
      ...Buffer.from(tail)
        .toString('latin1')
        .matchAll(/startxref/g),
    ]).toHaveLength(1);
    const got = await annots(saved);
    expect(pairs(got)).toEqual(pairs(want));
    expect(got.find((a) => a.nm === 'fx-reply')?.author).toBe('Vendor');
    // Imported again: every /NM is already there.
    const again = await importInto(doc.id, { bytes: buf(revA) }, { dryRun: true });
    expect(again.selected).toBe(0);
    expect(again.skipped.duplicate).toBe(want.length);
    await close(doc.id);
  });

  it.skipIf(!hasQpdf)('filters, no replies, an offset and a missing page', async () => {
    const file = revDoc('Rev B', 3);
    const doc = await open(file);
    const counts = await importInto(
      doc.id,
      { bytes: buf(revA) },
      { authors: ['Acme Reviewer'], withReplies: false, offset: -2 },
    );
    const { saved } = await save(doc.id, file);
    const got = await annots(saved);
    // Page 3's comments land on page 1; page 1's have no page 0 − 2.
    expect(got.every((a) => a.page === 0)).toBe(true);
    expect(got.some((a) => a.nm === 'fx-reply')).toBe(false); // a text reply: left out
    expect(got.some((a) => a.nm === 'fx-state')).toBe(true); // a state travels with its comment
    expect(got.some((a) => a.nm === 'fx-stamp')).toBe(false); // by Acme QA
    expect(counts.skipped.filtered).toBeGreaterThan(0);
    expect(qpdfOk(saved)).toBe(true);
    // Unfiltered, page 1's comments have no target page (1 − 2).
    const all = await importInto(doc.id, { bytes: buf(revA) }, { offset: -2, dryRun: true });
    expect(all.skipped.missingPage).toBe((await annots(revA)).filter((a) => a.page < 2).length);
    await close(doc.id);
  });

  it.skipIf(!hasQpdf)('into an encrypted target (AES-256), after an undo snapshot', async () => {
    const file = qpdfEncrypt(revDoc('Rev B', 3), USER_PW, OWNER_PW, ['256']);
    const doc = await open(file, OWNER_PW);
    const { token } = await tracker.takeSnapshot(doc.id);
    await importInto(doc.id, { bytes: buf(revA) }, { pages: [2] });
    const { saved } = await save(doc.id, file);
    expect(qpdfOk(saved, USER_PW)).toBe(true);
    const got = await annots(saved, USER_PW);
    expect(got.find((a) => a.nm === 'fx-square')?.author).toBe('Acme Reviewer');
    // Undo, then the next save writes the pages back without them.
    await tracker.restore(doc.id, token);
    const back = await save(doc.id, saved);
    expect(await annots(back.saved, USER_PW)).toEqual([]);
    await close(doc.id);
  });

  it('a restricted source is refused without the owner password', async () => {
    if (!hasQpdf) return;
    const locked = qpdfEncrypt(revA, USER_PW, OWNER_PW, ['256', '--extract=n']);
    const user = await commentSource(
      mod,
      native,
      { bytes: buf(locked), password: USER_PW },
      inflate,
    );
    expect(user.copyAllowed).toBe(false);
    expect(user.comments).toEqual([]);
    const file = revDoc('Rev B', 3);
    const doc = await open(file);
    await expect(importInto(doc.id, { bytes: buf(locked), password: USER_PW })).rejects.toThrow();
    const owner = await commentSource(
      mod,
      native,
      { bytes: buf(locked), password: OWNER_PW },
      inflate,
    );
    expect(owner.copyAllowed).toBe(true);
    expect(owner.comments.length).toBeGreaterThan(0);
    await expect(
      commentSource(mod, native, { bytes: buf(locked), password: 'wrong' }, inflate),
    ).rejects.toMatchObject({ code: 'pdfium:4' });
    await close(doc.id);
  });

  it('an edit between the copy and the apply is caught (transfer-stale)', async () => {
    const file = revDoc('Rev B', 3);
    const doc = await open(file);
    const { tail } = await tracker.snapshot(doc.id);
    docs.setLive(doc.id, tail.byteLength ? tail.buffer : null);
    const r = await transferComments(
      mod,
      native,
      docs,
      doc.id,
      { bytes: buf(revA) },
      {},
      inflate,
      slice,
      () => undefined,
    );
    // The user draws a rectangle meanwhile: it takes the next object number.
    const page = doc.pages[0];
    if (!page) throw new Error('page');
    const [square] = everyToolAnnotation(0).filter((x) => x.tool === 'square');
    if (!square) throw new Error('fixture');
    await native.createPageAnnotation(doc, page, square.annotation).toPromise();
    tracker.recordMutation('createPageAnnotation', [doc, page, square.annotation]);
    await expect(tracker.applyObjects(doc.id, r.objects, r.firstNew)).rejects.toMatchObject({
      code: 'transfer-stale',
    });
    // Copied again from the current state, it applies (the rectangle drawn has
    // the /NM of Rev A's: that one is a duplicate now).
    const again = await importInto(doc.id, { bytes: buf(revA) });
    expect(again.selected).toBe(r.counts.selected - 1);
    expect(again.skipped.duplicate).toBe(1);
    await close(doc.id);
  });

  it.skipIf(!hasQpdf)(
    'copy and paste: new /NMs, replies remapped, shifted on its own page',
    async () => {
      const doc = await open(revA);
      const clip = await copyComments(
        mod,
        native,
        docs,
        doc.id,
        ['fx-square', 'fx-cloud'],
        true,
        inflate,
        slice,
      );
      expect(clip.count).toBe(2);
      expect(clip.pages).toEqual([2]);
      const before = await annots(revA);
      await importInto(
        doc.id,
        { bytes: buf(clip.bytes) },
        { newNames: true, pageMap: [2], shift: { dx: 10, dy: 10 } },
      );
      const { saved } = await save(doc.id, revA);
      expect(qpdfOk(saved)).toBe(true);
      const after = await annots(saved);
      // Square + reply + state + cloud.
      expect(after.length - before.length).toBe(4);
      const added = after.filter((a) => !before.some((b) => b.nm === a.nm));
      expect(added).toHaveLength(4);
      const square = added.find((a) => a.type === 'Square');
      const replies = added.filter((a) => a.irt && a.irt === square?.nm);
      expect(replies).toHaveLength(2);
      // Shifted 10 right and 10 down on the displayed page.
      const r = await PdfReader.open(saved, inflate);
      const p = (await r.pages())[2];
      const list = p ? await r.resolve(p.dict.get('Annots')) : [];
      for (const a of Array.isArray(list) ? list : []) {
        const d = await r.resolve(a);
        if (!isDict(d)) continue;
        const nm = d.get('NM');
        if (nm instanceof PdfString && nm.text() === square?.nm)
          expect(d.get('Rect')).toEqual([310, 590, 460, 670]);
      }
      await close(doc.id);
    },
  );
});
