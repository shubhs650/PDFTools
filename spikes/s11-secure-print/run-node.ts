// M2-02 spike, Node part: passwords and owner unlock, form filling, flatten and
// print rasters with real PDFium (the workers' WASM) and our M1 save core.
// Writes out/s11-node.json. Needs qpdf (fixture encryption and checks).
//
//   node spikes/s11-secure-print/run-node.ts
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  PdfPageFlattenFlag,
  type PdfAnnotationObject,
  type PdfDocumentObject,
  type PdfWidgetAnnoObject,
} from '@embedpdf/models';
import { init } from '@embedpdf/pdfium';
import { a0Sheet, contractPdf } from '../../e2e/fixtures/generate.ts';
import { acquirePage, docPtrOf, rawCall, wasmMemory } from '../../src/workers/render/pdfium.ts';
import { concatBytes } from '../../src/workers/render/save/bytes.ts';
import { digestDocument } from '../../src/workers/render/save/digest.ts';
import { compareDigests } from '../../src/workers/work/verifySave.ts';
import { SaveTracker } from '../../src/workers/render/save/tracker.ts';
import { FPDF_NO_INCREMENTAL, saveWithFlags } from '../../src/workers/render/save/writer.ts';
import {
  OWNER_PW,
  ROW_ORDER,
  USER_PW,
  encryptedVariants,
  fullFormPdf,
  printFlagPdf,
  xfaHybridPdf,
} from './make-fixtures.ts';

const require = createRequire(import.meta.url);
const mod = await init({
  wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')),
});
const native = new PdfiumNative(mod, { fontFallback: null });
const tracker = new SaveTracker(mod, native);
let seq = 0;
const tmp = mkdtempSync(join(tmpdir(), 's11-out-'));
const out: Record<string, unknown> = {};

async function open(bytes: Uint8Array, password?: string): Promise<PdfDocumentObject> {
  const id = `d${String(++seq)}`;
  const doc = await native
    .openDocumentBuffer(
      { id, content: bytes.slice().buffer },
      password === undefined ? {} : { password },
    )
    .toPromise();
  tracker.opened(id, bytes);
  return doc;
}
async function tryOpen(bytes: Uint8Array, password?: string) {
  try {
    const doc = await open(bytes, password);
    return { ok: true as const, doc };
  } catch (e) {
    return { ok: false as const, code: (e as { reason?: { code?: number } }).reason?.code };
  }
}
async function close(doc: PdfDocumentObject): Promise<void> {
  tracker.closed(doc.id);
  await native.closeDocument(doc).toPromise();
}
const page0 = (doc: PdfDocumentObject) => {
  const p = doc.pages[0];
  if (!p) throw new Error('no page');
  return p;
};
const hex = (n: number) => `0x${(n >>> 0).toString(16)}`;
const perms = (doc: PdfDocumentObject) => {
  const ptr = docPtrOf(native, doc.id);
  return {
    getDocPermissions: hex(rawCall(mod, 'FPDF_GetDocPermissions', ptr)),
    getDocUserPermissions: hex(rawCall(mod, 'FPDF_GetDocUserPermissions', ptr)),
    securityRevision: rawCall(mod, 'FPDF_GetSecurityHandlerRevision', ptr),
    ownerUnlocked: Boolean(rawCall(mod, 'EPDF_IsOwnerUnlocked', ptr)),
    docObjectPermissions: hex(doc.permissions),
  };
};
const allowed = (method: string, doc: PdfDocumentObject): boolean => {
  try {
    tracker.checkAllowed(method, doc.id);
    return true;
  } catch {
    return false;
  }
};
function qpdf(bytes: Uint8Array, name: string, password?: string) {
  const f = join(tmp, name);
  writeFileSync(f, bytes);
  const pw = password ? [`--password=${password}`] : [];
  const check = spawnSync('qpdf', [...pw, '--check', f]);
  const enc = spawnSync('qpdf', [...pw, '--show-encryption', f]);
  return {
    check: check.status,
    encryption: enc.stdout.toString().split('\n').slice(0, 2).join(' | '),
  };
}
const ms = (t: number) => Math.round((performance.now() - t) * 10) / 10;

// ------------------------------------------------ Q1 + Q2: passwords and owner unlock
{
  const res: Record<string, unknown> = {};
  for (const v of encryptedVariants(fullFormPdf())) {
    const none = await tryOpen(v.bytes);
    const wrong = await tryOpen(v.bytes, 'nope');
    const r: Record<string, unknown> = {
      noPassword: none.ok ? { opened: true, ...perms(none.doc) } : { code: none.code },
      wrongPassword: wrong.ok ? { opened: true } : { code: wrong.code },
    };
    if (none.ok) await close(none.doc);
    if (wrong.ok) await close(wrong.doc);
    const user = await tryOpen(v.bytes, v.name.includes('owner-only') ? '' : USER_PW);
    if (user.ok) {
      const d = user.doc;
      r.user = {
        ...perms(d),
        fillAllowed: allowed('setFormFieldValue', d),
        annotateAllowed: allowed('createPageAnnotation', d),
      };
      const bad = await native
        .unlockOwnerPermissions(d, 'wrong')
        .toPromise()
        .catch(() => 'rejected');
      const good = await native
        .unlockOwnerPermissions(d, OWNER_PW)
        .toPromise()
        .catch(() => 'rejected');
      r.unlockWrong = bad;
      r.unlockOwner = good;
      r.afterUnlock = {
        ...perms(d),
        fillAllowed: allowed('setFormFieldValue', d),
        annotateAllowed: allowed('createPageAnnotation', d),
      };
      // Save after the unlock: fill a field, narrow tail, check with qpdf.
      if (allowed('setFormFieldValue', d)) {
        const w = (await native.getPageAnnoWidgets(d, page0(d)).toPromise()).find(
          (x) => x.field.name === 'name',
        );
        if (w) {
          await native
            .setFormFieldValue(d, page0(d), w, { kind: 'text', text: 'Unlocked edit' })
            .toPromise();
          tracker.recordMutation('setFormFieldValue', [d, page0(d), w]);
          const save = tracker.saveIncremental(d.id);
          const saved = concatBytes([v.bytes, save.tail]);
          const back = await tryOpen(saved, v.name.includes('owner-only') ? '' : USER_PW);
          const value = back.ok
            ? (await native.getPageAnnoWidgets(back.doc, page0(back.doc)).toPromise()).find(
                (x) => x.field.name === 'name',
              )?.field.value
            : null;
          if (back.ok) await close(back.doc);
          r.saveAfterUnlock = {
            mode: save.mode,
            tailBytes: save.tail.length,
            valueAfterReopen: value,
            qpdf: qpdf(saved, `${v.name}-saved.pdf`, OWNER_PW),
            original: qpdf(v.bytes, `${v.name}.pdf`, OWNER_PW),
          };
        }
      }
      await close(d);
    } else r.user = { code: user.code };
    const owner = await tryOpen(v.bytes, OWNER_PW);
    r.ownerPassword = owner.ok ? perms(owner.doc) : { code: owner.code };
    if (owner.ok) await close(owner.doc);
    res[v.name] = r;
  }
  out.passwords = res;
}

// ------------------------------------------------ Q3: forms
const pixelDiff = (a: Uint8ClampedArray | Uint8Array, b: Uint8ClampedArray | Uint8Array) => {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > 32) n++;
  return n;
};
async function renderRegion(doc: PdfDocumentObject, rect: PdfAnnotationObject['rect']) {
  const img = await native
    .renderPageRect(doc, page0(doc), rect, {
      scaleFactor: 2,
      withAnnotations: true,
      withForms: true,
    })
    .toPromise();
  return img.data;
}
{
  const bytes = fullFormPdf();
  const doc = await open(bytes);
  const p = page0(doc);
  const formType = rawCall(mod, 'FPDF_GetFormType', docPtrOf(native, doc.id));
  const widgets = await native.getPageAnnoWidgets(doc, p).toPromise();
  const describe = (w: PdfWidgetAnnoObject) => ({
    name: w.field.name,
    type: w.field.type,
    flag: w.field.flag,
    value: w.field.value,
    options: 'options' in w.field ? w.field.options : undefined,
    exportValue: w.exportValue,
    rect: w.rect,
  });
  const before = widgets.map(describe);
  const find = (name: string, exportValue?: string) =>
    widgets.find(
      (w) => w.field.name === name && (exportValue === undefined || w.exportValue === exportValue),
    );
  const edits: [string, string | undefined, Parameters<typeof native.setFormFieldValue>[3]][] = [
    ['name', undefined, { kind: 'text', text: 'Changed name' }],
    ['required', undefined, { kind: 'text', text: 'Filled' }],
    ['readonly', undefined, { kind: 'text', text: 'Should not change' }],
    ['agree', undefined, { kind: 'checked', checked: true }],
    ['choice', 'B', { kind: 'checked', checked: true }],
    ['size', undefined, { kind: 'selection', index: 2, isSelected: true }],
    ['material', undefined, { kind: 'selection', index: 0, isSelected: true }],
  ];
  const editResults: Record<string, unknown> = {};
  for (const [name, ev, value] of edits) {
    const w = find(name, ev);
    if (!w) {
      editResults[name] = 'widget not found';
      continue;
    }
    const pre = await renderRegion(doc, w.rect);
    const t = performance.now();
    const ok: boolean | string = await native
      .setFormFieldValue(doc, p, w, value)
      .toPromise()
      .then(
        (v: boolean) => v,
        (e: unknown) => `rejected ${JSON.stringify(e)}`,
      );
    const took = ms(t);
    tracker.recordMutation('setFormFieldValue', [doc, p, w]);
    const post = await renderRegion(doc, w.rect);
    editResults[name] = { ok, ms: took, pixelsChanged: pixelDiff(pre, post) };
  }
  const after = (await native.getPageAnnoWidgets(doc, p).toPromise()).map(describe);
  const save = tracker.saveIncremental(doc.id);
  const saved = concatBytes([bytes, save.tail]);
  const back = await open(saved);
  // What M1-21's save verification would say about this narrow tail.
  const verification = save.expected
    ? compareDigests(save.expected, digestDocument(mod, native, back.id, [0]))
    : 'no digest';
  const reopened = (await native.getPageAnnoWidgets(back, page0(back)).toPromise()).map((w) => [
    w.field.name + (w.exportValue ? `:${w.exportValue}` : ''),
    w.field.value,
  ]);
  // Keep-all (every object PDFium appended) for comparison with the narrow tail.
  const keepAll = tracker.saveIncremental(doc.id, { keepAll: true });
  const keepAllDoc = await open(concatBytes([bytes, keepAll.tail]));
  const keepAllValues = (
    await native.getPageAnnoWidgets(keepAllDoc, page0(keepAllDoc)).toPromise()
  ).map((w) => [w.field.name + (w.exportValue ? `:${w.exportValue}` : ''), w.field.value]);
  await close(keepAllDoc);
  const xfaFg = await open(xfaHybridPdf(false));
  const xfaFull = await open(xfaHybridPdf(true));
  out.forms = {
    formType,
    formTypeXfaHybrid: rawCall(mod, 'FPDF_GetFormType', docPtrOf(native, xfaFg.id)),
    formTypeXfaFull: rawCall(mod, 'FPDF_GetFormType', docPtrOf(native, xfaFull.id)),
    engineOrder: widgets.map((w) => w.field.name),
    rowOrder: ROW_ORDER,
    before,
    edits: editResults,
    after: after.map((w) => [w.name, w.value]),
    save: { mode: save.mode, tailBytes: save.tail.length, kept: save.kept },
    reopened,
    verification,
    keepAll: { tailBytes: keepAll.tail.length, kept: keepAll.kept, reopened: keepAllValues },
    qpdf: qpdf(saved, 'form-saved.pdf'),
  };
  writeFileSync(join(tmp, 'form-filled.pdf'), saved);
  await close(xfaFg);
  await close(xfaFull);
  await close(back);
  await close(doc);

  // ---------------------------------------------- Q4: flatten a copy
  const src = await open(saved);
  const annotCount = async (d: PdfDocumentObject) =>
    ((await native.getPageAnnotations(d, page0(d)).toPromise()) as PdfAnnotationObject[]).length;
  const full = { origin: { x: 0, y: 0 }, size: page0(src).size };
  const reference = (
    await native
      .renderPageRect(src, page0(src), full, {
        scaleFactor: 1,
        withAnnotations: true,
        withForms: true,
      })
      .toPromise()
  ).data;
  const annotsBefore = await annotCount(src);
  const t0 = performance.now();
  const flat = await native
    .flattenPage(src, page0(src), { flag: PdfPageFlattenFlag.Print })
    .toPromise();
  const rewritten = saveWithFlags(mod, docPtrOf(native, src.id), FPDF_NO_INCREMENTAL);
  const flattenMs = ms(t0);
  const flatDoc = await open(rewritten);
  const flatPixels = (
    await native
      .renderPageRect(flatDoc, page0(flatDoc), full, {
        scaleFactor: 1,
        withAnnotations: false,
        withForms: false,
      })
      .toPromise()
  ).data;
  const text = new TextDecoder('latin1').decode(rewritten);
  const tPrep = performance.now();
  const prepared = new Uint8Array(await native.preparePrintDocument(src, {}).toPromise());
  const prepMs = ms(tPrep);
  const prepDoc = await open(prepared);
  out.flatten = {
    result: flat,
    annotsBefore,
    annotsAfter: await annotCount(flatDoc),
    widgetsAfter: (await native.getPageAnnoWidgets(flatDoc, page0(flatDoc)).toPromise()).length,
    acroFormAfter: text.includes('/AcroForm'),
    imagesInOutput: (text.match(/\/Subtype\s*\/Image/g) ?? []).length,
    formXObjectsInOutput: (text.match(/\/Subtype\s*\/Form/g) ?? []).length,
    pixelsDifferentFromAnnotatedRender: pixelDiff(reference, flatPixels),
    pixels: reference.length / 4,
    ms: flattenMs,
    bytes: rewritten.length,
    qpdf: qpdf(rewritten, 'flattened.pdf'),
    preparePrintDocument: {
      ms: prepMs,
      bytes: prepared.length,
      annotsInCopy: await annotCount(prepDoc),
      widgetsInCopy: (await native.getPageAnnoWidgets(prepDoc, page0(prepDoc)).toPromise()).length,
      acroFormInCopy: new TextDecoder('latin1').decode(prepared).includes('/AcroForm'),
    },
  };
  await close(prepDoc);
  await close(flatDoc);
  await close(src);
}

// ------------------------------------------------ Q5: print rasters
const FPDF_ANNOT = 0x01;
const FPDF_PRINTING = 0x800;
/** Raw PDFium render of one band of a page at `scale` (ADR-001 B14). */
function rawBand(
  doc: PdfDocumentObject,
  pageIndex: number,
  scale: number,
  top: number,
  h: number,
  flags: number,
) {
  const ref = acquirePage(native, doc.id, pageIndex);
  try {
    const page = doc.pages[pageIndex];
    if (!page) throw new Error('no page');
    const fullW = Math.round(page.size.width * scale);
    const fullH = Math.round(page.size.height * scale);
    const bandH = Math.min(h, fullH - top);
    const bmp = rawCall(mod, 'FPDFBitmap_CreateEx', fullW, bandH, 4, 0, 0);
    try {
      rawCall(mod, 'FPDFBitmap_FillRect', bmp, 0, 0, fullW, bandH, 0xffffffff);
      rawCall(mod, 'FPDF_RenderPageBitmap', bmp, ref.pagePtr, 0, -top, fullW, fullH, 0, flags);
      const buf = rawCall(mod, 'FPDFBitmap_GetBuffer', bmp);
      const heap = (mod.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
      return { w: fullW, h: bandH, fullH, data: heap.slice(buf, buf + fullW * bandH * 4) };
    } finally {
      rawCall(mod, 'FPDFBitmap_Destroy', bmp);
    }
  } finally {
    ref.release();
  }
}
{
  // Print flag: the screen-only square (bottom right) must disappear with FPDF_PRINTING.
  const d = await open(printFlagPdf());
  const dark = (img: { w: number; data: Uint8Array }, x: number, y: number) =>
    (img.data[(y * img.w + x) * 4] ?? 255) < 128;
  const screen = rawBand(d, 0, 1, 0, 842, FPDF_ANNOT);
  const printed = rawBand(d, 0, 1, 0, 842, FPDF_ANNOT | FPDF_PRINTING);
  const embed = await native
    .renderPageRaw(d, page0(d), { scaleFactor: 1, withAnnotations: true })
    .toPromise();
  const embedImg = { w: embed.width, data: new Uint8Array(embed.data.buffer) };
  out.printFlag = {
    embedPdfRender: {
      printSquare: dark(embedImg, 100, 92),
      screenOnlySquare: dark(embedImg, 450, 742),
    },
    rawScreen: { printSquare: dark(screen, 100, 92), screenOnlySquare: dark(screen, 450, 742) },
    rawPrinting: { printSquare: dark(printed, 100, 92), screenOnlySquare: dark(printed, 450, 742) },
  };
  await close(d);

  const rasters: Record<string, unknown> = {};
  for (const [name, bytes] of [
    ['contractPage', contractPdf(3)],
    ['a0Typical20k', a0Sheet(20_000)],
  ] as const) {
    const doc = await open(bytes);
    for (const dpi of [150, 300, 600]) {
      const scale = dpi / 72;
      const band = 1024;
      const t = performance.now();
      let bands = 0;
      let maxBandMs = 0;
      let px = 0;
      let fullH = 1;
      for (let top = 0; top < fullH; top += band) {
        const tb = performance.now();
        const r = rawBand(doc, 0, scale, top, band, FPDF_ANNOT | FPDF_PRINTING);
        fullH = r.fullH;
        px += r.w * r.h;
        bands++;
        maxBandMs = Math.max(maxBandMs, ms(tb));
        if (dpi === 600 && name === 'a0Typical20k' && bands >= 4) {
          // Extrapolate the rest: 600 DPI A0 is ~ 28,000 × 19,900 px.
          const per = ms(t) / bands;
          fullH = r.fullH;
          rasters[`${name}@${String(dpi)}`] = {
            px: `${String(r.w)}x${String(r.fullH)}`,
            fullPageMB: Math.round((r.w * r.fullH * 4) / 1048576),
            bandsMeasured: bands,
            msPerBand: Math.round(per),
            extrapolatedMs: Math.round(per * Math.ceil(r.fullH / band)),
            maxBandMs,
          };
          break;
        }
      }
      rasters[`${name}@${String(dpi)}`] ??= {
        px: `${String(Math.round(px / fullH))}x${String(fullH)}`,
        fullPageMB: Math.round((px * 4) / 1048576),
        bands,
        ms: ms(t),
        maxBandMs,
      };
    }
    await close(doc);
  }
  out.printRasters = rasters;
  out.wasmMb = Math.round(((wasmMemory(mod)?.buffer.byteLength ?? 0) / 1048576) * 10) / 10;
}

mkdirSync('spikes/s11-secure-print/out', { recursive: true });
writeFileSync('spikes/s11-secure-print/out/s11-node.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
