// S1 browser worker: open → annotate → save (incremental / narrow / rewrite)
// → write to OPFS three ways. Everything here is off the main thread.

import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { PdfDocumentObject } from '@embedpdf/models';
import { manyMarkups } from './annotations.ts';
import { isPrefix, narrowTail, save } from './save-core.ts';
import { serve } from '../s3-two-engines/rpc.ts';

let mod: WrappedPdfiumModule | undefined;
let native: PdfiumNative | undefined;

const r1 = (n: number): number => Math.round(n * 10) / 10;

async function opfsFile(name: string): Promise<FileSystemFileHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getFileHandle(name, { create: true });
}

/** Seed an OPFS file with the original bytes (setup, not timed). */
async function seed(name: string, bytes: Uint8Array): Promise<FileSystemFileHandle> {
  const h = await opfsFile(name);
  const access = await h.createSyncAccessHandle();
  access.truncate(0);
  access.write(bytes, { at: 0 });
  access.flush();
  access.close();
  return h;
}

async function readBack(h: FileSystemFileHandle): Promise<Uint8Array> {
  return new Uint8Array(await (await h.getFile()).arrayBuffer());
}

const handlers = {
  async init(args: { wasmUrl: string }) {
    const wasmBinary = await (await fetch(args.wasmUrl)).arrayBuffer();
    mod = await init({ wasmBinary });
    native = new PdfiumNative(mod, { fontFallback: null });
    return true;
  },

  /** The S1 timing scenario for one input. */
  async scenario(args: { url: string; markups: number; name: string }) {
    if (!mod || !native) throw new Error('not initialised');
    const orig = new Uint8Array(await (await fetch(args.url)).arrayBuffer());
    const t = performance.now();
    const doc: PdfDocumentObject = await native
      .openDocumentBuffer({ id: `${args.name}-${String(t)}`, content: orig.slice().buffer })
      .toPromise();
    const openMs = performance.now() - t;
    const page = doc.pages[0];
    if (!page) throw new Error('no page');

    const t0 = performance.now();
    for (const a of manyMarkups(0, args.markups)) {
      await native.createPageAnnotation(doc, page, a).toPromise();
    }
    const createMs = performance.now() - t0;

    // Ctrl+S path: PDFium incremental → narrow tail → append to the file.
    const tSave = performance.now();
    const full = await save(mod, native, doc.id, 'incremental');
    const narrow = narrowTail(orig, full.bytes);
    const saveMs = performance.now() - tSave;
    const tail = narrow.bytes.subarray(orig.length);

    // (a) FSA-style in-place append: createWritable({ keepExistingData }) + seek + write.
    const hA = await seed(`${args.name}-fsa.pdf`, orig);
    const tA = performance.now();
    const w = await hA.createWritable({ keepExistingData: true });
    await w.seek(orig.length);
    await w.write(tail);
    await w.close();
    const writableAppendMs = performance.now() - tA;
    const backA = await readBack(hA);

    // (b) Recovery-style tail write with a sync access handle (no swap file).
    const hB = await seed(`${args.name}-sync.pdf`, orig);
    const tB = performance.now();
    const acc = await hB.createSyncAccessHandle();
    acc.write(tail, { at: orig.length });
    acc.flush();
    acc.close();
    const syncTailMs = performance.now() - tB;
    const backB = await readBack(hB);

    // (c) Tail only, as its own OPFS file (B11: original + tail recovery).
    const hC = await opfsFile(`${args.name}-tail.bin`);
    const tC = performance.now();
    const accC = await hC.createSyncAccessHandle();
    accC.truncate(0);
    accC.write(tail, { at: 0 });
    accC.flush();
    accC.close();
    const tailFileMs = performance.now() - tC;

    // Save Optimized path, for comparison.
    const rew = await save(mod, native, doc.id, 'rewrite');
    await native.closeDocument(doc).toPromise();

    const same = (x: Uint8Array): boolean =>
      x.length === narrow.bytes.length && isPrefix(narrow.bytes, x);
    return {
      input: args.name,
      originalBytes: orig.length,
      markups: args.markups,
      openMs: r1(openMs),
      createMs: r1(createMs),
      pdfiumIncrementalMs: r1(full.ms),
      saveMs: r1(saveMs),
      fullTailBytes: full.bytes.length - orig.length,
      narrowTailBytes: tail.length,
      writableAppendMs: r1(writableAppendMs),
      syncTailMs: r1(syncTailMs),
      tailFileMs: r1(tailFileMs),
      endToEndMs: r1(saveMs + writableAppendMs),
      appendedFileCorrect: same(backA),
      syncFileCorrect: same(backB),
      rewriteMs: r1(rew.ms),
      rewriteBytes: rew.bytes.length,
    };
  },
};

/**
 * Owner run: the same Ctrl+S path on a real file picked with the File System
 * Access API (handle transferred from the main thread after a user gesture).
 */
async function fsaAppend(args: { handle: FileSystemFileHandle; markups: number }) {
  if (!mod || !native) throw new Error('not initialised');
  const orig = new Uint8Array(await (await args.handle.getFile()).arrayBuffer());
  const doc = await native
    .openDocumentBuffer({ id: `fsa-${String(Date.now())}`, content: orig.slice().buffer })
    .toPromise();
  const page = doc.pages[0];
  if (!page) throw new Error('no page');
  for (const a of manyMarkups(0, args.markups))
    await native.createPageAnnotation(doc, page, a).toPromise();
  const t0 = performance.now();
  const full = await save(mod, native, doc.id, 'incremental');
  const narrow = narrowTail(orig, full.bytes);
  const saveMs = performance.now() - t0;
  await native.closeDocument(doc).toPromise();
  const t1 = performance.now();
  const w = await args.handle.createWritable({ keepExistingData: true });
  await w.seek(orig.length);
  await w.write(narrow.bytes.subarray(orig.length));
  await w.close();
  const appendMs = performance.now() - t1;
  return {
    originalBytes: orig.length,
    tailBytes: narrow.bytes.length - orig.length,
    saveMs: r1(saveMs),
    appendMs: r1(appendMs),
    endToEndMs: r1(saveMs + appendMs),
  };
}

const allHandlers = { ...handlers, fsaAppend };
export type SaveHandlers = typeof allHandlers;
serve(allHandlers);
